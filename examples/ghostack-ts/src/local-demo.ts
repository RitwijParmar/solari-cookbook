import { performance } from "node:perf_hooks"

import { InMemoryIdempotentTarget } from "./adapters/in-memory-target.js"
import { MemoryAuditLog } from "./core/audit.js"
import { ExactlyOnceCoordinator } from "./core/coordinator.js"
import type { EffectIntent, FaultPoint } from "./core/types.js"
import { benchmarkSummary, type DemoCase, type DemoEvidence } from "./evidence.js"

function intent(businessKey: string): EffectIntent {
  return {
    tenantId: "pinetree-research",
    businessKey,
    accountId: "treasury-ops",
    destination: "vendor-8042",
    amountCents: 48_725,
    currency: "USD",
    reason: "approved infrastructure invoice",
  }
}

async function runCase(name: string, fault: FaultPoint, businessKey: string): Promise<DemoCase> {
  const audit = new MemoryAuditLog()
  const target = new InMemoryIdempotentTarget(2)
  const coordinator = new ExactlyOnceCoordinator(audit, target)
  const started = performance.now()
  const result = await coordinator.execute(intent(businessKey), { fault })
  return { name, fault, result, durationMs: Math.round(performance.now() - started) }
}

export async function runLocalDemo(benchmarkOperations = 100): Promise<DemoEvidence> {
  const cases = await Promise.all([
    runCase("Acknowledgement lost after server commit", "after_commit_before_ack", "invoice-8042"),
    runCase("Browser dies before request leaves", "before_send", "invoice-8043"),
    runCase("Normal acknowledgement", "none", "invoice-8044"),
  ])

  const durations: number[] = []
  let ambiguous = 0
  let duplicateEffects = 0
  for (let index = 0; index < benchmarkOperations; index += 1) {
    const fault: FaultPoint =
      index % 3 === 0
        ? "after_commit_before_ack"
        : index % 3 === 1
          ? "before_send"
          : "none"
    if (fault !== "none") ambiguous += 1
    const result = await runCase(`fault-${index}`, fault, `benchmark-${index}`)
    durations.push(result.durationMs)
    duplicateEffects += Math.max(0, result.result.target.effects - 1)
  }

  return {
    schemaVersion: "1.0",
    product: "GhostAck",
    generatedAt: new Date().toISOString(),
    mode: "deterministic",
    guarantee:
      "Exactly-once requires either target-side idempotency or an authoritative reconciliation read. Aegis refuses to claim the guarantee when neither primitive exists.",
    runtime: { provider: "in-process", browserSessionFingerprints: [] },
    cases,
    audit: cases.flatMap((item) => item.result.projection.events),
    benchmark: benchmarkSummary(durations, ambiguous, duplicateEffects),
  }
}
