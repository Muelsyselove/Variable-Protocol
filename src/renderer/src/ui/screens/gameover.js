// 结算界面：常规模式完整结算；小窗模式极简显示；桌宠模式气泡结算
// 对局结束按层数结算算力币（层数×15 + 清除×2，保底10）
// 进化模式：局末AI调优当前方案；连战：延迟后自动开局下一局
import { show, registerScreen, onScreenCleanup } from '../../router.js'
import { G, clearRun, saveProfile, applyWindowState } from '../../state.js'
import { coinsForRun } from '../../data/pets.js'
import { petModeActive, setPetActivity } from '../../core/petBridge.js'
import { startChainRun } from '../../core/autoRun.js'
import { getActiveScheme, updateScheme } from '../../core/schemes.js'
import { evolveAgentScheme, aiConfigured } from '../../core/aiService.js'
import { el, fmt, updateProtocolBar } from '../components.js'
import { playSfx } from '../../core/sfx.js'

export function register() {
  registerScreen('gameover', renderGameover)
}

// 进化模式：收集本局报告并AI调优激活方案（失败静默保留原方案）
async function evolveScheme(protocolId, runReport) {
  if (!G.profile.evolution || protocolId !== 'agent' || !aiConfigured()) return null
  const scheme = getActiveScheme()
  if (!scheme) return null
  const res = await evolveAgentScheme(scheme, runReport)
  if (!res.ok) return { ok: false, error: res.error }
  await updateScheme(scheme.id, { name: res.name || scheme.name, config: res.config })
  return { ok: true, name: res.name || scheme.name, summary: res.summary }
}

async function renderGameover(root) {
  const run = G.run
  const mini = !!run?.settings?.mini
  // 更新局外档案
  const layer = run.layer
  const kills = run.stats.kills
  G.profile.bestLayer = Math.max(G.profile.bestLayer, layer)
  G.profile.totalKills += kills
  // 算力币结算
  const earned = coinsForRun(layer, kills)
  G.profile.coins += earned

  // ── 连战/进化前置：clearRun 前捕获本局上下文 ──
  const protocolId = run.settings?.protocol || 'none'
  const chainOn = G.profile.chainBattle && (protocolId === 'agent' || protocolId === 'smart')
  const chainCtx = chainOn ? {
    layer, kills,
    opening: { operator: run.operatorId, weapon: run.weaponId },
    hp: Math.floor(run.hp),
    flux: run.flux,
    speed: run.settings.speed,
    animSkip: !!run.settings.animSkip,
    lastBattle: G.lastBattle
  } : null

  await saveProfile()

  // ── 进化模式：AI调优当前方案（替换后连战即用新方案） ──
  let evoNote = ''
  if (chainCtx) {
    const scheme = getActiveScheme()
    const report = {
      本局结果: `推进至第${layer}层，清除${kills}个虚质后战败`,
      开局选择: { operator: run.operatorId, weapon: run.weaponId },
      最终生命: Math.floor(run.hp),
      剩余通量: run.flux,
      转译器背包: run.translators.map((t) => t.id + (t.stacks > 1 ? `×${t.stacks}` : '')),
      核心槽: run.coreSlots,
      骰子背包: { 额外骰: run.extraDice },
      末场战斗: G.lastBattle || '未记录'
    }
    const evo = await evolveScheme(protocolId, report)
    if (evo?.ok) evoNote = `进化：${evo.summary || '方案已调优'}`
    else if (evo?.error) evoNote = `进化失败：${evo.error}`
    void scheme
  }

  await clearRun()
  // 协议栏残留修复：router.show 在 clearRun 之前刷新协议栏（当时对局仍在），
  // 清空后不会再次刷新——此处对局已无协议概念，强制隐藏
  updateProtocolBar(null)

  // ── 桌宠模式：气泡结算，连战由桌宠陪伴继续 ──
  if (mini && petModeActive()) {
    setPetActivity(`行动结束 · 第${layer}层 · 算力币+${fmt(earned)}${evoNote ? ` · ${evoNote}` : ''}`)
    playSfx('coin')
    root.appendChild(el('<div class="screen screen-gameover"></div>'))
    if (chainOn) scheduleChain(protocolId, chainCtx, 8000)
    return
  }

  if (mini) {
    // 小窗模式：极简结束画面，仅"游戏结束+层数+算力币+退出小窗"
    const cont = el(`
    <div class="screen screen-gameover mini-go">
      <div class="mini-go-box">
        <div class="mini-go-title">游戏结束</div>
        <div class="mini-go-sub">推进至 第 ${layer} 层 · 清除 ${kills}</div>
        <div class="mini-go-coins">算力币 <b>+${fmt(earned)}</b>（持有 ${fmt(G.profile.coins)}）</div>
        ${evoNote ? `<div class="mini-go-coins dim">${evoNote}</div>` : ''}
        ${chainOn ? '<div class="mini-go-coins dim">连战中 · 即将自动开始下一局…</div>' : ''}
        <button class="btn btn-mini btn-warn" id="btn-mini-exit">退出小窗</button>
      </div>
    </div>`)
    root.appendChild(cont)
    playSfx('coin')
    if (chainOn) scheduleChain(protocolId, chainCtx, 6000)
    cont.querySelector('#btn-mini-exit').onclick = () => {
      G.run = { settings: { mini: false, alwaysOnTop: false } } // 临时标记，map 渲染前会被 loadRun/新建覆盖
      document.body.classList.remove('mini-mode')
      if (typeof window !== 'undefined' && window.api) {
        window.api.setMini(false)
        window.api.setAlwaysOnTop(false)
      }
      show('menu')
    }
    return
  }

  // ── 常规模式 ──
  const cont = el(`
  <div class="screen screen-gameover">
    <div class="go-card panel">
      <div class="go-title">CONNECTION LOST</div>
      <div class="go-sub">连接中断 · 干员离线</div>
      <div class="go-stats">
        <div class="go-stat"><span class="k">推进层数</span><b>${layer}</b></div>
        <div class="go-stat"><span class="k">清除虚质</span><b>${kills}</b></div>
        <div class="go-stat"><span class="k">历史最深</span><b>${G.profile.bestLayer}</b></div>
      </div>
      <div class="go-coins">⌾ 获得算力币 <b>+${fmt(earned)}</b><span class="dim">（结算 = 层数×15 + 清除×2 · 现持有 ${fmt(G.profile.coins)}）</span></div>
      ${evoNote ? `<div class="go-coins dim" style="font-size:12px">${evoNote}</div>` : ''}
      ${chainOn ? '<div class="go-coins dim" style="font-size:12px">连战中 · 5秒后自动开始下一局…</div>' : ''}
      <div class="go-quote">变量终将归于噪声。</div>
      <button class="btn btn-primary" id="btn-menu">返回终端</button>
    </div>
  </div>`)
  root.appendChild(cont)
  playSfx('coin')
  if (chainOn) scheduleChain(protocolId, chainCtx, 5000)
  cont.querySelector('#btn-menu').onclick = () => show('menu')
  void applyWindowState
}

// 连战定时：延迟后自动开局下一局；期间离开结算屏则取消
function scheduleChain(protocolId, chainCtx, delayMs) {
  const t = setTimeout(async () => {
    // 玩家已手动离开结算屏（不在gameover）则取消连战
    const { currentScreen } = await import('../../router.js')
    if (currentScreen() !== 'gameover') return
    await startChainRun(protocolId, chainCtx)
    const { show: showScreen } = await import('../../router.js')
    showScreen('map')
  }, delayMs)
  onScreenCleanup(() => clearTimeout(t))
}
