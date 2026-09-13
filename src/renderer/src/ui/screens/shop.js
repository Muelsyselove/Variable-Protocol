// 商店（通量转换）
import { show, registerScreen } from '../../router.js'
import { advanceLayer, runMaxHp } from '../../core/run.js'
import { NORMAL_POOL, TRANSLATORS } from '../../data/translators.js'
import { addTranslator } from '../../data/events.js'
import { rngPick, rngInt } from '../../core/rng.js'
import { agentTakesOver, agentShopPlan } from '../../core/agentRunner.js'
import { protocolName } from '../../state.js'
import { G, saveRun } from '../../state.js'
import { el, fmt, bindTip, sleep } from '../components.js'

export function register() {
  registerScreen('shop', renderShop)
}

// 特殊商品池
// 随机特殊骰礼包白名单（非恶性、构筑向新骰）
const SPECIAL_DICE_PACK = [
  'shieldDie', 'bastionDie', 'firstAidDie', 'regenDie', 'sentryDie',
  'magicDie', 'pierceDie', 'sunderDie', 'chainDie', 'leechDie',
  'vulnDie', 'cacheDie', 'vanguardDie', 'bountyDie',
  'shieldSurgeDie', 'desperateDie', 'transposeDie', 'gatlingDie', 'cometDie', 'manaVeilDie', 'twinMindDie'
]

function specialGoods(run) {
  return [
    {
      id: 'injection', name: '恢复注射', desc: '恢复40%生命值。', price: 80,
      buy() { run.healPct(0.4) }
    },
    {
      id: 'deepRepair', name: '深层修复', desc: '恢复100%生命值。', price: 160,
      buy() { run.healPct(1) }
    },
    {
      id: 'poolExpand', name: '骰池扩容', desc: '本局骰池上限+1（每局限购2次）。', price: 120, limit: 2,
      buy() { run.poolCapBonus = (run.poolCapBonus || 0) + 1 }
    },
    {
      id: 'dicePack', name: '临时骰礼包', desc: '本局向我方骰池永久加入1颗4点攻击骰子。', price: 60,
      buy() { run.extraDice.push('attack4') }
    },
    {
      id: 'specialDicePack', name: '特殊骰礼包', desc: '本局向我方骰池永久加入1颗随机特殊骰子（护盾/穿透/吸血/彗星等构筑向骰）。', price: 90,
      buy() { run.extraDice.push(rngPick(SPECIAL_DICE_PACK)) }
    },
    {
      id: 'protocolClear', name: '协议清除', desc: '移除1个已持有的普通转译器（移除最早获得的）。', price: 40,
      buy() { /* 由界面处理 */ }
    }
  ]
}

