import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { ChaosControlPlane, type ChaosRun, type Scenario } from "../src/control-plane.js"
import { verifySignedProof } from "../src/core/signing.js"

async function completed(control: ChaosControlPlane, scenario: Scenario): Promise<ChaosRun> {
  const created = control.create(scenario, false)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = control.get(created.id)
    if (run?.status === "passed" || run?.status === "failed") return run
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  throw new Error(`Timed out waiting for ${scenario}`)
}

describe("reviewer-triggered chaos control plane", () => {
  for (const scenario of ["ack_lost", "before_send", "coordinator_restart", "concurrency", "intent_mutation"] as const) {
    it(`passes ${scenario} with one effect and a verifiable proof`, async () => {
      const run = await completed(new ChaosControlPlane(), scenario)
      assert.equal(run.status, "passed", run.error)
      assert.equal(run.proof?.payload.invariants.durableEffects, 1)
      assert.equal(run.proof?.payload.invariants.duplicates, 0)
      assert.ok(run.proof !== undefined && verifySignedProof(run.proof))
    })
  }
})
