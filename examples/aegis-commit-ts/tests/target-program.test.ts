import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { describe, it } from "node:test"

import { TARGET_PROGRAM } from "../src/adapters/solari-target-program.js"

async function nextLine(stream: NodeJS.ReadableStream): Promise<string> {
  let text = ""
  for await (const chunk of stream) {
    text += String(chunk)
    const newline = text.indexOf("\n")
    if (newline >= 0) return text.slice(0, newline)
  }
  throw new Error("Target exited before announcing its port.")
}

describe("sandbox target protocol", () => {
  it("deduplicates retries and rejects a mutated intent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aegis-target-"))
    const program = join(directory, "target.mjs")
    await writeFile(program, TARGET_PROGRAM)
    const child = spawn(process.execPath, [program], {
      env: { ...process.env, PORT: "0", AEGIS_STATE_PATH: join(directory, "state.json") },
      stdio: ["ignore", "pipe", "pipe"],
    })
    try {
      assert.ok(child.stdout)
      const line = await nextLine(child.stdout)
      const port = Number(line.split(":").at(-1))
      assert.ok(Number.isInteger(port) && port > 0)
      const origin = `http://127.0.0.1:${port}`
      const payload = {
        idempotencyKey: `aeg_${"1".repeat(32)}`,
        intentHash: "2".repeat(64),
        amountCents: 1_250,
      }
      const submit = () =>
        fetch(`${origin}/api/effects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
      assert.equal((await submit()).status, 200)
      assert.equal((await submit()).status, 200)

      const conflict = await fetch(`${origin}/api/effects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, amountCents: 9_999 }),
      })
      assert.equal(conflict.status, 409)

      const stats = (await (await fetch(`${origin}/api/stats`)).json()) as {
        requests: number
        effects: number
      }
      assert.deepEqual(stats, { requests: 3, effects: 1 })
    } finally {
      child.kill("SIGTERM")
      await once(child, "exit")
      await rm(directory, { recursive: true, force: true })
    }
  })
})
