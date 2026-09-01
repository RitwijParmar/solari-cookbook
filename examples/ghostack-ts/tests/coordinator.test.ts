import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { InMemoryIdempotentTarget } from "../src/adapters/in-memory-target.js"
import { MemoryAuditLog } from "../src/core/audit.js"
import { ExactlyOnceCoordinator } from "../src/core/coordinator.js"
import { IntentConflictError } from "../src/core/errors.js"
import type { EffectIntent } from "../src/core/types.js"

function intent(overrides: Partial<EffectIntent> = {}): EffectIntent {
  return {
    tenantId: "test-tenant",
    businessKey: "invoice-42",
    accountId: "operations",
    destination: "vendor-7",
    amountCents: 12_500,
    currency: "USD",
    reason: "test invoice",
    ...overrides,
  }
}

describe("ExactlyOnceCoordinator", () => {
  it("recovers an effect committed before acknowledgement without repeating it", async () => {
    const target = new InMemoryIdempotentTarget()
    const coordinator = new ExactlyOnceCoordinator(new MemoryAuditLog(), target)

    const result = await coordinator.execute(intent(), { fault: "after_commit_before_ack" })

    assert.equal(result.projection.state, "committed")
    assert.equal(result.target.requests, 1)
    assert.equal(result.target.effects, 1)
    assert.equal(result.recovered, true)
    assert.equal(result.duplicatePrevented, true)
    assert.deepEqual(
      result.projection.events.map((event) => event.type),
      [
        "operation_prepared",
        "dispatch_started",
        "outcome_unknown",
        "reconciliation_started",
        "effect_observed",
        "effect_committed",
      ],
    )
  })

  it("retries only after an authoritative read proves no effect exists", async () => {
    const target = new InMemoryIdempotentTarget()
    const coordinator = new ExactlyOnceCoordinator(new MemoryAuditLog(), target)

    const result = await coordinator.execute(intent(), { fault: "before_send" })

    assert.equal(result.target.requests, 1)
    assert.equal(result.target.effects, 1)
    assert.equal(result.projection.state, "committed")
    assert.ok(result.projection.events.some((event) => event.type === "retry_approved"))
  })

  it("coalesces concurrent callers into one target request", async () => {
    const target = new InMemoryIdempotentTarget(20)
    const coordinator = new ExactlyOnceCoordinator(new MemoryAuditLog(), target)

    const results = await Promise.all(
      Array.from({ length: 20 }, () => coordinator.execute(intent({ businessKey: "burst" }))),
    )

    assert.equal((await target.stats()).requests, 1)
    assert.equal((await target.stats()).effects, 1)
    assert.ok(results.every((result) => result.projection.receipt?.receiptId === results[0]?.projection.receipt?.receiptId))
  })

  it("rejects reuse of a business key with a mutated intent", async () => {
    const target = new InMemoryIdempotentTarget()
    const coordinator = new ExactlyOnceCoordinator(new MemoryAuditLog(), target)
    await coordinator.execute(intent())

    await assert.rejects(
      coordinator.execute(intent({ amountCents: 99_999 })),
      IntentConflictError,
    )
    assert.equal((await target.stats()).effects, 1)
  })

  it("makes a completed operation replay-safe", async () => {
    const target = new InMemoryIdempotentTarget()
    const coordinator = new ExactlyOnceCoordinator(new MemoryAuditLog(), target)
    const first = await coordinator.execute(intent())
    const replay = await coordinator.execute(intent())

    assert.equal(first.projection.receipt?.receiptId, replay.projection.receipt?.receiptId)
    assert.equal((await target.stats()).requests, 1)
    assert.equal(replay.duplicatePrevented, true)
  })
})
