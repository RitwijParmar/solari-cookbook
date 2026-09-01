import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { MemoryAuditLog, verifyAuditChain } from "../src/core/audit.js"
import { AuditIntegrityError } from "../src/core/errors.js"

describe("tamper-evident audit log", () => {
  it("verifies an intact hash chain", async () => {
    const audit = new MemoryAuditLog()
    await audit.append("op_test", "operation_prepared", { value: 1 })
    await audit.append("op_test", "dispatch_started", { value: 2 })
    const events = await audit.list()
    assert.doesNotThrow(() => verifyAuditChain(events))
  })

  it("rejects a modified event", async () => {
    const audit = new MemoryAuditLog()
    await audit.append("op_test", "operation_prepared", { value: 1 })
    const events = [...(await audit.list())]
    const original = events[0]
    assert.ok(original)
    const tampered = [{ ...original, payload: { value: 999 } }]
    assert.throws(() => verifyAuditChain(tampered), AuditIntegrityError)
  })
})
