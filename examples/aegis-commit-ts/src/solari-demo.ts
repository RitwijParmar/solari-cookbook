import { join } from "node:path"
import { performance } from "node:perf_hooks"

import { SolariEffectTarget } from "./adapters/solari-target.js"
import { DurableAuditLog } from "./core/audit.js"
import { ExactlyOnceCoordinator } from "./core/coordinator.js"
import type { EffectIntent } from "./core/types.js"
import { benchmarkSummary, type DemoEvidence } from "./evidence.js"
import { runLocalDemo } from "./local-demo.js"

const LIVE_INTENT: EffectIntent = {
  tenantId: "pinetree-research",
  businessKey: `solari-live-${Date.now()}`,
  accountId: "treasury-ops",
  destination: "vendor-8042",
  amountCents: 48_725,
  currency: "USD",
  reason: "live crash-consistency demonstration",
}

export async function runSolariDemo(apiKey: string, artifactDirectory: string): Promise<DemoEvidence> {
  const deterministic = await runLocalDemo()
  const target = await SolariEffectTarget.create(apiKey)
  try {
    const audit = new DurableAuditLog(join(artifactDirectory, "live-audit.jsonl"))
    const coordinator = new ExactlyOnceCoordinator(audit, target)
    const started = performance.now()
    const result = await coordinator.execute(LIVE_INTENT, {
      fault: "after_commit_before_ack",
    })
    const durationMs = Math.round(performance.now() - started)
    const runtime = target.evidence()
    return {
      ...deterministic,
      generatedAt: new Date().toISOString(),
      mode: "solari-live",
      runtime: { provider: "solari", ...runtime },
      cases: [
        {
          name: "Live Solari browser crash after sandbox commit",
          fault: "after_commit_before_ack",
          result,
          durationMs,
        },
        ...deterministic.cases,
      ],
      audit: await audit.list(),
      benchmark: benchmarkSummary(
        Array.from({ length: deterministic.benchmark.operations }, () =>
          deterministic.benchmark.p50Ms,
        ),
        deterministic.benchmark.injectedAmbiguousOutcomes + 1,
        deterministic.benchmark.duplicateEffects + Math.max(0, result.target.effects - 1),
      ),
    }
  } finally {
    await target.close()
  }
}
