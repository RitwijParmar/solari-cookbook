import { AmbiguousOutcomeError, IntentConflictError } from "../core/errors.js"
import { sha256 } from "../core/hash.js"
import type {
  EffectReceipt,
  EffectTarget,
  PreparedOperation,
  TargetStats,
} from "../core/types.js"

export class InMemoryIdempotentTarget implements EffectTarget {
  private readonly receipts = new Map<string, EffectReceipt>()
  private requestCount = 0
  private effectCount = 0

  constructor(private readonly latencyMs = 0) {}

  async submit(
    operation: PreparedOperation,
    options: { readonly fault: "none" | "before_send" | "after_commit_before_ack" },
  ): Promise<EffectReceipt> {
    if (options.fault === "before_send") {
      throw new AmbiguousOutcomeError(
        "Browser process terminated before dispatch acknowledgement.",
        "before_send",
      )
    }
    this.requestCount += 1
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs))
    }

    const existing = this.receipts.get(operation.idempotencyKey)
    let receipt: EffectReceipt
    if (existing !== undefined) {
      if (existing.intentHash !== operation.intentHash) {
        throw new IntentConflictError("Idempotency key was reused with a different intent.")
      }
      receipt = existing
    } else {
      this.effectCount += 1
      receipt = {
        receiptId: `rcpt_${sha256(operation.idempotencyKey).slice(0, 20)}`,
        idempotencyKey: operation.idempotencyKey,
        intentHash: operation.intentHash,
        committedAt: new Date().toISOString(),
        amountCents: operation.intent.amountCents,
      }
      this.receipts.set(operation.idempotencyKey, receipt)
    }

    if (options.fault === "after_commit_before_ack") {
      throw new AmbiguousOutcomeError(
        "Browser process terminated after the server committed but before acknowledgement.",
        "after_commit_before_ack",
      )
    }
    return receipt
  }

  async lookup(operation: PreparedOperation): Promise<EffectReceipt | null> {
    const receipt = this.receipts.get(operation.idempotencyKey) ?? null
    if (receipt !== null && receipt.intentHash !== operation.intentHash) {
      throw new IntentConflictError("Observed receipt belongs to another intent.")
    }
    return receipt
  }

  async stats(): Promise<TargetStats> {
    return { requests: this.requestCount, effects: this.effectCount }
  }
}
