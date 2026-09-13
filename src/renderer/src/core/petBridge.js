// 桌宠悬浮窗桥（主窗口侧）：活动文案、状态推送、桌宠窗动作处理
// 桌宠窗是独立透明窗口，所有数据经主进程中继；本模块在游戏主窗口内运行
import { G, saveRun, saveProfile, PROTOCOLS, protocolName, protocolActive } from '../state.js'
import { nodeAt } from './run.js'
import {
  activePet, petSatiety, petAffection, addPetAffection, computePetState, chibiFor,
  PET_STATE_NAMES, PET_DEFS, petQuote, feedActivePet, buyPetFood, setPetFlash, FOOD_PRICE
} from '../data/pets.js'
import { playSfx, setSfxEnabled } from './sfx.js'

let active = false        // 桌宠模式是否运行
let activity = '待机中'   // 气泡活动文案
let lastScreen = 'menu'   // 最近屏幕（用于桌宠表情计算）

// 桌宠模式下允许的协议：决策节点需无人值守自动推进（自动协议需手动操作，不可用）
const PET_ALLOWED_PROTOCOLS = ['agent', 'smart']

// 触摸好感冷却：10分钟内仅首次触摸增加好感（触摸互动本身不受限）
const INTERACT_COOLDOWN_MS = 10 * 60 * 1000

export function petModeActive() {
  return active
}

export function setPetMode(on) {
  active = !!on
  if (active) pushPetState()
}

export function setPetActivity(text) {
  activity = text || '待机中'
  if (active) pushPetState()
}

// 屏幕切换钩子（router.show 调用）：记录屏幕并生成默认活动文案
export function setPetScreen(id) {
  lastScreen = id || 'menu'
  if (!active) return
  const run = G.run
  let text = '待机中'
  if (id === 'map' && run) text = `正在推进 · 第 ${run.layer} 层`
  else if (id === 'combat' && run) text = nodeAt(run.layer) === 'BOSS' ? '正在与BOSS激战' : '正在战斗'
  else if (id === 'event') text = protocolActive() ? '正在决策' : '正在选择行动'
  else if (id === 'reward') text = protocolActive() ? '正在决策' : '正在选择补给'
  else if (id === 'shop') text = '正在购物'
  else if (id === 'select') text = '正在编制队伍'
  else if (id === 'gameover') text = '行动结束'
  activity = text
  pushPetState()
}

// 向桌宠窗推送完整状态（quote 非空时气泡临时显示台词）
export function pushPetState(quote) {
  if (!active || typeof window === 'undefined' || !window.api) return
  const prof = G.profile
  const run = G.run
  const pet = activePet(prof)
  const state = quote ? 'tsundere' : (pet ? computePetState(prof, lastScreen) : 'normal')
  const pid = run?.settings?.protocol || 'none'
  window.api.petPush({
    activity,
    quote: quote || '',
    state,
    stateName: PET_STATE_NAMES[state] || '',
    img: pet ? chibiFor(pet, state) : '',
    petName: pet?.name || '',
    satiety: pet ? Math.min(100, petSatiety(prof, pet.id)) : 0,
    affection: pet ? petAffection(prof, pet.id) : 0,
    food: prof.pet.food,
    foodPrice: FOOD_PRICE,
    coins: prof.coins,
    sound: prof.sound?.enabled !== false,
    speed: run?.settings?.speed || 1,
    animSkip: !!run?.settings?.animSkip,
    chainBattle: !!prof.chainBattle,
    evolution: !!prof.evolution,
    layer: run?.layer ?? 0,
    pets: PET_DEFS.map((p) => ({ id: p.id, name: p.name, owned: !!prof.pet.owned[p.id], active: prof.pet.active === p.id })),
    // 桌宠模式协议白名单：仅自动代理/智慧代理（无人值守可全自动推进）
    protocols: PROTOCOLS.filter((p) => PET_ALLOWED_PROTOCOLS.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name, active: pid === p.id }))
  })
}

