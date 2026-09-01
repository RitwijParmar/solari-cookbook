import type { Pool, PoolClient } from "pg"

import type { AuditLog } from "../core/audit.js"
import { verifyAuditChain } from "../core/audit.js"
import { hashObject } from "../core/hash.js"
import type { AuditEvent, AuditEventType } from "../core/types.js"

const GENESIS_HASH = "0".repeat(64)

export class PostgresAuditLog implements AuditLog {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ghostack_audit (
        sequence BIGSERIAL PRIMARY KEY,
        operation_id TEXT NOT NULL,
        type TEXT NOT NULL,
        at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        previous_hash TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE
      )
    `)
    await this.pool.query("CREATE INDEX IF NOT EXISTS ghostack_audit_operation_idx ON ghostack_audit(operation_id, sequence)")
  }

  async append(
    operationId: string,
    type: AuditEventType,
    payload: Readonly<Record<string, unknown>> = {},
  ): Promise<AuditEvent> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT pg_advisory_xact_lock(714039281)")
      const rows = await this.read(client)
      verifyAuditChain(rows)
      const unsigned: Omit<AuditEvent, "hash"> = {
        sequence: rows.length + 1,
        operationId,
        type,
        at: new Date().toISOString(),
        payload,
        previousHash: rows.at(-1)?.hash ?? GENESIS_HASH,
      }
      const event: AuditEvent = { ...unsigned, hash: hashObject(unsigned) }
      await client.query(
        `INSERT INTO ghostack_audit(sequence, operation_id, type, at, payload, previous_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [event.sequence, event.operationId, event.type, event.at, JSON.stringify(event.payload), event.previousHash, event.hash],
      )
      await client.query("COMMIT")
      return event
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async list(operationId?: string): Promise<readonly AuditEvent[]> {
    const rows = await this.read(this.pool)
    verifyAuditChain(rows)
    return operationId === undefined ? rows : rows.filter((event) => event.operationId === operationId)
  }

  private async read(
    client: Pick<PoolClient, "query"> | Pool,
  ): Promise<AuditEvent[]> {
    const result = await client.query("SELECT * FROM ghostack_audit ORDER BY sequence")
    return result.rows.map((row: Record<string, unknown>) => ({
      sequence: Number(row.sequence),
      operationId: String(row.operation_id),
      type: String(row.type) as AuditEventType,
      at: new Date(String(row.at)).toISOString(),
      payload: row.payload as Readonly<Record<string, unknown>>,
      previousHash: String(row.previous_hash),
      hash: String(row.hash),
    }))
  }
}
