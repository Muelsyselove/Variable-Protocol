// 特殊事件
import { show, registerScreen } from '../../router.js'
import { advanceLayer, runMaxHp } from '../../core/run.js'
import { randomEvent } from '../../data/events.js'
import { agentTakesOver, agentDecideEvent } from '../../core/agentRunner.js'
import { protocolName } from '../../state.js'
import { G, saveRun } from '../../state.js'
import { setPetFlash } from '../../data/pets.js'
import { setPetActivity } from '../../core/petBridge.js'
import { el, fmt } from '../components.js'

export function register() {
  registerScreen('event', renderEvent)
}

function renderEvent(root) {
  const run = G.run
  const event = randomEvent()

  const cont = el(`
  <div class="screen screen-event">
    <div class="event-card panel">
      <div class="crumb">// 特殊事件 · 第 ${run.layer} 层</div>
      <h2 class="event-name">${event.name}</h2>
      <p class="event-desc">${event.desc}</p>
      <div class="event-options" id="options"></div>
      <div class="event-result" id="result" style="display:none">
        <p class="result-text" id="result-text"></p>
        <button class="btn btn-primary" id="btn-continue">继续推进</button>
      </div>
      <div class="agent-note dim" id="agent-note" style="display:none"></div>
      <div class="event-status">⌾ ${fmt(run.flux)} 通量 · HP ${fmt(run.hp)}/${fmt(runMaxHp(run))}</div>
    </div>
  </div>`)
  root.appendChild(cont)

  const optionsEl = cont.querySelector('#options')
  const resultEl = cont.querySelector('#result')
  const noteEl = cont.querySelector('#agent-note')

  function executeOption(opt, auto = false) {
    if (opt.cost) run.flux -= opt.cost
    const r = opt.resolve(run)
    optionsEl.style.display = 'none'
    resultEl.style.display = 'block'
    cont.querySelector('#result-text').textContent =
      (r && typeof r === 'object' ? r.text : r) || '……'
    const contBtn = cont.querySelector('#btn-continue')
    contBtn.onclick = async () => {
      advanceLayer(run)
      await saveRun()
      show('map')
    }
    // 代理接管时：结果短暂展示后自动继续推进
    if (auto) setTimeout(() => { if (G.run === run) contBtn.click() }, 1200)
  }

  const buttons = []
  for (const opt of event.options) {
    const btn = el(`<button class="btn event-opt">${opt.label}</button>`)
    if (opt.cost && run.flux < opt.cost) btn.disabled = true
    btn.onclick = () => executeOption(opt)
    optionsEl.appendChild(btn)
    buttons.push(btn)
  }

  // 协议接管：自动代理按优先级选择；智慧代理AI决策（AI失败回落优先级）
  if (agentTakesOver()) {
    noteEl.style.display = 'block'
    noteEl.textContent = `${protocolName(run.settings.protocol)}决策中…`
    setPetFlash('ponder', 8000) // AI智慧决策：桌宠思索
    setPetActivity('正在决策')
    buttons.forEach((b) => { b.disabled = true })
    agentDecideEvent(event.id, event.options, run).then((res) => {
      if (G.run !== run) return
      const opt = event.options[res.choice]
      if (!opt) return
      noteEl.textContent = res.by === 'ai'
        ? `${protocolName(run.settings.protocol)}已选择：${opt.label}`
        : `${protocolName(run.settings.protocol)}按优先级选择：${opt.label}${res.error ? '（AI不可用，已回落本地优先级）' : ''}`
      setTimeout(() => {
        if (G.run === run && optionsEl.style.display !== 'none') executeOption(opt, true)
      }, 800)
    })
  }
}
