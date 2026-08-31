export const TARGET_PROGRAM = String.raw`
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const port = Number(process.env.PORT || 3000);
const statePath = process.env.AEGIS_STATE_PATH || "/tmp/aegis/state.json";
let state = { requests: 0, effects: 0, receipts: {} };

try { state = JSON.parse(await readFile(statePath, "utf8")); } catch (error) {
  if (error.code !== "ENOENT") throw error;
}

async function persist() {
  await mkdir(dirname(statePath), { recursive: true });
  const next = statePath + ".next";
  await writeFile(next, JSON.stringify(state));
  await rename(next, statePath);
}

function json(response, status, body) {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(data);
}

function page(response, status, body) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    "x-frame-options": "DENY",
  });
  response.end(body);
}

function shell(content) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Aegis target</title><style>body{background:#07100d;color:#edf7f2;font:15px ui-monospace,monospace;max-width:760px;margin:50px auto;padding:20px}form,pre{background:#0d1814;border:1px solid #294638;border-radius:12px;padding:22px}label{display:block;margin:12px 0 5px;color:#9db4a8}input{width:100%;padding:11px;background:#07100d;border:1px solid #365a48;color:#fff}button{margin-top:18px;padding:12px 20px;background:#63f2ad;border:0;font-weight:700}.muted{color:#8fa79b}</style></head><body><div class="muted">SOLARI SANDBOX / IDEMPOTENT TARGET</div><h1>Aegis transaction fixture</h1>' + content + '</body></html>';
}

function receiptHtml(receipt) {
  return shell('<h2>Authoritative receipt lookup</h2><pre id="receipt">' + JSON.stringify(receipt, null, 2) + '</pre>');
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length > 16_384) throw new Error("body too large");
  return JSON.parse(raw);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { status: "ok" });
    if (request.method === "GET" && url.pathname === "/api/stats") return json(response, 200, { requests: state.requests, effects: state.effects });
    if (request.method === "GET" && url.pathname.startsWith("/api/effects/")) {
      const key = decodeURIComponent(url.pathname.slice("/api/effects/".length));
      const receipt = state.receipts[key];
      return receipt ? json(response, 200, receipt) : json(response, 404, { detail: "effect not found" });
    }
    if (request.method === "GET" && url.pathname.startsWith("/receipts/")) {
      const key = decodeURIComponent(url.pathname.slice("/receipts/".length));
      const receipt = state.receipts[key];
      return receipt ? page(response, 200, receiptHtml(receipt)) : page(response, 404, shell('<h2 id="missing">No effect exists</h2>'));
    }
    if (request.method === "POST" && url.pathname === "/api/effects") {
      const input = await body(request);
      if (!/^aeg_[a-f0-9]{32}$/.test(input.idempotencyKey) || !/^[a-f0-9]{64}$/.test(input.intentHash) || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return json(response, 422, { detail: "invalid canonical intent" });
      state.requests += 1;
      let receipt = state.receipts[input.idempotencyKey];
      if (receipt && (receipt.intentHash !== input.intentHash || receipt.amountCents !== input.amountCents)) return json(response, 409, { detail: "idempotency key conflict" });
      if (!receipt) {
        state.effects += 1;
        receipt = {
          receiptId: "rcpt_" + createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 20),
          idempotencyKey: input.idempotencyKey,
          intentHash: input.intentHash,
          committedAt: new Date().toISOString(),
          amountCents: input.amountCents,
        };
        state.receipts[input.idempotencyKey] = receipt;
      }
      await persist();
      const delayMs = Math.min(5_000, Math.max(0, Number(input.ackDelayMs || 0)));
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      return json(response, 200, receipt);
    }
    if (request.method === "GET" && url.pathname === "/") {
      return page(response, 200, shell('<form id="effect-form"><label>Idempotency key</label><input id="idempotency-key"><label>Intent hash</label><input id="intent-hash"><label>Amount (cents)</label><input id="amount" type="number"><button id="commit" type="submit">Commit once</button></form><pre id="result">waiting</pre><script>document.querySelector("#effect-form").addEventListener("submit",async event=>{event.preventDefault();document.querySelector("#result").textContent="dispatching";const response=await fetch("/api/effects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idempotencyKey:document.querySelector("#idempotency-key").value,intentHash:document.querySelector("#intent-hash").value,amountCents:Number(document.querySelector("#amount").value),ackDelayMs:Number(new URLSearchParams(location.search).get("ackDelayMs")||0)})});document.querySelector("#result").textContent=await response.text()})</script>'));
    }
    json(response, 404, { detail: "not found" });
  } catch (error) {
    json(response, 500, { detail: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "0.0.0.0", () => {
  const address = server.address();
  console.log("aegis-target-ready:" + (typeof address === "object" ? address.port : port));
});
`
