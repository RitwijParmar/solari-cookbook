import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import pg from "pg"

import { InMemoryIdempotentTarget } from "../src/adapters/in-memory-target.js"
import { PostgresAuditLog } from "../src/adapters/postgres-audit.js"
import { ExactlyOnceCoordinator } from "../src/core/coordinator.js"
import { prepareOperation } from "../src/core/operation.js"
import type { EffectIntent } from "../src/core/types.js"

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl === undefined ? describe.skip : describe
const pool = databaseUrl === undefined ? undefined : new pg.Pool({ connectionString: databaseUrl })

suite("PostgreSQL crash journal", () => {
  before(async () => {
    if (pool === undefined) return
    await pool.query("DROP TABLE IF EXISTS ghostack_audit")
    await new PostgresAuditLog(pool).migrate()
  })

  after(async () => { await pool?.end() })

  it("persists and reconstructs a hash-chained operation", async () => {
    if (pool === undefined) return
    const firstProcess = new PostgresAuditLog(pool)
    await firstProcess.append("op_restart", "operation_prepared", { marker: "before-crash" })
    const restartedProcess = new PostgresAuditLog(pool)
    await restartedProcess.append("op_restart", "dispatch_started", { process: 2 })
    const events = await restartedProcess.list("op_restart")
    assert.deepEqual(events.map((event) => event.type), ["operation_prepared", "dispatch_started"])
    assert.equal(events[1]?.previousHash, events[0]?.hash)
  })

  it("recovers an ambiguous committed effect after replacing the coordinator", async () => {
    if (pool === undefined) return
    await pool.query("DROP TABLE ghostack_audit")
    const beforeCrash = new PostgresAuditLog(pool)
    await beforeCrash.migrate()
    const target = new InMemoryIdempotentTarget()
    const intent: EffectIntent = {
      tenantId: "postgres-integration",
      businessKey: "restart-boundary",
      accountId: "github-app",
      destination: "disposable-repo/issues",
      amountCents: 1,
      currency: "USD",
      reason: "database-backed coordinator restart",
    }
    const operation = prepareOperation(intent)
    await beforeCrash.append(operation.operationId, "operation_prepared", { operation })
    await beforeCrash.append(operation.operationId, "dispatch_started", { attempt: 1 })
    try { await target.submit(operation, { fault: "after_commit_before_ack" }) } catch { /* coordinator dies */ }

    const afterRestart = new PostgresAuditLog(pool)
    const recovered = await new ExactlyOnceCoordinator(afterRestart, target).execute(intent)
    assert.equal(recovered.projection.state, "committed")
    assert.equal(recovered.target.effects, 1)
    assert.equal(recovered.duplicatePrevented, true)
    assert.ok(recovered.projection.events.some((event) => event.type === "effect_observed"))
  })
})
