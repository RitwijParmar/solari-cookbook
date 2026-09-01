import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import pg from "pg"

import { PostgresAuditLog } from "../src/adapters/postgres-audit.js"

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
})
