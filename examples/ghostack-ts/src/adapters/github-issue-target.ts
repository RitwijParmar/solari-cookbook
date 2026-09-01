import { IntentConflictError } from "../core/errors.js"
import type { EffectReceipt, EffectTarget, FaultPoint, PreparedOperation, TargetStats } from "../core/types.js"

interface GitHubIssue {
  readonly id: number
  readonly number: number
  readonly html_url: string
  readonly body: string | null
  readonly created_at: string
}

/** A production adapter boundary. It only writes to a repository explicitly configured by its owner. */
export class GitHubIssueTarget implements EffectTarget {
  private requests = 0
  private effects = 0

  constructor(
    private readonly token: string,
    private readonly repository: string,
  ) {}

  async submit(operation: PreparedOperation, options: { readonly fault: FaultPoint }): Promise<EffectReceipt> {
    if (options.fault === "before_send") throw new Error("Injected termination before GitHub request")
    this.requests += 1
    const existing = await this.lookupIssue(operation)
    const issue = existing ?? await this.createIssue(operation)
    const receipt = this.receipt(issue, operation)
    if (options.fault === "after_commit_before_ack") {
      const { AmbiguousOutcomeError } = await import("../core/errors.js")
      throw new AmbiguousOutcomeError("GitHub committed the issue; the browser lost its acknowledgement.", options.fault)
    }
    return receipt
  }

  async lookup(operation: PreparedOperation): Promise<EffectReceipt | null> {
    const issue = await this.lookupIssue(operation)
    return issue === null ? null : this.receipt(issue, operation)
  }

  async stats(): Promise<TargetStats> {
    return { requests: this.requests, effects: this.effects }
  }

  private async lookupIssue(operation: PreparedOperation): Promise<GitHubIssue | null> {
    const query = encodeURIComponent(`repo:${this.repository} in:body \"ghostack:${operation.idempotencyKey}\"`)
    const response = await this.request(`https://api.github.com/search/issues?q=${query}`)
    const data = await response.json() as { readonly items?: readonly GitHubIssue[] }
    return data.items?.[0] ?? null
  }

  private async createIssue(operation: PreparedOperation): Promise<GitHubIssue> {
    const response = await this.request(`https://api.github.com/repos/${this.repository}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `[GhostAck drill] ${operation.intent.reason}`,
        body: `Disposable chaos-test effect.\n\n<!-- ghostack:${operation.idempotencyKey} intent:${operation.intentHash} -->`,
      }),
    })
    this.effects += 1
    return response.json() as Promise<GitHubIssue>
  }

  private receipt(issue: GitHubIssue, operation: PreparedOperation): EffectReceipt {
    if (!issue.body?.includes(`intent:${operation.intentHash}`)) throw new IntentConflictError("GitHub receipt has a different intent hash")
    return {
      receiptId: `github-issue-${issue.id}`,
      idempotencyKey: operation.idempotencyKey,
      intentHash: operation.intentHash,
      committedAt: issue.created_at,
      amountCents: operation.intent.amountCents,
    }
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "ghostack-chaos-lab",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    if (!response.ok) throw new Error(`GitHub adapter failed with ${response.status}`)
    return response
  }
}
