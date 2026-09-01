import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { AuditEvent, ExecutionResult } from "./core/types.js"

export interface DemoCase {
  readonly name: string
  readonly fault: string
  readonly result: ExecutionResult
  readonly durationMs: number
}

export interface DemoEvidence {
  readonly schemaVersion: "1.0"
  readonly product: "GhostAck"
  readonly generatedAt: string
  readonly mode: "deterministic" | "solari-live"
  readonly guarantee: string
  readonly runtime: {
    readonly provider: "in-process" | "solari"
    readonly sandboxFingerprint?: string
    readonly previewHost?: string
    readonly browserSessionFingerprints: readonly string[]
  }
  readonly cases: readonly DemoCase[]
  readonly audit: readonly AuditEvent[]
  readonly benchmark: {
    readonly operations: number
    readonly injectedAmbiguousOutcomes: number
    readonly duplicateEffects: number
    readonly p50Ms: number
    readonly p95Ms: number
  }
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

export function benchmarkSummary(
  durations: readonly number[],
  injectedAmbiguousOutcomes: number,
  duplicateEffects: number,
): DemoEvidence["benchmark"] {
  return {
    operations: durations.length,
    injectedAmbiguousOutcomes,
    duplicateEffects,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

function reportHtml(evidence: DemoEvidence): string {
  const fourthMetric =
    evidence.mode === "solari-live"
      ? { value: `${evidence.cases[0]?.durationMs ?? 0}ms`, label: "live crash recovery" }
      : { value: `${evidence.benchmark.p95Ms}ms`, label: "p95 recovery" }
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>GhostAck — verified run</title>
  <style>
    :root{color-scheme:dark;--bg:#07100d;--panel:#0d1814;--line:#243b31;--ink:#f0f7f3;--muted:#92a99e;--green:#63f2ad;--amber:#ffc96b;--red:#ff7a85}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#173326 0,transparent 38%),var(--bg);color:var(--ink);font:15px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}.shell{max-width:1180px;margin:auto;padding:44px 24px 72px}header{display:grid;grid-template-columns:1.6fr 1fr;gap:34px;align-items:end;border-bottom:1px solid var(--line);padding-bottom:30px}.eyebrow{color:var(--green);letter-spacing:.18em;text-transform:uppercase;font-size:12px}h1{font:700 clamp(42px,8vw,90px)/.95 Inter,ui-sans-serif,sans-serif;letter-spacing:-.06em;margin:14px 0}.lede{font-size:18px;color:#c7d8d0;max-width:720px}.seal{border:1px solid var(--green);padding:18px;color:var(--green);text-align:center}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.metric,.card{background:linear-gradient(145deg,#101e18,#0a1410);border:1px solid var(--line);border-radius:10px}.metric{padding:20px}.metric strong{display:block;font-size:30px;color:var(--green)}.metric span{color:var(--muted);font-size:12px;text-transform:uppercase}.card{padding:22px;margin-top:14px}.case-head{display:flex;justify-content:space-between;gap:20px}.case-head b{font-size:18px}.ok{color:var(--green)}.unknown{color:var(--amber)}.timeline{display:grid;grid-template-columns:36px 1fr;gap:0 12px;margin-top:18px}.dot{width:11px;height:11px;border-radius:50%;background:var(--green);margin-top:7px;box-shadow:0 0 18px #63f2ad88}.event{border-left:1px solid var(--line);padding:0 0 18px 18px}.event code{color:var(--green)}.event small{display:block;color:var(--muted)}footer{color:var(--muted);margin-top:34px}.flag{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:4px 10px;margin:3px;color:#bad0c5}@media(max-width:760px){header{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,1fr)}}
  </style>
</head>
<body><main class="shell">
  <header><div><div class="eyebrow">Crash-consistent browser operations</div><h1>Aegis<br>Commit</h1><p class="lede">Crash after commit. Recover without doing it twice. Every state transition below came from the tamper-evident audit chain of this run.</p></div><div class="seal">VERIFIED RUN<br>${evidence.mode.toUpperCase()}<br>${evidence.generatedAt}</div></header>
  <section class="grid"><div class="metric"><strong>${evidence.benchmark.operations}</strong><span>deterministic schedules</span></div><div class="metric"><strong>${evidence.benchmark.injectedAmbiguousOutcomes}</strong><span>simulated unknowns</span></div><div class="metric"><strong>${evidence.benchmark.duplicateEffects}</strong><span>duplicate effects</span></div><div class="metric"><strong>${fourthMetric.value}</strong><span>${fourthMetric.label}</span></div></section>
  <section class="card"><div class="eyebrow">Runtime evidence</div><p><b>${evidence.runtime.provider}</b>${evidence.runtime.sandboxFingerprint ? ` · sandbox fingerprint ${evidence.runtime.sandboxFingerprint}` : ""} · ${evidence.runtime.browserSessionFingerprints.length} browser sessions</p></section>
  <div id="cases"></div>
  <section class="card"><div class="eyebrow">Guarantee boundary</div><p>${evidence.guarantee}</p><span class="flag">write-ahead log</span><span class="flag">idempotency key</span><span class="flag">read-after-unknown</span><span class="flag">hash-chained evidence</span></section>
  <footer>GhostAck / Solari browser + sandbox / evidence schema ${evidence.schemaVersion}</footer>
</main><script>const data=${safeJson(evidence)};const root=document.querySelector('#cases');for(const item of data.cases){const el=document.createElement('section');el.className='card';const events=item.result.projection.events.map(e=>\`<div class="dot"></div><div class="event"><code>\${e.type}</code><small>#\${e.sequence} · \${e.hash.slice(0,12)}</small></div>\`).join('');el.innerHTML=\`<div class="case-head"><b>\${item.name}</b><span class="ok">effect count = \${item.result.target.effects}</span></div><p><span class="unknown">fault: \${item.fault}</span> · recovered: \${item.result.recovered} · duplicate prevented: \${item.result.duplicatePrevented} · \${item.durationMs}ms</p><div class="timeline">\${events}</div>\`;root.append(el)}</script></body></html>`
}

export async function writeEvidence(directory: string, evidence: DemoEvidence): Promise<void> {
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(join(directory, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`),
    writeFile(
      join(directory, "audit.jsonl"),
      `${evidence.audit.map((event) => JSON.stringify(event)).join("\n")}\n`,
    ),
    writeFile(join(directory, "index.html"), reportHtml(evidence)),
  ])
}
