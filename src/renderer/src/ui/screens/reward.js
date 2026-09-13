// 奖励关：三选一
import { show, registerScreen } from '../../router.js'
import { advanceLayer, runMaxHp } from '../../core/run.js'
import { REWARD_OPTIONS } from '../../data/events.js'
import { agentTakesOver, agentDecideReward } from '../../core/agentRunner.js'
import { protocolName } from '../../state.js'
import { G, saveRun } from '../../state.js'
import { setPetFlash } from '../../data/pets.js'
import { setPetActivity } from '../../core/petBridge.js'
import { el, fmt } from '../components.js'

export function register() {
  registerScreen('reward', renderReward)
}

function renderReward(root) {
  const run = G.run
  const cont = el(`
  <div class="screen screen-reward">
    <div class="reward-card panel">
      <div class="crumb">// 奖励关 · 第 ${run.layer} 层</div>
      <h2>稳定补给</h2>
      <p class="event-desc">行动线的一段空隙。选择一项补给，然后继续推进。</p>
      <div class="reward-grid" id="grid"></div>
      <div class="event-result" id="result" style="display:none">
        <p class="result-text" id="result-text"></p>
        <button class="btn btn-primary" id="btn-continue">继续推进</button>
      </div>
      <div class="agent-note dim" id="agent-note" style="display:none"></div>
      <div class="event-status">⌾ ${fmt(run.flux)} 通量 · HP ${fmt(run.hp)}/${fmt(runMaxHp(run))}</div>
    </div>
  </div>`)
  root.appendChild(cont)

  const grid = cont.querySelector('#grid')
  const resultEl = cont.querySelector('#result')
  const noteEl = cont.querySelector('#agent-note')

  function executeOption(idx, auto = false) {
    const text = REWARD_OPTIONS[idx].resolve(run)
    grid.style.display = 'none'
    resultEl.style.display = 'block'
    cont.querySelector('#result-text').textContent = text
    const contBtn = cont.querySelector('#btn-continue')
    contBtn.onclick = async () => {
      advanceLayer(run)
      await saveRun()
      show('map')
    }
    // 代理接管时：结果短暂展示后自动继续推进
    if (auto) setTimeout(() => { if (G.run === run) contBtn.click() }, 1200)
  }

  REWARD_OPTIONS.forEach((opt, idx) => {
    const card = el(`<button class="reward-opt">${opt.label}</button>`)
    card.onclick = () => executeOption(idx)
    grid.appendChild(card)
  })

  // 协议接管：自动代理按优先级；智慧代理AI决策（AI失败回落优先级）
  if (agentTakesOver()) {
    noteEl.style.display = 'block'
    noteEl.textContent = `${protocolName(run.settings.protocol)}决策中…`
    setPetFlash('ponder', 8000) // AI智慧决策：桌宠思索
    setPetActivity('正在决策')
    grid.querySelectorAll('.reward-opt').forEach((c) => { c.disabled = true })
    agentDecideReward(run).then((res) => {
      if (G.run !== run || res.choice == null) return
      noteEl.textContent = `${protocolName(run.settings.protocol)}选择：${REWARD_OPTIONS[res.choice].label}${res.error ? '（AI不可用，已回落本地优先级）' : ''}`
      setTimeout(() => {
        if (G.run === run && grid.style.display !== 'none') executeOption(res.choice, true)
      }, 800)
    })
  }
}
