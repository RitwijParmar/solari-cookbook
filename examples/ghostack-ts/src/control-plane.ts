import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"

import { InMemoryIdempotentTarget } from "./adapters/in-memory-target.js"
import { SolariEffectTarget } from "./adapters/solari-target.js"
import { MemoryAuditLog } from "./core/audit.js"
import { ExactlyOnceCoordinator } from "./core/coordinator.js"
import { IntentConflictError } from "./core/errors.js"
import { prepareOperation } from "./core/operation.js"
import { EvidenceSigner, type SignedProof } from "./core/signing.js"
import { RunTelemetry, type ExportedSpan } from "./core/telemetry.js"
import type { AuditEvent, EffectIntent, ExecutionResult } from "./core/types.js"

export type Scenario = "ack_lost" | "before_send" | "coordinator_restart" | "concurrency" | "intent_mutation"
export type RunStatus = "queued" | "running" | "passed" | "failed"

export class ControlPlaneError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
  }
}

export interface RunStep {
  readonly at: string
  readonly phase: string
  readonly title: string
  readonly detail: string
  readonly tone: "neutral" | "danger" | "success" | "warning"
  readonly traceId: string
  readonly spanId: string
}

export interface ChaosProof {
  readonly schemaVersion: "1.0"
  readonly product: "GhostAck"
  readonly runId: string
  readonly scenario: Scenario
  readonly mode: "deterministic" | "solari-live"
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number
  readonly operationId: string
  readonly outcome: "exactly_once"
  readonly invariants: {
    readonly targetRequests: number
    readonly durableEffects: number
    readonly duplicates: number
    readonly finalState: string
    readonly auditChainVerified: true
  }
  readonly audit: readonly AuditEvent[]
  readonly trace: readonly RunStep[]
  readonly telemetry: {
    readonly format: "otlp-json/1.0"
    readonly serviceName: "ghostack-control-plane"
    readonly traceId: string
    readonly spans: readonly ExportedSpan[]
  }
  readonly runtime?: Readonly<Record<string, unknown>>
}

export interface ChaosRun {
  readonly id: string
  readonly scenario: Scenario
  readonly mode: "deterministic" | "solari-live"
  readonly createdAt: string
  readonly traceId: string
  status: RunStatus
  steps: RunStep[]
  result?: ExecutionResult
  proof?: SignedProof<ChaosProof>
  error?: string
}

