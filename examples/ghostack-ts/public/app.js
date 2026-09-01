const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]
const state = { scenario: "ack_lost", run: null, timer: null, rendered: 0 }

fetch("/ready").then((r) => r.json()).then((data) => {
  $("#runtime").textContent = data.liveSolari ? "SOLARI LIVE" : "DETERMINISTIC LAB"
  if (!data.liveSolari) { $("#live").disabled = true; $("#live-help").textContent = "Live key not configured on this revision" }
}).catch(() => { $("#runtime").textContent = "OFFLINE" })

$$('.scenario').forEach((button) => button.addEventListener('click', () => {
  $$('.scenario').forEach((item) => item.classList.remove('active'))
  button.classList.add('active')
  state.scenario = button.dataset.scenario
  const canLive = state.scenario === 'ack_lost'
  $('#live').disabled = !canLive || $('#runtime').textContent !== 'SOLARI LIVE'
  if (!canLive) $('#live').checked = false
}))

$('#run').addEventListener('click', async () => {
  reset()
  $('#run').disabled = true
  $('#run-title').textContent = $('.scenario.active b').textContent
  try {
    const response = await fetch('/api/runs', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ scenario: state.scenario, live: $('#live').checked }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Run rejected')
    state.run = data.id
    $('#run-id').textContent = data.id.toUpperCase()
    poll()
  } catch (error) {
    $('#timeline').innerHTML = `<div class="empty"><p>${escapeHtml(error.message)}</p></div>`
    $('#run').disabled = false
  }
})

function reset(){
  clearTimeout(state.timer); state.rendered=0; state.run=null
  $('#timeline').innerHTML=''; $('#visual').className='visual running'
  $('#effect-count').textContent='0'; $('#target-state').textContent='READY'; $('#b1-state').textContent='RUNNING'; $('#b2-state').textContent='STANDBY'
  $('#final-state').textContent='—'; $('#requests').textContent='—'; $('#duplicates').textContent='—'; $('#signature').textContent='Proof appears after a passing run'
  $$('.checks i').forEach((i)=>i.className=''); $('#download').classList.add('disabled')
}

async function poll(){
  try{
    const response=await fetch(`/api/runs/${state.run}`); const run=await response.json();
    render(run)
    if(run.status==='running'||run.status==='queued') state.timer=setTimeout(poll,300)
    else $('#run').disabled=false
  }catch{ state.timer=setTimeout(poll,700) }
}

function render(run){
  while(state.rendered<run.steps.length){ addEvent(run.steps[state.rendered]); state.rendered++ }
  const last=run.steps.at(-1)
  if(last?.phase==='crash'){ $('#visual').className='visual crashed'; $('#b1-state').textContent='TERMINATED'; $('#target-state').textContent='OUTCOME UNKNOWN' }
  if(last?.phase==='restart'||last?.phase==='reconcile'){ $('#visual').className='visual crashed recovering'; $('#b2-state').textContent='RECONCILING' }
  if(run.status==='passed'){
    const inv=run.proof.payload.invariants
    $('#visual').className='visual'; $('#b1-state').textContent='TERMINATED'; $('#b2-state').textContent='COMPLETE'; $('#target-state').textContent='COMMITTED'; $('#effect-count').textContent=inv.durableEffects
    $('#final-state').textContent='COMMITTED'; $('#requests').textContent=inv.targetRequests; $('#duplicates').textContent=inv.duplicates
    $$('.checks i').forEach((i)=>i.className='ok')
    $('#signature').textContent=`${run.proof.algorithm} / ${run.proof.keyId} / ${run.proof.signature.slice(0,42)}…`
    $('#download').href=`/api/runs/${run.id}/proof`; $('#download').classList.remove('disabled')
  }
  if(run.status==='failed'){ $('#visual').className='visual crashed'; $('#final-state').textContent='FAILED' }
}

function addEvent(step){
  const event=document.createElement('div'); event.className=`event ${step.tone}`
  event.innerHTML=`<time>${new Date(step.at).toLocaleTimeString([], {hour12:false})}</time><i></i><div><b>${escapeHtml(step.title)}</b><small>${escapeHtml(step.detail)}</small></div>`
  $('#timeline').append(event); $('#timeline').scrollTop=$('#timeline').scrollHeight
}

function escapeHtml(text){ const el=document.createElement('span'); el.textContent=text; return el.innerHTML }
