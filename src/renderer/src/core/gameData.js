// 游戏资源数据加载器：拉取外部资源包 JSON → 编译 → 原地填充各 data 注册表
// 渲染层走 game:// 协议 fetch；Node 测试环境（test/loadGameData.mjs）直接复用 applyGameData
// 加载完成后各 data 模块导出对象/数组保持原引用（原地填充），全部消费方 import 零改动
import { BASE_DICE, SPECIAL_DICE, PURE_DICE, EXTRA_DICE, ALL_DICE } from '../data/diceDefs.js'
import { TRANSLATORS, NORMAL_POOL, BOSS_POOLS } from '../data/translators.js'
import { ENEMY_TEMPLATES, BOSSES } from '../data/enemies.js'
import { OPERATORS } from '../data/operators.js'
import { WEAPONS } from '../data/weapons.js'
import { EVENTS, REWARD_OPTIONS } from '../data/events.js'
import { PET_DEFS } from '../data/pets.js'
import { fillImageMap } from '../data/images.js'
import { compileTranslator, compileEnemy, compileOperator, compileWeapon } from './fxRegistry.js'
import { compileEvent, compileRewardOption } from './eventScripts.js'

// ── 填充工具：保持导出引用不变 ──
function fillObject(target, src) {
  for (const k of Object.keys(target)) delete target[k]
  Object.assign(target, src)
}

function fillArray(target, items) {
  target.length = 0
  target.push(...items)
}

// ── 应用资源数据（渲染层与 Node 测试共用）──
// data = { dice, translators, enemies, operators, weapons, events, pets }
// imageMap = { characters:{id:url}, weapons:{}, translators:{} } | null（Node 测试无图片）
export function applyGameData(data, imageMap) {
  // 骰子：原样平移（本就声明式）
  fillObject(BASE_DICE, data.dice.base || {})
  fillObject(SPECIAL_DICE, data.dice.special || {})
  fillObject(PURE_DICE, data.dice.pure || {})
  fillObject(EXTRA_DICE, data.dice.extra || {})
  fillObject(ALL_DICE, { ...BASE_DICE, ...SPECIAL_DICE, ...PURE_DICE, ...EXTRA_DICE })

  // 转译器：编译声明式效果
  const compiled = (data.translators || []).map((t) => compileTranslator(t))
  fillObject(TRANSLATORS, Object.fromEntries(compiled.map((t) => [t.id, t])))
  fillArray(NORMAL_POOL, compiled.filter((t) => t.tier === 'normal'))
  fillObject(BOSS_POOLS, {
    verifier: compiled.filter((t) => t.boss === 'verifier').map((t) => t.id),
    recursion: compiled.filter((t) => t.boss === 'recursion').map((t) => t.id),
    nullref: compiled.filter((t) => t.boss === 'nullref').map((t) => t.id)
  })

  // 敌人 / 干员 / 武器
  fillArray(ENEMY_TEMPLATES, (data.enemies.templates || []).map((e) => compileEnemy(e)))
  fillArray(BOSSES, (data.enemies.bosses || []).map((e) => compileEnemy(e)))
  fillArray(OPERATORS, (data.operators || []).map((o) => compileOperator(o)))
  fillArray(WEAPONS, (data.weapons || []).map((w) => compileWeapon(w)))

  // 事件与奖励关
  fillArray(EVENTS, (data.events.events || []).map((e) => compileEvent(e)))
  fillArray(REWARD_OPTIONS, (data.events.rewards || []).map((r) => compileRewardOption(r)))

  // 桌宠：图片相对路径 → game:// URL；chibiImg 为常态Q版（chibiFor 兜底用）
  const pets = (data.pets || []).map((p) => {
    const chibis = {}
    for (const [state, rel] of Object.entries(p.chibis || {})) {
      chibis[state] = rel.startsWith('game://') ? rel : `game://${rel}`
    }
    return { ...p, chibis, chibiImg: chibis.normal || '', fullImg: p.fullImg ? `game://${p.fullImg}` : '' }
  })
  fillArray(PET_DEFS, pets)

  // 图片映射（三类「文件名=id」目录）
  if (imageMap) fillImageMap(imageMap)
}

// ── 渲染层入口：game:// 协议拉取 + 主进程图片映射 ──
const DATA_FILES = ['dice', 'translators', 'enemies', 'operators', 'weapons', 'events', 'pets']

async function fetchJson(name) {
  const res = await fetch(`game://data/${name}.json`)
  if (!res.ok) throw new Error(`资源加载失败：data/${name}.json（HTTP ${res.status}）`)
  return res.json()
}

export async function loadGameData() {
  const list = await Promise.all(DATA_FILES.map((n) => fetchJson(n)))
  const data = {}
  DATA_FILES.forEach((n, i) => { data[n] = list[i] })
  const imageMap = typeof window !== 'undefined' && window.api?.resourceImageMap
    ? await window.api.resourceImageMap()
    : null
  applyGameData(data, imageMap)
  return true
}