function renderShop(root) {
  const run = G.run
  const greedy = run.translators.some((t) => t.id === 'greedySample')
  // 贪婪采样折扣20%；◇连携【天使投资】时为30%
  const priceMult = greedy
    ? (run.translators.some((t) => t.id === 'angelInvestor') ? 0.7 : 0.8)
    : 1
  const poolCap = 10 + (run.poolCapBonus || 0)

  // 货架：4格转译器（按强度分档定价）+ 1格特殊商品
  const tiers = [60, 90, 120, 150]
  const shelf = []
  const owned = new Set(run.translators.map((t) => t.id))
  const candidates = NORMAL_POOL.filter((t) => t.stackable || !owned.has(t.id))
  for (let i = 0; i < 4; i++) {
    const t = rngPick(candidates)
    const tierIdx = Math.min(3, tiers.indexOf(t.price) >= 0 ? tiers.indexOf(t.price) : 1 + rngInt(2))
    shelf.push({
      kind: 'translator', id: t.id, name: t.name, desc: t.desc,
      price: Math.round(tiers[tierIdx] * priceMult), tierIdx
    })
  }
  // 核心货柜：第5层起追加1格，出售1个未拥有的随机核心转译器
  if (run.layer >= 5) {
    const unownedCores = Object.values(TRANSLATORS).filter((t) => t.tier === 'core' && !owned.has(t.id))
    if (unownedCores.length > 0) {
      const c = rngPick(unownedCores)
      shelf.push({
        kind: 'core', id: c.id, name: `核心 · ${c.name}`, desc: c.desc,
        price: Math.round(250 * priceMult), tierIdx: 4
      })
    }
  }
  const goods = specialGoods(run)
  const specialPool = goods.filter((g) => !g.limit || (run['bought_' + g.id] || 0) < g.limit)
  const special = specialPool.length > 0 ? rngPick(specialPool) : null
  if (special) shelf.push({ kind: 'special', ref: special, name: special.name, desc: special.desc, price: Math.round(special.price * priceMult) })

  // 天使投资：购买转译器后，下一场战斗攻击力+15%
  const investNext = () => {
    if (run.translators.some((t) => t.id === 'angelInvestor')) run.buffNextBattle = true
  }

  let refreshCost = Math.round(25 * priceMult)

  const cont = el(`
  <div class="screen screen-shop">
    <div class="shop-head panel">
      <div class="crumb">// 通量转换 FLUX EXCHANGE · 第 ${run.layer} 层</div>
      <div class="shop-status">
        <span>⌾ <b id="flux">${fmt(run.flux)}</b> 通量</span>
        <span>HP ${fmt(run.hp)}/${fmt(runMaxHp(run))}</span>
      </div>
    </div>
    <div class="shop-shelf" id="shelf"></div>
    <div class="shop-services panel">
      <div class="svc-label">// 服务</div>
      <div class="svc-row">
        <button class="btn btn-mini" id="btn-refresh">刷新货架（${refreshCost}通量）</button>
        <span class="dim">出售区：</span>
        <span id="sell-list"></span>
      </div>
    </div>
    <div class="shop-foot">
      <button class="btn btn-primary" id="btn-leave">离开商店，继续推进</button>
    </div>
  </div>`)
  root.appendChild(cont)

  const shelfEl = cont.querySelector('#shelf')
  const fluxEl = cont.querySelector('#flux')

  function updateFlux() { fluxEl.textContent = fmt(run.flux) }

  function renderShelf() {
    shelfEl.innerHTML = ''
    shelf.forEach((item, idx) => {
      if (item.sold) return
      const card = el(`
        <div class="shop-card panel">
          <div class="shop-card-name">${item.name}${item.kind === 'special' ? '' : ''}</div>
          <div class="shop-card-desc">${item.desc}</div>
          <button class="btn btn-mini btn-buy" ${run.flux < item.price ? 'disabled' : ''}>⌾ ${fmt(item.price)}</button>
        </div>`)
      bindTip(card, item.desc)
      card.querySelector('.btn-buy').onclick = async () => {
        if (run.flux < item.price) return
        run.flux -= item.price
        if (item.kind === 'translator' || item.kind === 'core') {
          addTranslator(run, item.id)
          investNext()
        } else {
          if (item.ref.id === 'protocolClear') {
            // 协议清除：选择一个普通转译器移除
            const normals = run.translators.filter((t) => TRANSLATORS[t.id]?.tier === 'normal')
            if (normals.length === 0) { run.flux += item.price; return }
            const target = normals[0] // 简化：移除最早获得的
            run.translators = run.translators.filter((t) => t !== target)
            item.sold = true
            renderSellList()
          } else {
            item.ref.buy()
            if (item.ref.limit) run['bought_' + item.ref.id] = (run['bought_' + item.ref.id] || 0) + 1
            item.sold = true
          }
        }
        if (item.kind === 'translator' || item.kind === 'core') item.sold = true
        updateFlux()
        renderShelf()
      }
      shelfEl.appendChild(card)
    })
    // 补空位提示
    if (shelf.every((s) => s.sold)) shelfEl.innerHTML = '<div class="dim shelf-empty">货架已空</div>'
  }

  function renderSellList() {
    const listEl = cont.querySelector('#sell-list')
    listEl.innerHTML = ''
    const sellable = run.translators.filter((t) => TRANSLATORS[t.id]?.tier === 'normal')
    if (sellable.length === 0) {
      listEl.innerHTML = '<span class="dim">无可出售的转译器</span>'
      return
    }
    for (const t of sellable) {
      const def = TRANSLATORS[t.id]
      const sellPrice = Math.round((def.price || 90) * 0.5)
      const chip = el(`<button class="t-chip sellable">${def.name}${t.stacks > 1 ? ` ×${t.stacks}` : ''} → ⌾${fmt(sellPrice)}</button>`)
      bindTip(chip, `<b>${def.name}</b><br>出售价 ${fmt(sellPrice)} 通量`)
      chip.onclick = () => {
        if (t.stacks > 1) t.stacks--
        else {
          run.translators = run.translators.filter((x) => x !== t)
          if (run.coreSlots.includes(t.id)) run.coreSlots[run.coreSlots.indexOf(t.id)] = null
        }
        run.flux += sellPrice
        updateFlux()
        renderSellList()
      }
      listEl.appendChild(chip)
    }
  }

  cont.querySelector('#btn-refresh').onclick = () => {
    if (run.flux < refreshCost) return
    run.flux -= refreshCost
    refreshCost = Math.round(refreshCost * 1.2) // 递增刷新成本
    cont.querySelector('#btn-refresh').textContent = `刷新货架（${refreshCost}通量）`
    // 重新生成货架
    show('shop')
  }

  cont.querySelector('#btn-leave').onclick = async () => {
    advanceLayer(run)
    await saveRun()
    show('map')
  }

  // ── 协议接管：自动代理按优先级购物序列执行后自动离开 ──
  async function agentShopping() {
    noteEl.style.display = 'block'
    noteEl.textContent = `${protocolName(run.settings.protocol)}购物中…`
    const actions = agentShopPlan(run, shelf)
    for (const act of actions) {
      if (G.run !== run) return
      if (act.type === 'buy') {
        const item = shelf[act.idx]
        if (!item || item.sold || run.flux < item.price) continue
        await sleep(600)
        if (G.run !== run) return
        run.flux -= item.price
        if (item.kind === 'translator' || item.kind === 'core') {
          addTranslator(run, item.id)
          investNext()
          item.sold = true
        } else if (item.ref.id === 'protocolClear') {
          const normals = run.translators.filter((t) => TRANSLATORS[t.id]?.tier === 'normal')
          if (normals.length > 0) {
            run.translators = run.translators.filter((t) => t !== normals[0])
            item.sold = true
          }
        } else {
          item.ref.buy()
          if (item.ref.limit) run['bought_' + item.ref.id] = (run['bought_' + item.ref.id] || 0) + 1
          item.sold = true
        }
        updateFlux()
        renderShelf()
        renderSellList()
      } else if (act.type === 'leave') {
        await sleep(500)
        if (G.run !== run) return
        noteEl.textContent = '购物完成，离开商店…'
        advanceLayer(run)
        await saveRun()
        show('map')
      }
    }
  }

  const noteEl = el('<div class="agent-note dim" id="shop-agent-note" style="display:none"></div>')
  cont.querySelector('.shop-services').appendChild(noteEl)
  if (agentTakesOver()) agentShopping()

  void poolCap
  renderShelf()
  renderSellList()
}
