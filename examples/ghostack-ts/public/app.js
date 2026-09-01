const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]
const state = { scenario: "ack_lost", run: null, timer: null, rendered: 0 }
const labels = {
  ack_lost: "Kill after commit",
  before_send: "Kill before send",
  coordinator_restart: "Restart coordinator",
  concurrency: "20-agent collision",
  intent_mutation: "Mutated intent attack",
}

fetch("/ready").then((response) => response.json()).then((data) => {
  $("#runtime").textContent = data.liveSolari ? "SOLARI LIVE" : "DETERMINISTIC LAB"
  selectScenario(state.scenario)
  if (!data.liveSolari) {
    $("#live").disabled = true
    $("#live-help").textContent = "Live key not configured on this revision"
  }
}).catch(() => {
  $("#runtime").textContent = "OFFLINE"
  showError("The control plane health check could not be reached.")
})

for (const button of $$(".scenario")) {
  button.addEventListener("click", () => selectScenario(button.dataset.scenario))
}

function selectScenario(scenario) {
  state.scenario = scenario
  for (const item of $$(".scenario")) {
    const selected = item.dataset.scenario === scenario
    item.classList.toggle("active", selected)
    item.setAttribute("aria-pressed", String(selected))
  }
  const canLive = scenario === "ack_lost"
  $("#live").disabled = !canLive || $("#runtime").textContent !== "SOLARI LIVE"
  if (!canLive) $("#live").checked = false
}

$("#run").addEventListener("click", async () => {
  reset()
  $("#run").disabled = true
  $("#run").setAttribute("aria-busy", "true")
  $("#run-title").textContent = labels[state.scenario]
  try {
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: state.scenario, live: $("#live").checked }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "Run rejected")
    state.run = data.id
    sessionStorage.setItem("ghostack:last-run", data.id)
    $("#run-id").textContent = data.id.toUpperCase()
    poll()
  } catch (error) {
    sessionStorage.removeItem("ghostack:last-run")
    showError(error instanceof Error ? error.message : "Run could not be started.")
    $("#timeline").innerHTML = '<div class="empty"><p>Request rejected safely. No effect was dispatched.</p></div>'
    $("#visual").className = "visual idle"
    $("#b1-state").textContent = "STANDBY"
    $("#b2-state").textContent = "STANDBY"
    $("#run-id").textContent = "NO ACTIVE RUN"
    finishButton()
  }
})

function reset() {
  clearTimeout(state.timer)
  state.rendered = 0
  state.run = null
  hideError()
  $("#timeline").innerHTML = ""
  $("#visual").className = "visual running"
  $("#effect-count").textContent = "0"
  $("#target-state").textContent = "READY"
  $("#b1-state").textContent = "RUNNING"
  $("#b2-state").textContent = "STANDBY"
  $("#final-state").textContent = "—"
  $("#requests").textContent = "—"
  $("#duplicates").textContent = "—"
  $("#signature").textContent = "Proof appears after a passing run"
  for (const indicator of $$(".checks i")) indicator.className = ""
  $("#download").classList.add("disabled")
  $("#download").setAttribute("aria-disabled", "true")
  $("#download").removeAttribute("href")
}

async function poll() {
  try {
    const response = await fetch(`/api/runs/${state.run}`)
    const run = await response.json()
    if (!response.ok) throw new Error(run.error || "Run state is unavailable.")
    render(run)
    if (run.status === "running" || run.status === "queued") state.timer = setTimeout(poll, 300)
    else finishButton()
  } catch (error) {
    showError(error instanceof Error ? error.message : "Run state is temporarily unavailable.")
    state.timer = setTimeout(poll, 1_000)
  }
}

function render(run) {
  while (state.rendered < run.steps.length) {
    addEvent(run.steps[state.rendered])
    state.rendered += 1
  }
  const last = run.steps.at(-1)
  if (last?.phase === "crash") {
    $("#visual").className = "visual crashed"
    $("#b1-state").textContent = "TERMINATED"
    $("#b2-state").textContent = "STANDBY"
    $("#effect-count").textContent = "?"
    $("#target-state").textContent = "OUTCOME UNKNOWN"
  }
  if (last?.phase === "restart" || last?.phase === "reconcile") {
    $("#visual").className = "visual crashed recovering"
    $("#b2-state").textContent = "RECONCILING"
  }
  if (run.status === "passed") {
    const invariants = run.proof.payload.invariants
    const finalLabels = {
      ack_lost: ["TERMINATED", "RECOVERED"],
      before_send: ["TERMINATED", "RETRIED SAFELY"],
      coordinator_restart: ["SIGKILL", "RESTARTED"],
      concurrency: ["LEADER", "19 COALESCED"],
      intent_mutation: ["COMMITTED", "MUTATION BLOCKED"],
    }
    const [first, second] = finalLabels[run.scenario] ?? ["COMPLETE", "COMPLETE"]
    $("#visual").className = "visual"
    $("#b1-state").textContent = first
    $("#b2-state").textContent = second
    $("#target-state").textContent = "COMMITTED"
    $("#effect-count").textContent = invariants.durableEffects
    $("#final-state").textContent = "COMMITTED"
    $("#requests").textContent = invariants.targetRequests
    $("#duplicates").textContent = invariants.duplicates
    for (const indicator of $$(".checks i")) indicator.className = "ok"
    $("#signature").textContent = `${run.proof.algorithm} / ${run.proof.keyId} / ${run.proof.signature.slice(0, 42)}…`
    $("#download").href = `/api/runs/${run.id}/proof`
    $("#download").classList.remove("disabled")
    $("#download").setAttribute("aria-disabled", "false")
  }
  if (run.status === "failed") {
    $("#visual").className = "visual crashed"
    $("#final-state").textContent = "FAILED CLOSED"
    showError(run.error || "The run failed closed without authorizing a retry.")
  }
}

function addEvent(step) {
  const event = document.createElement("div")
  event.className = `event ${step.tone}`
  event.innerHTML = `<time>${new Date(step.at).toLocaleTimeString([], { hour12: false })}</time><i aria-hidden="true"></i><div><b>${escapeHtml(step.title)}</b><small>${escapeHtml(step.detail)}</small></div>`
  $("#timeline").append(event)
  $("#timeline").scrollTop = $("#timeline").scrollHeight
}

function showError(message) {
  $("#request-error").textContent = message
  $("#request-error").hidden = false
}

function hideError() {
  $("#request-error").hidden = true
  $("#request-error").textContent = ""
}

function finishButton() {
  $("#run").disabled = false
  $("#run").removeAttribute("aria-busy")
}

async function restoreLastRun() {
  const id = sessionStorage.getItem("ghostack:last-run")
  if (id === null) return
  try {
    const response = await fetch(`/api/runs/${id}`)
    if (!response.ok) {
      sessionStorage.removeItem("ghostack:last-run")
      return
    }
    const run = await response.json()
    reset()
    state.run = run.id
    state.scenario = run.scenario
    selectScenario(run.scenario)
    $("#run-title").textContent = labels[run.scenario]
    $("#run-id").textContent = run.id.toUpperCase()
    render(run)
    if (run.status === "running" || run.status === "queued") {
      $("#run").disabled = true
      $("#run").setAttribute("aria-busy", "true")
      state.timer = setTimeout(poll, 300)
    }
  } catch {
    sessionStorage.removeItem("ghostack:last-run")
  }
}

function escapeHtml(text) {
  const element = document.createElement("span")
  element.textContent = text
  return element.innerHTML
}

void restoreLastRun()
