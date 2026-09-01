import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

import { ChaosControlPlane, type Scenario } from "./control-plane.js"

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../public")
const control = new ChaosControlPlane()
const scenarios = new Set<Scenario>(["ack_lost", "before_send", "coordinator_restart", "concurrency", "intent_mutation"])
const mime: Readonly<Record<string, string>> = { ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" }

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })
  response.end(JSON.stringify(body))
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > 8_192) throw new Error("Request body too large")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
}

async function staticFile(pathname: string, response: ServerResponse): Promise<boolean> {
  const wanted = pathname === "/" ? "/index.html" : pathname
  const safe = normalize(wanted).replace(/^(\.\.(\/|\\|$))+/, "")
  const path = join(root, safe)
  if (!path.startsWith(root)) return false
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
    response.writeHead(200, {
      "Content-Type": mime[extname(path)] ?? (extname(path) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream"),
      "Cache-Control": extname(path) === ".html" ? "no-cache" : "public, max-age=3600",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    })
    createReadStream(path).pipe(response)
    return true
  } catch { return false }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
    if (request.method === "GET" && url.pathname === "/ready") return json(response, 200, { status: "ready", product: "GhostAck", liveSolari: process.env.SOLARI_API_KEY !== undefined })
    if (request.method === "GET" && url.pathname === "/api/runs") return json(response, 200, { runs: control.list() })
    if (request.method === "POST" && url.pathname === "/api/runs") {
      const input = await body(request)
      if (typeof input.scenario !== "string" || !scenarios.has(input.scenario as Scenario)) return json(response, 400, { error: "Unknown scenario" })
      const run = control.create(input.scenario as Scenario, input.live === true)
      return json(response, 202, run)
    }
    const runMatch = /^\/api\/runs\/([a-zA-Z0-9_]+)$/.exec(url.pathname)
    if (request.method === "GET" && runMatch?.[1] !== undefined) {
      const run = control.get(runMatch[1])
      return run === undefined ? json(response, 404, { error: "Run not found" }) : json(response, 200, run)
    }
    const proofMatch = /^\/api\/runs\/([a-zA-Z0-9_]+)\/proof$/.exec(url.pathname)
    if (request.method === "GET" && proofMatch?.[1] !== undefined) {
      const run = control.get(proofMatch[1])
      if (run?.proof === undefined) return json(response, 404, { error: "Proof is not ready" })
      response.setHeader("Content-Disposition", `attachment; filename=ghostack-${run.id}-proof.json`)
      return json(response, 200, run.proof)
    }
    if (request.method === "GET" && await staticFile(url.pathname, response)) return
    json(response, 404, { error: "Not found" })
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : "Internal error" })
  }
})

const port = Number.parseInt(process.env.PORT ?? "8080", 10)
server.listen(port, "0.0.0.0", () => process.stdout.write(`GhostAck control plane listening on ${port}\n`))

void readFile(join(root, "index.html"))
