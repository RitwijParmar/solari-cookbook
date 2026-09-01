import { resolve } from "node:path"

import { writeEvidence } from "./evidence.js"
import { runLocalDemo } from "./local-demo.js"
import { runSolariDemo } from "./solari-demo.js"

const [, , command = "demo"] = process.argv

if (command !== "demo") {
  throw new Error(`Unknown command ${command}. Expected: demo`)
}

const artifactDirectory = resolve(process.env.AEGIS_ARTIFACT_DIR ?? "evidence/latest")
const forceLocal = process.argv.includes("--local")
const apiKey = process.env.SOLARI_API_KEY
const evidence =
  forceLocal || apiKey === undefined
    ? await runLocalDemo()
    : await runSolariDemo(apiKey, artifactDirectory)
await writeEvidence(artifactDirectory, evidence)

console.log("GhostAck verified fault matrix")
console.log(`  operations       ${evidence.benchmark.operations}`)
console.log(`  unknown outcomes ${evidence.benchmark.injectedAmbiguousOutcomes}`)
console.log(`  duplicate effects ${evidence.benchmark.duplicateEffects}`)
console.log(`  report           ${artifactDirectory}/index.html`)
