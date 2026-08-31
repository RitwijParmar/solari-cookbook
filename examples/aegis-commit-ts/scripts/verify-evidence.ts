import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { verifyAuditChain } from "../src/core/audit.js"
import type { DemoEvidence } from "../src/evidence.js"

const directory = process.argv[2] ?? "evidence/latest"
const rawEvidence = await readFile(join(directory, "evidence.json"), "utf8")
const evidence = JSON.parse(rawEvidence) as DemoEvidence
const audit = (await readFile(join(directory, "live-audit.jsonl"), "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))

assert.equal(evidence.mode, "solari-live")
assert.equal(evidence.runtime.provider, "solari")
assert.equal(evidence.runtime.browserSessionFingerprints.length, 2)
assert.equal(new Set(evidence.runtime.browserSessionFingerprints).size, 2)
assert.equal(evidence.cases[0]?.result.recovered, true)
assert.equal(evidence.cases[0]?.result.target.effects, 1)
assert.equal(evidence.benchmark.duplicateEffects, 0)
assert.ok(!/slr_|pt_token=|browserSessionIds|sandboxId|previewUrl/.test(rawEvidence))
verifyAuditChain(audit)

console.log(`evidence-ok audit-events=${audit.length} browser-sessions=2 duplicate-effects=0`)
