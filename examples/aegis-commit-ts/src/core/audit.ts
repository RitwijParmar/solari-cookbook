import { mkdir, open, readFile } from "node:fs/promises"
import { dirname } from "node:path"

import { AuditIntegrityError } from "./errors.js"
import { hashObject } from "./hash.js"
import type { AuditEvent, AuditEventType } from "./types.js"

const GENESIS_HASH = "0".repeat(64)

export interface AuditLog {
  append(
    operationId: string,
    type: AuditEventType,
    payload?: Readonly<Record<string, unknown>>,
  ): Promise<AuditEvent>
  list(operationId?: string): Promise<readonly AuditEvent[]>
}

function eventHash(event: Omit<AuditEvent, "hash">): string {
  return hashObject(event)
}

export function verifyAuditChain(events: readonly AuditEvent[]): void {
  let previousHash = GENESIS_HASH
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1) {
      throw new AuditIntegrityError(`Audit sequence jumps at event ${index + 1}.`)
    }
    if (event.previousHash !== previousHash) {
      throw new AuditIntegrityError(`Audit predecessor mismatch at event ${event.sequence}.`)
    }
    const { hash: _hash, ...unsigned } = event
    if (eventHash(unsigned) !== event.hash) {
      throw new AuditIntegrityError(`Audit hash mismatch at event ${event.sequence}.`)
    }
    previousHash = event.hash
  }
}

abstract class SerialAuditLog implements AuditLog {
  private tail: Promise<unknown> = Promise.resolve()

  async append(
    operationId: string,
    type: AuditEventType,
    payload: Readonly<Record<string, unknown>> = {},
  ): Promise<AuditEvent> {
    const task = this.tail.then(async () => {
      const events = [...(await this.readAll())]
      verifyAuditChain(events)
      const unsigned: Omit<AuditEvent, "hash"> = {
        sequence: events.length + 1,
        operationId,
        type,
        at: new Date().toISOString(),
        payload,
        previousHash: events.at(-1)?.hash ?? GENESIS_HASH,
      }
      const event: AuditEvent = { ...unsigned, hash: eventHash(unsigned) }
      await this.persist(event)
      return event
    })
    this.tail = task.catch(() => undefined)
    return task
  }

  async list(operationId?: string): Promise<readonly AuditEvent[]> {
    await this.tail
    const events = [...(await this.readAll())]
    verifyAuditChain(events)
    return operationId === undefined
      ? events
      : events.filter((event) => event.operationId === operationId)
  }

  protected abstract readAll(): Promise<readonly AuditEvent[]>
  protected abstract persist(event: AuditEvent): Promise<void>
}

export class MemoryAuditLog extends SerialAuditLog {
  private readonly events: AuditEvent[] = []

  protected override async readAll(): Promise<readonly AuditEvent[]> {
    return this.events
  }

  protected override async persist(event: AuditEvent): Promise<void> {
    this.events.push(event)
  }
}

export class DurableAuditLog extends SerialAuditLog {
  constructor(private readonly path: string) {
    super()
  }

  protected override async readAll(): Promise<readonly AuditEvent[]> {
    let text: string
    try {
      text = await readFile(this.path, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEvent)
  }

  protected override async persist(event: AuditEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const file = await open(this.path, "a", 0o600)
    try {
      await file.write(`${JSON.stringify(event)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
  }
}