// 处理桌宠窗动作（喂食/购买/换协议/换桌宠/互动/退出等）
export async function handlePetAction(a) {
  if (!a?.type) return
  const prof = G.profile
  const run = G.run

  if (a.type === 'exit') {
    // 去重：正常退出会触发桌宠窗 closed 事件的恢复通知，二次到达时直接忽略
    if (!active) return
    active = false
    if (run?.settings) {
      run.settings.mini = false
      run.settings.alwaysOnTop = false
      await saveRun()
    }
    // 恢复大屏窗口尺寸与样式：对局结束后无 G.run，applyWindowState 会跳过，
    // 菜单屏也不会复位窗口——必须在此手动恢复，否则返回的是 460×400 小窗
    document.body.classList.remove('mini-mode')
    if (typeof window !== 'undefined' && window.api) {
      window.api.setMini(false)
      window.api.setAlwaysOnTop(false)
    }
    window.api?.petClose()
    const { show } = await import('../router.js')
    show(run ? 'map' : 'menu')
    return
  }

  if (a.type === 'sync') { pushPetState(); return }

  if (a.type === 'interact') {
    const pet = activePet(prof)
    if (!pet) return
    setPetFlash('tsundere', 3000)
    playSfx('pet')
    // 好感冷却：10分钟内仅首次触摸+1；冷却中的触摸仅播放台词，不影响互动
    const now = Date.now()
    let suffix = ''
    if (now - (prof.pet.lastInteract || 0) >= INTERACT_COOLDOWN_MS) {
      prof.pet.lastInteract = now
      const aff = addPetAffection(prof, pet.id, 1)
      await saveProfile()
      suffix = aff < 100 ? `（好感 +1 → ${aff}）` : ''
    }
    pushPetState(`${petQuote(pet, 'tsundere')}${suffix}`)
    return
  }

  if (a.type === 'feed') {
    const r = feedActivePet(prof)
    if (r.ok) playSfx('eat')
    await saveProfile()
    pushPetState(r.msg)
    return
  }

  if (a.type === 'buyFood') {
    const r = buyPetFood(prof)
    if (r.ok) playSfx('buy')
    await saveProfile()
    pushPetState(r.msg)
    return
  }

  if (a.type === 'setProtocol') {
    // 桌宠模式协议白名单：仅自动代理/智慧代理
    if (!PET_ALLOWED_PROTOCOLS.includes(a.id)) return
    if (run?.settings) {
      run.settings.protocol = a.id
      await saveRun()
      const { show, currentScreen } = await import('../router.js')
      const cur = currentScreen()
      if (cur && cur !== 'combat') show(cur)
    }
    return
  }

  if (a.type === 'toggleSound') {
    const cur = prof.sound?.enabled !== false
    prof.sound = { ...(prof.sound || {}), enabled: !cur }
    setSfxEnabled(!cur)
    await saveProfile()
    pushPetState(!cur ? '音效已开启 ♪' : '已静音')
    return
  }

  if (a.type === 'cycleSpeed') {
    if (!run?.settings) return
    const cur = run.settings.speed || 1
    run.settings.speed = cur === 1 ? 2 : cur === 2 ? 4 : 1
    await saveRun()
    pushPetState(`战斗倍速 ×${run.settings.speed}（下一场战斗生效）`)
    return
  }

  if (a.type === 'toggleAnim') {
    if (!run?.settings) return
    run.settings.animSkip = !run.settings.animSkip
    await saveRun()
    pushPetState(`跳过动画已${run.settings.animSkip ? '开启' : '关闭'}`)
    return
  }

  if (a.type === 'toggleChain') {
    prof.chainBattle = !prof.chainBattle
    playSfx('toggle')
    await saveProfile()
    pushPetState(`连战已${prof.chainBattle ? '开启：局末自动开始下一局' : '关闭'}`)
    return
  }

  if (a.type === 'setPet') {
    prof.pet.active = a.id || null
    playSfx('toggle')
    await saveProfile()
    pushPetState()
    return
  }

  if (a.type === 'viewSat' || a.type === 'viewAff') {
    const pet = activePet(prof)
    if (!pet) return
    pushPetState(a.type === 'viewSat'
      ? `饱食度 ${Math.min(100, petSatiety(prof, pet.id))}/100（口粮 ×${prof.pet.food}）`
      : `好感度 ${petAffection(prof, pet.id)}/100`)
  }
}
