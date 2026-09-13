// 图鉴：干员 / 武器 / 虚质 / 转译器 / 骰子 全收录展示
// 骰子相关：武器与虚质的骰池悬停可查看骰子详情；骰子页展示具体算法
// 贴图：assets/{characters,weapons,translators}/<id>.png（1024×1024，按需缩放）
import { show, registerScreen } from '../../router.js'
import { OPERATORS } from '../../data/operators.js'
import { WEAPONS } from '../../data/weapons.js'
import { ENEMY_TEMPLATES } from '../../data/enemies.js'
import { TRANSLATORS, NORMAL_POOL } from '../../data/translators.js'
import { BASE_DICE, SPECIAL_DICE, PURE_DICE } from '../../data/diceDefs.js'
import { renderDieSnapshot } from '../../render/diceModels.js'
import { characterImg, weaponImg, translatorImg } from '../../data/images.js'
import { el, fmt, bindTip, dieTip } from '../components.js'

export function register() {
  registerScreen('codex', renderCodex)
}

const TABS = [
  { id: 'operators', name: '干员' },
  { id: 'weapons', name: '武器' },
  { id: 'enemies', name: '虚质' },
  { id: 'translators', name: '转译器' },
  { id: 'dice', name: '骰子' }
]

// 骰子悬停chip（atk为空时仅显示说明）
function diceChipHtml(id, n) {
  const def = SPECIAL_DICE[id] || BASE_DICE[id]
  return `<span class="die-chip ${BASE_DICE[id] ? '' : 'die-chip-special'}" data-die="${id}">${def ? def.name : id}${n > 1 ? `×${n}` : ''}</span>`
}

function renderCodex(root, params) {
  const tab = TABS.some((t) => t.id === params?.tab) ? params.tab : 'operators'
  const cont = el(`
  <div class="screen screen-codex">
    <div class="codex-head">
      <div class="crumb">// TERMINAL · 图鉴 CODEX</div>
      <h2>档案图鉴</h2>
      <div class="codex-tabs" id="tabs"></div>
    </div>
    <div class="codex-body" id="body"></div>
    <div class="settings-foot">
      <button class="btn btn-primary" id="btn-back">返回</button>
    </div>
  </div>`)
  root.appendChild(cont)

  const tabsEl = cont.querySelector('#tabs')
  const bodyEl = cont.querySelector('#body')
  for (const t of TABS) {
    const b = el(`<button class="btn btn-mini codex-tab ${t.id === tab ? 'btn-primary' : ''}" data-tab="${t.id}">${t.name}</button>`)
    b.onclick = () => show('codex', { tab: t.id })
    tabsEl.appendChild(b)
  }

  if (tab === 'operators') renderOperators(bodyEl)
  else if (tab === 'weapons') renderWeapons(bodyEl)
  else if (tab === 'enemies') renderEnemies(bodyEl)
  else if (tab === 'translators') renderTranslators(bodyEl)
  else renderDice(bodyEl)

  cont.querySelector('#btn-back').onclick = () => show('menu')
}

// ── 干员 ──
function renderOperators(bodyEl) {
  for (const op of OPERATORS) {
    const img = characterImg(op.id)
    bodyEl.appendChild(el(`
    <div class="codex-card panel">
      ${img ? `<img class="cx-img" src="${img}" alt="${op.name}"/>` : ''}
      <div class="cx-head">
        <span class="cx-name">${op.name}</span>
        <span class="cx-sub">${op.title}</span>
      </div>
      <div class="cx-stats dim">HP ${fmt(op.hp)} · ATK ${fmt(op.atk)}</div>
      <div class="cx-desc">${op.desc}</div>
    </div>`))
  }
}

// ── 武器（骰池悬停查看详情，示例攻击力=基准干员+武器） ──
function renderWeapons(bodyEl) {
  const BASE_ATK = 2600 // 基准干员攻击力，作为悬停数值示例
  for (const w of WEAPONS) {
    const atk = BASE_ATK + w.atk
    const img = weaponImg(w.id)
    const chips = Object.entries(w.dice).map(([k, n]) => diceChipHtml(k, n)).join(' ')
      + w.special.map((s) => diceChipHtml(s, 1)).join(' ')
    const card = el(`
    <div class="codex-card panel">
      ${img ? `<img class="cx-img" src="${img}" alt="${w.name}"/>` : ''}
      <div class="cx-head"><span class="cx-name">${w.name}</span><span class="cx-sub">ATK +${fmt(w.atk)}</span></div>
      <div class="cx-stats dim">初始骰池（悬停查看详情与算法）：</div>
      <div class="dice-chips">${chips}</div>
      <div class="cx-desc">${w.desc}</div>
    </div>`)
    card.querySelectorAll('[data-die]').forEach((c) => bindTip(c, () => dieTip(c.dataset.die, atk)))
    bodyEl.appendChild(card)
  }
}

