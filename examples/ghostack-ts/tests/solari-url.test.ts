import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { withAckDelay } from "../src/adapters/solari-target.js"

describe("Solari preview URL handling", () => {
  it("preserves signed preview parameters while adding the fault delay", () => {
    const result = new URL(
      withAckDelay("https://preview.example/run?token=signed-value&expires=123", 2_500),
    )

    assert.equal(result.searchParams.get("token"), "signed-value")
    assert.equal(result.searchParams.get("expires"), "123")
    assert.equal(result.searchParams.get("ackDelayMs"), "2500")
    assert.equal([...result.searchParams].length, 3)
  })
})
