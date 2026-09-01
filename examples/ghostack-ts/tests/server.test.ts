import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { after, before, describe, it } from "node:test"

import { createGhostAckServer } from "../src/server.js"

const server = createGhostAckServer()
let base = ""

describe("public HTTP boundary", () => {
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address() as AddressInfo
    base = `http://127.0.0.1:${address.port}`
  })

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))
  })

  it("serves the product and security headers for GET and HEAD", async () => {
    const page = await fetch(`${base}/`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/)
    assert.equal(page.headers.get("cache-control"), "no-store")
    assert.match(await page.text(), /Kill the browser/)
    const head = await fetch(`${base}/`, { method: "HEAD" })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), "")
    const script = await fetch(`${base}/app.js`)
    assert.equal(script.headers.get("cache-control"), "no-store")
  })

  it("returns bounded errors without exposing parser internals", async () => {
    const malformed = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad",
    })
    assert.equal(malformed.status, 400)
    assert.deepEqual(await malformed.json(), { error: "Request body must be valid JSON.", code: "invalid_json" })

    const wrongType = await fetch(`${base}/api/runs`, { method: "POST", body: "{}" })
    assert.equal(wrongType.status, 415)
    const wrongMethod = await fetch(`${base}/api/runs`, { method: "PUT" })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get("allow"), "GET, POST")
  })

  it("rejects impossible live-mode combinations synchronously", async () => {
    const response = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "concurrency", live: true }),
    })
    assert.equal(response.status, 400)
    assert.equal((await response.json() as { code: string }).code, "unsupported_live_scenario")
  })

  it("reports proof readiness explicitly, then serves the completed artifact", async () => {
    const created = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "ack_lost", live: false }),
    }).then((response) => response.json()) as { id: string }
    const early = await fetch(`${base}/api/runs/${created.id}/proof`)
    assert.equal(early.status, 409)
    let completed = false
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      const run = await fetch(`${base}/api/runs/${created.id}`).then((response) => response.json()) as { status: string }
      if (run.status === "passed") { completed = true; break }
    }
    assert.equal(completed, true)
    const proof = await fetch(`${base}/api/runs/${created.id}/proof`)
    assert.equal(proof.status, 200)
    assert.match(proof.headers.get("content-disposition") ?? "", /attachment; filename=ghostack-/)
  })

  it("bounds anonymous run creation and returns retry guidance", async () => {
    let response: Response | undefined
    for (let attempt = 0; attempt < 21; attempt += 1) {
      response = await fetch(`${base}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.77" },
        body: JSON.stringify({ scenario: "unknown" }),
      })
    }
    assert.equal(response?.status, 429)
    assert.ok(Number(response?.headers.get("retry-after")) > 0)
    const payload = await response?.json() as { code: string; retryAfterSeconds: number }
    assert.equal(payload.code, "rate_limited")
    assert.ok(payload.retryAfterSeconds > 0)
  })
})
