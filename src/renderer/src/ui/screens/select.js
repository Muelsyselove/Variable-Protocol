// 干员与武器选择
import { show, registerScreen } from '../../router.js'
import { OPERATORS } from '../../data/operators.js'
import { WEAPONS } from '../../data/weapons.js'
import { createRun } from '../../core/run.js'
import { G, saveRun } from '../../state.js'
import { characterImg, weaponImg } from '../../data/images.js'
import { el, bindTip, fmt, dieTip } from '../components.js'

export function register() {
  registerScreen('select', renderSelect)
}

function renderSelect(root) {
  let opId = null
  let wpnId = null

  const cont = el(`
  <div class="screen screen-select">
    <div class="select-head">
      <div class="crumb">// OUTPOST · 干员配置</div>
      <h2>行动配置</h2>
    </div>
    <div class="select-body">
      <div class="select-col">
        <div class="col-label">干员 OPERATOR</div>
        <div class="card-grid" id="op-grid"></div>
      </div>
      <div class="select-col">
        <div class="col-label">武器协议 WEAPON</div>
        <div class="card-grid" id="wpn-grid"></div>
      </div>
      <div class="select-detail panel" id="detail"></div>
    </div>
    <div class="select-foot">
      <button class="btn btn-primary" id="btn-start" disabled>接入行动线</button>
      <button class="btn btn-ghost" id="btn-back">返回</button>
    </div>
  </div>`)
  root.appendChild(cont)

  const opGrid = cont.querySelector('#op-grid')
  const wpnGrid = cont.querySelector('#wpn-grid')
  const detail = cont.querySelector('#detail')
  const btnStart = cont.querySelector('#btn-start')

  for (const op of OPERATORS) {
    const img = characterImg(op.id)
    const card = el(`
      <div class="card card-op" data-id="${op.id}">
        ${img ? `<img class="card-img" src="${img}" alt="${op.name}"/>` : ''}
        <div class="card-name">${op.name}</div>
        <div class="card-title">${op.title}</div>
        <div class="card-stats">HP ${fmt(op.hp)} · ATK ${fmt(op.atk)}</div>
      </div>`)
    bindTip(card, `<b>${op.name} · ${op.title}</b><br>${op.desc}`)
    card.onclick = () => {
      opId = op.id
      opGrid.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id === op.id))
      refresh()
    }
    opGrid.appendChild(card)
  }

  for (const wpn of WEAPONS) {
    const img = weaponImg(wpn.id)
    const card = el(`
      <div class="card card-wpn" data-id="${wpn.id}">
        ${img ? `<img class="card-img" src="${img}" alt="${wpn.name}"/>` : ''}
        <div class="card-name">${wpn.name}</div>
        <div class="card-stats">ATK +${fmt(wpn.atk)}</div>
      </div>`)
    bindTip(card, `<b>${wpn.name}</b><br>${wpn.desc}`)
    card.onclick = () => {
      wpnId = wpn.id
      wpnGrid.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id === wpn.id))
      refresh()
    }
    wpnGrid.appendChild(card)
  }

  function refresh() {
    btnStart.disabled = !(opId && wpnId)
    if (opId && wpnId) {
      const op = OPERATORS.find((o) => o.id === opId)
      const wpn = WEAPONS.find((w) => w.id === wpnId)
      const atk = op.atk + wpn.atk
      // 初始骰池：逐颗悬停查看效果
      const diceChips = [
        ...Object.entries(wpn.dice).map(([k, n]) => `<span class="die-chip" data-die="${k}">${diceLabel(k)}×${n}</span>`),
        ...wpn.special.map((s) => `<span class="die-chip die-chip-special" data-die="${s}">${diceLabel(s)}</span>`)
      ].join(' ')
      const opImg = characterImg(op.id)
      const wpnImg = weaponImg(wpn.id)
      detail.innerHTML = `
        ${opImg ? `<img class="detail-img" src="${opImg}" alt="${op.name}"/>` : ''}
        <div class="detail-row"><span class="k">干员</span><span>${op.name} · ${op.title}</span></div>
        <div class="detail-row"><span class="k">武器</span><span>${wpnImg ? `<img class="detail-wpn-img" src="${wpnImg}" alt="${wpn.name}"/>` : ''}${wpn.name}</span></div>
        <div class="detail-row"><span class="k">面板</span><span>生命 ${fmt(op.hp)} · 攻击 ${fmt(atk)}</span></div>
        <div class="detail-row"><span class="k">初始骰池</span><span class="dice-chips">${diceChips}</span></div>
        <div class="detail-row"><span class="k">干员能力</span><span class="dim">${op.desc}</span></div>
        <div class="detail-row"><span class="k">武器效果</span><span class="dim">${wpn.desc}</span></div>`
      detail.querySelectorAll('[data-die]').forEach((c) => bindTip(c, () => dieTip(c.dataset.die, atk)))
    } else {
      detail.innerHTML = `<div class="detail-empty">选择一名干员与一件武器协议</div>`
    }
  }

  btnStart.onclick = async () => {
    G.run = createRun(opId, wpnId)
    G.profile.totalRuns++
    await saveRun()
    show('map')
  }
  cont.querySelector('#btn-back').onclick = () => show('menu')
}

function diceLabel(id) {
  return { attack: '攻击', barrier: '屏障', heal: '治疗' }[id] ||
    ({ interference: '干涉骰', erosion: '侵蚀骰', verify: '校验骰', assault: '强袭骰', overlap: '重叠骰', gloomDie: '沉沦骰', chaosDie: '混沌骰', ruinDie: '破灭骰', overloadDie: '过载骰', purify: '净化骰' }[id] || id)
}
