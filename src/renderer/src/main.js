// 渲染进程入口：普通窗口（游戏）或桌宠悬浮窗（?pet=1）
import './styles/base.css'
import './styles/screens.css'
import { initRouter, show, currentScreen } from './router.js'
import { initTooltip, ensureProtocolBar, setProtocolBarTerminate, updateProtocolBar } from './ui/components.js'
import { ensureTitlebar } from './ui/titlebar.js'
import { ensurePetOverlay, updatePetOverlay } from './ui/petOverlay.js'
import { G, initProfile, saveRun, decayPetSatiety, setPetKnownIdsProvider } from './state.js'
import { PET_DEFS } from './data/pets.js'
import { loadGameData } from './core/gameData.js'
import { resumeSfx, playSfx, setSfxEnabled, setSfxVolume } from './core/sfx.js'
import { petModeActive, pushPetState, handlePetAction } from './core/petBridge.js'
import { runBootSplash } from './ui/bootSplash.js'

// 桌宠 id 集合注入（存档清洗用）：读档时点读取定义表，退役 id 判定始终基于当前资源
setPetKnownIdsProvider(() => new Set(PET_DEFS.map((d) => d.id)))

import { register as regMenu } from './ui/screens/menu.js'
import { register as regSelect } from './ui/screens/select.js'
import { register as regMap } from './ui/screens/map.js'
import { register as regCombat } from './ui/screens/combat.js'
import { register as regShop } from './ui/screens/shop.js'
import { register as regEvent } from './ui/screens/event.js'
import { register as regReward } from './ui/screens/reward.js'
import { register as regGameover } from './ui/screens/gameover.js'
import { register as regSettings } from './ui/screens/settings.js'
import { register as regPetShop } from './ui/screens/petshop.js'
import { register as regCodex } from './ui/screens/codex.js'

// ── 桌宠悬浮窗分支：仅渲染桌宠与气泡，不启动游戏界面 ──
if (new URLSearchParams(location.search).get('pet') === '1') {
  const { bootPet } = await import('./ui/petWindow.js')
  bootPet()
} else {
  regMenu()
  regSelect()
  regMap()
  regCombat()
  regShop()
  regEvent()
  regReward()
  regGameover()
  regSettings()
  regPetShop()
  regCodex()

  initRouter(document.getElementById('app'))
  initTooltip()
  ensureProtocolBar()
  ensureTitlebar()
  ensurePetOverlay()

  // 桌宠浮标轮询：闪光过期回落、饱食度随时间衰减后刷新表情；桌宠模式下同步推送状态
  setInterval(() => {
    decayPetSatiety()
    updatePetOverlay()
    if (petModeActive()) pushPetState()
  }, 1500)

  // 音效：读取存档配置，并在首次用户手势后激活音频上下文
  setSfxEnabled(G.profile.sound?.enabled !== false)
  setSfxVolume(G.profile.sound?.volume ?? 0.8)
  document.addEventListener('pointerdown', resumeSfx, { capture: true })

  // 全局点击音效：命中可交互元素时播放（战斗内按钮同样适用）
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.btn, .tb-btn, .card, .node.current, .proto-card, .ov-card, .event-opt, .reward-opt, .reward-grid, .die-chip, .t-chip.clickable, .core-slot.filled, .ps-item, .ps-food')) {
      playSfx('click')
    }
  }, { capture: true })

  // 协议终止：关闭协议、保存并刷新当前非战斗屏幕（战斗内不打断，结束后不再自动返回）
setProtocolBarTerminate(async () => {
  if (!G.run?.settings) {
    // 无进行中对局（如结算屏残留的协议栏）：仅隐藏协议栏
    updateProtocolBar(null)
    return
  }
  G.run.settings.protocol = 'none'
  await saveRun()
  // 立即隐藏协议栏（不等屏幕刷新——战斗内不切屏，栏会残留到战斗结束）
  updateProtocolBar(null)
  const cur = currentScreen()
  if (cur && cur !== 'combat') show(cur)
})

  // 桌宠悬浮窗动作（喂食/购买/换协议/换桌宠/互动/退出）
  if (typeof window !== 'undefined' && window.api) {
    window.api.onPetAction((a) => handlePetAction(a))
  }

  async function boot() {
    // 开屏界面（主窗口内覆盖层）：并行执行资源+存档加载与更新检查（自动下载新版本），
    // 就绪后移除覆盖层进入主菜单；资源加载失败停留在开屏错误提示
    await runBootSplash(async () => {
      await loadGameData()
      await initProfile()
    })
    show('menu')
  }

  boot()

  // 供调试：暴露全局状态
  window.__VP = G
}