// ── 虚质（普通 + BOSS，按出现层数排序；骰池悬停详情） ──
function renderEnemies(bodyEl) {
  const list = [...ENEMY_TEMPLATES].sort((a, b) => (a.minLayer || 0) - (b.minLayer || 0))
  for (const e of list) {
    const a = e.attrs
    const isBoss = !!e.boss
    const parts = []
    for (const [k, n] of Object.entries(e.pool || {})) {
      if (k === 'special') {
        for (const s of (Array.isArray(n) ? n : [])) parts.push(diceChipHtml(s, 1))
      } else {
        parts.push(diceChipHtml(k, n))
      }
    }
    const card = el(`
    <div class="codex-card panel ${isBoss ? 'cx-boss' : ''}">
      <div class="cx-head">
        <span class="cx-name">${e.name}</span>
        <span class="cx-sub">${isBoss ? 'BOSS' : `出现于第 ${e.minLayer ?? 1} 层起`}</span>
      </div>
      <div class="cx-stats dim">HP ${fmt(a.hp)} · ATK ${fmt(a.atk)}${a.def ? ` · DEF ${fmt(a.def)}` : ''}${a.magicResist ? ` · 魔抗 ${Math.round(a.magicResist * 100)}%` : ''}${a.psychicResist ? ` · 心抗 ${Math.round(a.psychicResist * 100)}%` : ''}</div>
      <div class="cx-stats dim">骰池（悬停查看详情，数值按其攻击力 ${fmt(a.atk)} 计算）：</div>
      <div class="dice-chips">${parts.join(' ') || '—'}</div>
      <div class="cx-desc">${e.desc || ''}</div>
    </div>`)
    card.querySelectorAll('[data-die]').forEach((c) => bindTip(c, () => dieTip(c.dataset.die, a.atk)))
    bodyEl.appendChild(card)
  }
}

// ── 转译器（普通/高阶/核心 分组） ──
function renderTranslators(bodyEl) {
  const all = Object.values(TRANSLATORS)
  const groups = [
    { name: '普通转译器（商店购买）', ids: NORMAL_POOL.map((t) => t.id) },
    { name: '高阶转译器（BOSS掉落三选一）', ids: all.filter((t) => t.tier === 'high').map((t) => t.id) },
    { name: '核心转译器（核心槽）', ids: all.filter((t) => t.tier === 'core').map((t) => t.id) }
  ]
  for (const g of groups) {
    bodyEl.appendChild(el(`<div class="cx-group-label">${g.name} · ${g.ids.length}种</div>`))
    for (const id of g.ids) {
      const t = TRANSLATORS[id]
      if (!t) continue
      const img = translatorImg(id)
      bodyEl.appendChild(el(`
      <div class="codex-card panel">
        ${img ? `<img class="cx-img cx-img-sm" src="${img}" alt="${t.name}"/>` : ''}
        <div class="cx-head">
          <span class="cx-name">${t.name}</span>
          <span class="cx-sub">${t.price ? `⌾${t.price}` : t.tier === 'core' ? '核心' : '高阶'}${t.stackable ? ' · 可叠加' : ''}</span>
        </div>
        <div class="cx-desc">${t.desc}</div>
      </div>`))
    }
  }
}

// ── 骰子（基础 + 特殊 + 纯点数，含专属3D模型快照与具体算法） ──
function renderDice(bodyEl) {
  // 收集全部骰种：基础骰快照用6点作为代表点数
  const entries = [
    ...Object.values(BASE_DICE).map((d) => ({ ...d, pips: d.pips ?? 6 })),
    ...Object.values(SPECIAL_DICE),
    ...Object.values(PURE_DICE)
  ]
  const snapQueue = []
  for (const d of entries) {
    const isBase = !!BASE_DICE[d.id]
    const card = el(`
    <div class="codex-card panel">
      <div class="cx-die3d-wrap"><img class="cx-die3d" alt="${d.name}"/></div>
      <div class="cx-head"><span class="cx-name">${d.name}</span><span class="cx-sub">${isBase ? '点数 1~6' : (d.pips ? `${d.pips}点` : '')}</span></div>
      <div class="cx-desc">${d.desc}</div>
      ${(isBase || (SPECIAL_DICE[d.id] && d.pips)) ? (isBase ? algoTable() : specialAlgo(d)) : ''}
    </div>`)
    snapQueue.push({ img: card.querySelector('.cx-die3d'), def: d })
    bodyEl.appendChild(card)
    if (isBase) void algoTable
  }
  // 分帧生成3D快照（避免一次阻塞）
  let i = 0
  const step = () => {
    if (i >= snapQueue.length) return
    const { img, def } = snapQueue[i++]
    try {
      img.src = renderDieSnapshot({ defId: def.id, pips: def.pips, kinds: def.kinds })
    } catch { /* WebGL不可用时忽略 */ }
    setTimeout(step, 16)
  }
  setTimeout(step, 0)
}

// 特殊骰算法：固定点数系数
function specialAlgo(d) {
  const coef = 0.5 + d.pips / 12
  return `
  <div class="cx-algo dim">
    本颗系数：${(coef * 100).toFixed(1)}%（= 0.5 + ${d.pips}/12）<br>
    数值型效果 = 攻击力 × ${coef.toFixed(3)}
  </div>`
}

// 基础骰算法表：各点数系数（0.5 + 点数/12）
function algoTable() {
  const rows = [1, 2, 3, 4, 5, 6].map((p) => {
    const coef = 0.5 + p / 12
    return `<tr><td>${p}点</td><td>${(coef * 100).toFixed(1)}%</td><td>×${coef.toFixed(3)}</td></tr>`
  }).join('')
  return `
  <div class="cx-algo dim">
    <table class="tip-table cx-algo-table">
      <tr><th>点数</th><th>系数</th><th>乘数</th></tr>
      ${rows}
    </table>
    效果 = 攻击力 × (0.5 + 点数/12)<br>
    攻击骰：物理伤害 = 效果 − 敌方防御力（下限为效果的5%）<br>
    治疗骰：治疗量 = 效果 × 治疗倍率；屏障骰：屏障值 = 效果
  </div>`
}
