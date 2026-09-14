// 桌宠定义注册表与状态机（定义数据来自外部资源包 resources/game/data/pets.json）
// 图片路径在 JSON 中声明为资源包内相对路径，加载时由 core/gameData.js 前缀 game:// 协议
// 状态机/喂食/购买等逻辑为核心侧，保留在此；保持 PET_DEFS 数组引用不变（原地填充）

// 桌宠食品价格与效果
export const FOOD_PRICE = 25          // 单份生态口粮价格（算力币）
export const FOOD_BUNDLE = 5          // 打包份数
export const FOOD_BUNDLE_PRICE = 100  // 打包价（省25）
export const FOOD_SATIETY = 30        // 每份恢复饱食度
export const SATIETY_DECAY_MINUTES = 30 // 饱食度自然衰减周期（分钟/点）

// 饱食度状态阈值
export const SATIETY_HUNGRY = 30   // ≤30 饥饿
export const SATIETY_CRY = 15      // ≤15 哭泣（0 为晕倒）

// 桌宠状态图（Q版）：normal/happy/dispirited/query/earnest/ponder/hunger/cry/dizziness/tsundere
export const PET_STATE_NAMES = {
  normal: '常态', happy: '高兴', dispirited: '沮丧', query: '疑问',
  earnest: '认真', ponder: '思索', hunger: '饥饿', cry: '哭泣',
  dizziness: '晕倒', tsundere: '傲娇'
}

// 由 core/gameData.js 加载填充（图片路径已转为 game:// URL）
export const PET_DEFS = []

export function petOf(id) {
  return PET_DEFS.find((p) => p.id === id) || null
}

// 当前装备桌宠（未拥有/未装备返回 null）
export function activePet(profile) {
  const pet = profile?.pet
  if (!pet?.active || !pet.owned?.[pet.active]) return null
  return petOf(pet.active)
}

// 桌宠饱食度（未记录视为50初始值）
export function petSatiety(profile, id) {
  const v = profile?.pet?.satiety?.[id]
  return v == null ? 50 : v
}

// 桌宠好感度（0~100，喂食/互动/胜场累积）
export function petAffection(profile, id) {
  const v = profile?.pet?.affection?.[id]
  return v == null ? 0 : Math.min(100, Math.max(0, v))
}

export function addPetAffection(profile, id, n = 1) {
  const pet = profile?.pet
  if (!pet || !pet.owned?.[id]) return 0
  pet.affection = pet.affection || {}
  pet.affection[id] = Math.min(100, (pet.affection[id] ?? 0) + n)
  return pet.affection[id]
}

// 喂食当前桌宠（校验库存与饱腹，成功时好感+2）
export function feedActivePet(profile) {
  const pet = activePet(profile)
  if (!pet) return { ok: false, msg: '尚未装备桌宠' }
  const cur = petSatiety(profile, pet.id)
  if (profile.pet.food <= 0) return { ok: false, msg: `口粮不足（库存 0）` }
  if (cur >= 100) return { ok: false, msg: '已经吃饱啦' }
  profile.pet.food -= 1
  profile.pet.satiety[pet.id] = Math.min(100, cur + FOOD_SATIETY)
  const aff = addPetAffection(profile, pet.id, 2)
  return { ok: true, msg: `饱食度 +${FOOD_SATIETY} → ${profile.pet.satiety[pet.id]}/100 · 好感 ${aff}` }
}

// 购买单份生态口粮
export function buyPetFood(profile) {
  if (profile.coins < FOOD_PRICE) return { ok: false, msg: `算力币不足（需 ${FOOD_PRICE}）` }
  profile.coins -= FOOD_PRICE
  profile.pet.food += 1
  return { ok: true, msg: `已购买口粮 ×1 · 库存 ${profile.pet.food}` }
}

// 结算算力币：层数 × 15 + 清除数 × 2（最低保底10）
export function coinsForRun(layer, kills) {
  return Math.max(10, layer * 15 + kills * 2)
}

// ══════════ 桌宠状态机 ══════════

// 按状态取Q版立绘（未知状态回落该桌宠常态）
export function chibiFor(def, state) {
  const set = def?.chibis
  return set?.[state] || set?.normal || def?.chibiImg || ''
}

// 饱食度 → 基础状态
export function petBaseState(satiety) {
  if (satiety <= 0) return 'dizziness'
  if (satiety <= SATIETY_CRY) return 'cry'
  if (satiety <= SATIETY_HUNGRY) return 'hunger'
  return 'normal'
}

// 屏幕 → 情境（作战中/等待玩家操作/战败/待机）
export const SCREEN_MOOD = {
  menu: 'idle', select: 'idle', settings: 'idle', petshop: 'idle', map: 'idle',
  combat: 'battle',
  event: 'waiting', shop: 'waiting', reward: 'waiting',
  gameover: 'defeat'
}

// 临时闪光状态（点击/胜负/AI决策等短暂表情）
let petFlash = null

export function setPetFlash(state, ms = 3000) {
  petFlash = { state, until: Date.now() + ms }
}

export function clearPetFlash() {
  petFlash = null
}

function activeFlash() {
  return petFlash && petFlash.until > Date.now() ? petFlash.state : null
}

// 综合计算桌宠当前状态：闪光 > 作战认真 > 等待疑问 > 战败沮丧/晕倒 > 饱食度分层
export function computePetState(profile, screenId) {
  const flash = activeFlash()
  if (flash) return flash
  const mood = SCREEN_MOOD[screenId] || 'idle'
  if (mood === 'battle') return 'earnest'
  if (mood === 'waiting') return 'query'
  const pet = activePet(profile)
  const sat = pet ? petSatiety(profile, pet.id) : 0
  if (mood === 'defeat') return sat <= 0 ? 'dizziness' : 'dispirited'
  return petBaseState(sat)
}

// 随机取某状态台词
export function petQuote(def, state) {
  const pool = def?.quotes?.[state] || def?.quotes?.idle || []
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : ''
}
