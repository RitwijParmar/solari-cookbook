import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

import { ChaosControlPlane, ControlPlaneError, type Scenario } from "./control-plane.js"

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../public")
const scenarios = new Set<Scenario>(["ack_lost", "before_send", "coordinator_restart", "concurrency", "intent_mutation"])
const mime: Readonly<Record<string, string>> = { ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" }

class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

class SlidingWindowLimiter {
  private readonly requests = new Map<string, number[]>()

  check(key: string, limit = 20, windowMs = 60_000): number | null {
    const now = Date.now()
    const current = (this.requests.get(key) ?? []).filter((at) => now - at < windowMs)
    if (current.length >= limit) {
      this.requests.set(key, current)
      return Math.max(1, Math.ceil((windowMs - (now - (current[0] ?? now))) / 1_000))
    }
    current.push(now)
    this.requests.set(key, current)
    if (this.requests.size > 1_000) {
      for (const [candidate, entries] of this.requests) {
        if (entries.every((at) => now - at >= windowMs)) this.requests.delete(candidate)
      }
    }
    return null
  }
}

function json(response: ServerResponse, status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers })
  response.end(JSON.stringify(body))
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError("Content-Type must be application/json.", 415, "unsupported_media_type")
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > 8_192) throw new HttpError("Request body exceeds 8 KiB.", 413, "request_too_large")
    chunks.push(buffer)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } catch {
    throw new HttpError("Request body must be valid JSON.", 400, "invalid_json")
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new HttpError("Request body must be a JSON object.", 400, "invalid_body")
  }
  return parsed as Record<string, unknown>
}

async function staticFile(pathname: string, method: string | undefined, response: ServerResponse): Promise<boolean> {
  const wanted = pathname === "/" ? "/index.html" : pathname
  const safe = normalize(wanted).replace(/^(\.\.(\/|\\|$))+/, "")
  const path = join(root, safe)
  if (!path.startsWith(root)) return false
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
    response.writeHead(200, {
      "Content-Type": mime[extname(path)] ?? (extname(path) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream"),
      "Cache-Control": [".html", ".js", ".css"].includes(extname(path)) ? "no-store" : "public, max-age=3600, immutable",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    })
    if (method === "HEAD") response.end()
    else createReadStream(path).pipe(response)
    return true
  } catch { return false }
}

export function createGhostAckServer(control = new ChaosControlPlane()): Server {
  const limiter = new SlidingWindowLimiter()
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
      const method = request.method ?? "GET"
      if ((method === "GET" || method === "HEAD") && url.pathname === "/ready") {
        if (method === "HEAD") return json(response, 200, {})
        return json(response, 200, { status: "ready", product: "GhostAck", liveSolari: process.env.SOLARI_API_KEY !== undefined })
      }
      if (method === "GET" && url.pathname === "/api/runs") return json(response, 200, { runs: control.list() })
      if (method === "POST" && url.pathname === "/api/runs") {
        const forwardedHeader = request.headers["x-forwarded-for"]
        const forwardedText = Array.isArray(forwardedHeader) ? forwardedHeader.at(-1) : forwardedHeader
        const forwarded = forwardedText?.split(",").at(-1)?.trim()
        const retryAfter = limiter.check(forwarded ?? request.socket.remoteAddress ?? "unknown")
        if (retryAfter !== null) return json(response, 429, { error: `Too many chaos runs. Try again in ${retryAfter} seconds.`, code: "rate_limited", retryAfterSeconds: retryAfter }, { "Retry-After": String(retryAfter) })
        const input = await body(request)
        if (typeof input.scenario !== "string" || !scenarios.has(input.scenario as Scenario)) return json(response, 400, { error: "Unknown scenario.", code: "unknown_scenario" })
        if (input.live !== undefined && typeof input.live !== "boolean") return json(response, 400, { error: "live must be a boolean.", code: "invalid_live_mode" })
        const run = control.create(input.scenario as Scenario, input.live === true)
        return json(response, 202, run)
      }
      const runMatch = /^\/api\/runs\/([a-zA-Z0-9_]+)$/.exec(url.pathname)
      if (method === "GET" && runMatch?.[1] !== undefined) {
        const run = control.get(runMatch[1])
        return run === undefined ? json(response, 404, { error: "Run not found.", code: "run_not_found" }) : json(response, 200, run)
      }
      const proofMatch = /^\/api\/runs\/([a-zA-Z0-9_]+)\/proof$/.exec(url.pathname)
      if (method === "GET" && proofMatch?.[1] !== undefined) {
        const run = control.get(proofMatch[1])
        if (run?.proof === undefined) return json(response, 409, { error: "Proof is not ready.", code: "proof_not_ready" })
        response.setHeader("Content-Disposition", `attachment; filename=ghostack-${run.id}-proof.json`)
        return json(response, 200, run.proof)
      }
      const knownApiPath = url.pathname === "/api/runs" || runMatch !== null || proofMatch !== null || url.pathname === "/ready"
      if (knownApiPath) return json(response, 405, { error: "Method not allowed.", code: "method_not_allowed" }, { Allow: url.pathname === "/api/runs" ? "GET, POST" : "GET" })
      if ((method === "GET" || method === "HEAD") && await staticFile(url.pathname, method, response)) return
      json(response, 404, { error: "Not found.", code: "not_found" })
    } catch (error) {
      if (error instanceof ControlPlaneError) {
        const headers = error.retryAfterSeconds === undefined ? {} : { "Retry-After": String(error.retryAfterSeconds) }
        return json(response, error.status, { error: error.message, code: error.code, ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }) }, headers)
      }
      if (error instanceof HttpError) return json(response, error.status, { error: error.message, code: error.code })
      json(response, 500, { error: "Internal server error.", code: "internal_error" })
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10)
  createGhostAckServer().listen(port, "0.0.0.0", () => process.stdout.write(`GhostAck control plane listening on ${port}\n`))
}