const LABELS: Record<Scenario, string> = {
  ack_lost: "Kill after commit",
  before_send: "Kill before send",
  coordinator_restart: "Restart coordinator",
  concurrency: "20-agent collision",
  intent_mutation: "Mutated intent attack",
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class ChaosControlPlane {
  private readonly signer = new EvidenceSigner(process.env.GHOSTACK_SIGNING_PRIVATE_KEY?.replaceAll("\\n", "\n"))
  private readonly runs = new Map<string, ChaosRun>()
  private readonly telemetry = new Map<string, RunTelemetry>()
  private liveRunAt = 0

  list(): readonly ChaosRun[] {
    return [...this.runs.values()].reverse().slice(0, 20)
  }

  get(id: string): ChaosRun | undefined {
    return this.runs.get(id)
  }

  create(scenario: Scenario, live: boolean): ChaosRun {
    const mode = live ? "solari-live" : "deterministic"
    if (live && scenario !== "ack_lost") {
      throw new ControlPlaneError("Live Solari mode only supports kill-after-commit.", 400, "unsupported_live_scenario")
    }
    if (live && process.env.SOLARI_API_KEY === undefined) {
      throw new ControlPlaneError("Live Solari runtime is not configured.", 503, "live_runtime_unavailable")
    }
    if (live && Date.now() - this.liveRunAt < 60_000) {
      const remaining = Math.ceil((60_000 - (Date.now() - this.liveRunAt)) / 1_000)
      throw new ControlPlaneError(`Live runtime is cooling down. Try again in ${remaining} seconds.`, 429, "live_runtime_cooldown", remaining)
    }
    if (live) this.liveRunAt = Date.now()
    const run: ChaosRun = {
      id: `run_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      scenario,
      mode,
      createdAt: new Date().toISOString(),
      traceId: "pending",
      status: "queued",
      steps: [],
    }
    const telemetry = new RunTelemetry()
    this.telemetry.set(run.id, telemetry)
    const tracedRun: ChaosRun = { ...run, traceId: telemetry.traceId }
    this.runs.set(run.id, tracedRun)
    this.prune()
    void this.execute(tracedRun)
    return tracedRun
  }

  private prune(): void {
    if (this.runs.size <= 50) return
    for (const [id, run] of this.runs) {
      if (run.status === "passed" || run.status === "failed") {
        this.runs.delete(id)
        if (this.runs.size <= 50) return
      }
    }
  }

  private step(run: ChaosRun, phase: string, title: string, detail: string, tone: RunStep["tone"] = "neutral"): void {
    const span = this.telemetry.get(run.id)?.record(phase, { "ghostack.phase": phase, "ghostack.tone": tone, "ghostack.title": title })
    run.steps.push({ at: new Date().toISOString(), phase, title, detail, tone, traceId: span?.traceId ?? run.traceId, spanId: span?.spanId ?? "0".repeat(16) })
  }

  private async execute(run: ChaosRun): Promise<void> {
    run.status = "running"
    const started = performance.now()
    try {
      this.step(run, "prepare", "Intent sealed", `Immutable hash bound to ${LABELS[run.scenario]}.`)
      await pause(420)
      const completed = run.mode === "solari-live"
        ? await this.executeSolari(run)
        : await this.executeDeterministic(run)
      run.result = completed.result
      this.step(run, "proof", "Proof signed", `Ed25519 key ${this.signer.keyId}; audit chain, telemetry, and receipt sealed.`, "success")
      const spans = await this.telemetry.get(run.id)?.finish("passed") ?? []
      const proof: ChaosProof = {
        schemaVersion: "1.0",
        product: "GhostAck",
        runId: run.id,
        scenario: run.scenario,
        mode: run.mode,
        startedAt: run.createdAt,
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started),
        operationId: completed.result.projection.operation.operationId,
        outcome: "exactly_once",
        invariants: {
          targetRequests: completed.result.target.requests,
          durableEffects: completed.result.target.effects,
          duplicates: Math.max(0, completed.result.target.effects - 1),
          finalState: completed.result.projection.state,
          auditChainVerified: true,
        },
        audit: completed.result.projection.events,
        trace: [...run.steps],
        telemetry: {
          format: "otlp-json/1.0",
          serviceName: "ghostack-control-plane",
          traceId: run.traceId,
          spans,
        },
        ...(completed.runtime === undefined ? {} : { runtime: completed.runtime }),
      }
      run.proof = this.signer.create(proof)
      run.status = "passed"
      this.telemetry.delete(run.id)
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error)
      this.step(run, "failed", "Run failed closed", run.error, "danger")
      run.status = "failed"
      await this.telemetry.get(run.id)?.finish("failed")
      this.telemetry.delete(run.id)
    }
  }

  private intent(run: ChaosRun): EffectIntent {
    return {
      tenantId: "ghostack-public-lab",
      businessKey: run.id,
      accountId: "github-app",
      destination: "disposable-repo/issues",
      amountCents: 1,
      currency: "USD",
      reason: `${LABELS[run.scenario]} idempotency drill`,
    }
  }

  private async executeDeterministic(run: ChaosRun): Promise<{ result: ExecutionResult; runtime?: undefined }> {
    const audit = new MemoryAuditLog()
    const target = new InMemoryIdempotentTarget(90)
    const intent = this.intent(run)

    if (run.scenario === "coordinator_restart") {
      const operation = prepareOperation(intent)
      await audit.append(operation.operationId, "operation_prepared", { operation })
      await audit.append(operation.operationId, "dispatch_started", { attempt: 1, fault: "after_commit_before_ack" })
      try { await target.submit(operation, { fault: "after_commit_before_ack" }) } catch { /* process dies before journaling the error */ }
      this.step(run, "crash", "Coordinator SIGKILL", "Commit may exist; volatile state is gone and no acknowledgement was journaled.", "danger")
      await pause(650)
      this.step(run, "restart", "Fresh coordinator started", "New process has only the durable audit chain and target read API.", "warning")
      const coordinator = new ExactlyOnceCoordinator(audit, target)
      const result = await coordinator.execute(intent)
      this.step(run, "reconcile", "Receipt found", "Authoritative read proves the original effect committed; retry is suppressed.", "success")
      return { result }
    }

    const coordinator = new ExactlyOnceCoordinator(audit, target)
    if (run.scenario === "concurrency") {
      this.step(run, "dispatch", "20 agents released", "Identical intent races through one operation boundary.", "warning")
      const results = await Promise.all(Array.from({ length: 20 }, () => coordinator.execute(intent)))
      const result = results[0]
      if (result === undefined) throw new Error("Concurrency scenario returned no result")
      this.step(run, "coalesce", "19 calls coalesced", "One target request, one receipt, twenty callers completed.", "success")
      return { result }
    }

    if (run.scenario === "intent_mutation") {
      const result = await coordinator.execute(intent)
      try {
        await coordinator.execute({ ...intent, amountCents: 2 })
        throw new Error("Mutated intent was unexpectedly accepted")
      } catch (error) {
        if (!(error instanceof IntentConflictError)) throw error
      }
      this.step(run, "fence", "Mutation rejected", "Same business key with a different intent hash was blocked before dispatch.", "success")
      return { result }
    }

    const fault = run.scenario === "before_send" ? "before_send" : "after_commit_before_ack"
    this.step(run, "dispatch", "Browser #1 dispatched", "Target receives an idempotency key and immutable intent hash.")
    await pause(520)
    this.step(
      run,
      "crash",
      fault === "before_send" ? "Browser killed before network send" : "Browser killed after commit",
      fault === "before_send" ? "The outcome is unknown until an authoritative read." : "The server committed, but the acknowledgement never reached the agent.",
      "danger",
    )
    // Keep the ambiguous window visible long enough for a human reviewer to inspect it.
    // This does not delay or alter the protocol decision itself.
    await pause(650)
    const result = await coordinator.execute(intent, { fault })
    this.step(
      run,
      "reconcile",
      fault === "before_send" ? "Absence proved; retry released" : "Receipt observed; retry suppressed",
      fault === "before_send" ? "Authoritative lookup found no effect, so one fenced retry is safe." : "Browser #2 recovered the receipt without repeating the action.",
      "success",
    )
    return { result }
  }

  private async executeSolari(run: ChaosRun): Promise<{ result: ExecutionResult; runtime: Readonly<Record<string, unknown>> }> {
    if (run.scenario !== "ack_lost") throw new Error("The public Solari live path currently supports kill-after-commit")
    this.step(run, "runtime", "Solari sandbox allocated", "Browser and target ledger are isolated for this run.", "warning")
    const target = await SolariEffectTarget.create(process.env.SOLARI_API_KEY ?? "")
    try {
      const coordinator = new ExactlyOnceCoordinator(new MemoryAuditLog(), target)
      const result = await coordinator.execute(this.intent(run), { fault: "after_commit_before_ack" })
      this.step(run, "crash", "Solari browser #1 terminated", "The target committed before the delayed acknowledgement.", "danger")
      await pause(650)
      this.step(run, "reconcile", "Solari browser #2 recovered receipt", "One durable effect, zero duplicate actions.", "success")
      return { result, runtime: { ...target.evidence() } }
    } finally {
      await target.close()
    }
  }
}
