import { Solari } from "@solarisdk/browser"
import { SolariClient } from "@solarisdk/sdk"

import { AmbiguousOutcomeError, IntentConflictError } from "../core/errors.js"
import type {
  EffectReceipt,
  EffectTarget,
  FaultPoint,
  PreparedOperation,
  TargetStats,
} from "../core/types.js"
import { TARGET_PROGRAM } from "./solari-target-program.js"

const PORT = 3000

function endpoint(origin: string, pathname: string): string {
  const url = new URL(origin)
  url.pathname = pathname
  return url.toString()
}

async function waitForReceipt(origin: string, key: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await fetch(endpoint(origin, `/api/effects/${encodeURIComponent(key)}`))
    if (response.ok) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("Target did not commit before the crash-injection deadline.")
}

export interface SolariRuntimeEvidence {
  readonly sandboxId: string
  readonly previewUrl: string
  readonly browserSessionIds: readonly string[]
}

export class SolariEffectTarget implements EffectTarget {
  private readonly browser: Solari
  private readonly sessionIds: string[] = []

  private constructor(
    private readonly sandbox: Awaited<ReturnType<SolariClient["sandboxes"]["create"]>>,
    private readonly origin: string,
    apiKey: string,
  ) {
    this.browser = new Solari({ apiKey })
  }

  static async create(apiKey: string): Promise<SolariEffectTarget> {
    const client = new SolariClient({ apiKey })
    const sandbox = await client.sandboxes.create({
      template: "base",
      timeoutMs: 10 * 60_000,
      metadata: { product: "aegis-commit", purpose: "exactly-once-demo" },
    })
    await sandbox.connect()
    await sandbox.files.write("/tmp/aegis-target.mjs", TARGET_PROGRAM)
    await sandbox.commands.run("sh", {
      args: [
        "-c",
        `nohup node /tmp/aegis-target.mjs >/tmp/aegis-target.log 2>&1 &`,
      ],
    })
    const { url } = await sandbox.previewUrl(PORT)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(endpoint(url, "/health"))
      if (response.ok) return new SolariEffectTarget(sandbox, url, apiKey)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    await sandbox.kill()
    throw new Error("Solari target sandbox did not become healthy.")
  }

  async submit(
    operation: PreparedOperation,
    options: { readonly fault: FaultPoint },
  ): Promise<EffectReceipt> {
    const session = await this.browser.launch({ recording: true, retries: 1, probe: true })
    this.sessionIds.push(session.id)
    try {
      const page = await session.newPage()
      const ackDelayMs = options.fault === "after_commit_before_ack" ? 2_500 : 0
      await page.goto(`${this.origin}?ackDelayMs=${ackDelayMs}`)
      await page.locator("#idempotency-key").fill(operation.idempotencyKey)
      await page.locator("#intent-hash").fill(operation.intentHash)
      await page.locator("#amount").fill(String(operation.intent.amountCents))

      if (options.fault === "before_send") {
        throw new AmbiguousOutcomeError(
          "Solari browser was terminated before the form dispatch.",
          "before_send",
        )
      }

      await page.locator("#commit").click({ noWaitAfter: true })
      if (options.fault === "after_commit_before_ack") {
        await waitForReceipt(this.origin, operation.idempotencyKey)
        throw new AmbiguousOutcomeError(
          "Solari browser was terminated after the sandbox committed but before the delayed acknowledgement.",
          "after_commit_before_ack",
        )
      }

      await page.locator("#result").filter({ hasText: "receiptId" }).waitFor({ timeout: 10_000 })
      return JSON.parse((await page.locator("#result").innerText()) ?? "") as EffectReceipt
    } finally {
      await session.close()
    }
  }

  async lookup(operation: PreparedOperation): Promise<EffectReceipt | null> {
    const session = await this.browser.launch({ recording: true, retries: 1, probe: true })
    this.sessionIds.push(session.id)
    try {
      const page = await session.newPage()
      const response = await page.goto(
        endpoint(this.origin, `/receipts/${encodeURIComponent(operation.idempotencyKey)}`),
      )
      if (response?.status() === 404) return null
      if (!response?.ok()) throw new Error(`Receipt lookup returned HTTP ${response?.status()}.`)
      const receipt = JSON.parse(await page.locator("#receipt").innerText()) as EffectReceipt
      if (receipt.intentHash !== operation.intentHash) {
        throw new IntentConflictError("Receipt lookup returned a different intent hash.")
      }
      return receipt
    } finally {
      await session.close()
    }
  }

  async stats(): Promise<TargetStats> {
    const response = await fetch(endpoint(this.origin, "/api/stats"))
    if (!response.ok) throw new Error(`Target stats returned HTTP ${response.status}.`)
    return (await response.json()) as TargetStats
  }

  evidence(): SolariRuntimeEvidence {
    return {
      sandboxId: this.sandbox.sandboxId,
      previewUrl: this.origin,
      browserSessionIds: [...this.sessionIds],
    }
  }

  async close(): Promise<void> {
    await this.browser.close()
    await this.sandbox.kill()
  }
}
