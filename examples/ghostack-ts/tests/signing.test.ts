import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { EvidenceSigner, verifySignedProof } from "../src/core/signing.js"

describe("signed proof bundles", () => {
  it("verifies an intact Ed25519 proof and rejects a changed payload", () => {
    const signer = new EvidenceSigner()
    const proof = signer.create({ outcome: "exactly_once", effects: 1 })
    assert.equal(verifySignedProof(proof), true)
    assert.equal(verifySignedProof({ ...proof, payload: { ...proof.payload, effects: 2 } }), false)
  })
})
