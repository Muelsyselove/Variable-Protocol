// 资源包 lint（npm test 的一部分）：校验资源 JSON 的 schema、fx 引用完整性、图片存在性
// 运行：node test/resourceLint.mjs
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGameDataFromRepo } from './loadGameData.mjs'
import { FX_NAMES } from '../src/renderer/src/core/fxRegistry.js'
import { OUTCOME_FX_NAMES, SCRIPT_NAMES } from '../src/renderer/src/core/eventScripts.js'
import { defaultAgentConfig } from '../src/renderer/src/core/agentConfig.js'
import { TRANSLATORS, NORMAL_POOL, BOSS_POOLS } from '../src/renderer/src/data/translators.js'
import { ENEMY_TEMPLATES, BOSSES } from '../src/renderer/src/data/enemies.js'
import { OPERATORS } from '../src/renderer/src/data/operators.js'
import { WEAPONS } from '../src/renderer/src/data/weapons.js'
import { EVENTS, REWARD_OPTIONS } from '../src/renderer/src/data/events.js'
import { PET_DEFS } from '../src/renderer/src/data/pets.js'
import { ALL_DICE, SPECIAL_DICE } from '../src/renderer/src/data/diceDefs.js'

const RES_ROOT = fileURLToPath(new URL('../resources/game/', import.meta.url))
let passed = 0, failed = 0
function assert(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}`) }
}

console.log('— 资源加载 —')
const raw = loadGameDataFromRepo()
assert(!!raw && Object.keys(TRANSLATORS).length > 0, '资源包 JSON 全部可解析并编译')

console.log('— fx 引用完整性 —')
{
  const setupFx = new Set(FX_NAMES.setup)
  const eventFx = new Set(FX_NAMES.event)
  const victoryFx = new Set(FX_NAMES.victory)
  const acquireFx = new Set(FX_NAMES.acquire)
  const outcomeFx = new Set(OUTCOME_FX_NAMES)
  const scripts = new Set(SCRIPT_NAMES)
  let bad = []

  // 收集所有 fx 引用并按语境校验
  for (const t of raw.translators) {
    for (const e of t.onAcquire || []) if (!acquireFx.has(e.fx)) bad.push(`translators/${t.id} onAcquire → ${e.fx}`)
    for (const e of t.onBattle || []) {
      if (!setupFx.has(e.fx)) bad.push(`translators/${t.id} onBattle → ${e.fx}`)
      if (e.fx === 'on') for (const d of e.params.do || []) if (!eventFx.has(d.fx)) bad.push(`translators/${t.id} on(${e.params.event}) → ${d.fx}`)
    }
    for (const e of t.onVictory || []) if (!victoryFx.has(e.fx)) bad.push(`translators/${t.id} onVictory → ${e.fx}`)
    if (t.synergy?.onBattle) for (const e of t.synergy.onBattle) {
      if (!setupFx.has(e.fx)) bad.push(`translators/${t.id} synergy → ${e.fx}`)
      if (e.fx === 'on') for (const d of e.params.do || []) if (!eventFx.has(d.fx)) bad.push(`translators/${t.id} synergy on → ${d.fx}`)
    }
  }
  for (const list of [raw.enemies.templates, raw.enemies.bosses]) {
    for (const en of list) {
      for (const e of en.setupFx || []) {
        if (!setupFx.has(e.fx)) bad.push(`enemies/${en.id} → ${e.fx}`)
        if (e.fx === 'on') for (const d of e.params.do || []) if (!eventFx.has(d.fx)) bad.push(`enemies/${en.id} on → ${d.fx}`)
      }
    }
  }
  for (const op of raw.operators) {
    for (const e of [...(op.setupFx || []), ...(op.abilityFx || [])]) if (!setupFx.has(e.fx)) bad.push(`operators/${op.id} → ${e.fx}`)
  }
  for (const w of raw.weapons) {
    for (const e of w.setupFx || []) if (!setupFx.has(e.fx)) bad.push(`weapons/${w.id} → ${e.fx}`)
  }
  for (const ev of raw.events.events) {
    for (const o of ev.options || []) {
      if (o.script && !scripts.has(o.script)) bad.push(`events/${ev.id} script → ${o.script}`)
      for (const e of o.outcomes || []) if (!outcomeFx.has(e.fx)) bad.push(`events/${ev.id} outcome → ${e.fx}`)
    }
  }
  for (const r of raw.events.rewards) {
    if (r.script && !scripts.has(r.script)) bad.push(`rewards script → ${r.script}`)
    for (const e of r.outcomes || []) if (!outcomeFx.has(e.fx)) bad.push(`rewards outcome → ${e.fx}`)
  }
  assert(bad.length === 0, bad.length === 0 ? '全部 fx/脚本引用可解析' : `未知 fx 引用：${bad.slice(0, 5).join('；')}`)
}

console.log('— 规模下限与结构契约（动态校验：内容增长无需改测试） —')
{
  // 规模下限：以当前资源包规模为底线（捕获数据文件损坏/漏加载/误删；新增内容不受限）
  assert(Object.keys(TRANSLATORS).length >= 104, `转译器 ≥104（实际 ${Object.keys(TRANSLATORS).length}）`)
  assert(Object.keys(SPECIAL_DICE).length >= 51, `特殊骰 ≥51（实际 ${Object.keys(SPECIAL_DICE).length}）`)
  assert(ENEMY_TEMPLATES.length >= 12 && BOSSES.length >= 3, `虚质模板 ≥12 + BOSS ≥3（实际 ${ENEMY_TEMPLATES.length}+${BOSSES.length}）`)
  assert(OPERATORS.length >= 4 && WEAPONS.length >= 4, `干员 ≥4 + 武器 ≥4（实际 ${OPERATORS.length}+${WEAPONS.length}）`)
  assert(EVENTS.length >= 8 && REWARD_OPTIONS.length >= 3, `事件 ≥8 + 奖励选项 ≥3（实际 ${EVENTS.length}+${REWARD_OPTIONS.length}）`)
  assert(PET_DEFS.length >= 4, `桌宠 ≥4（实际 ${PET_DEFS.length}）`)
  // id 唯一性（各注册表）
  const uniq = (list) => new Set(list.map((x) => x.id)).size === list.length
  assert(uniq(Object.values(TRANSLATORS)) && uniq(Object.values(ALL_DICE)) && uniq([...ENEMY_TEMPLATES, ...BOSSES])
    && uniq(OPERATORS) && uniq(WEAPONS) && uniq(EVENTS) && uniq(PET_DEFS), '全部资源 id 无重复')
  // 结构契约（不随内容增长放宽）
  assert(NORMAL_POOL.every((t) => [60, 90, 120, 150].includes(t.price)), '普通转译器定价仅 60/90/120/150 四档')
  assert(EVENTS.every((e) => e.id && e.name && e.desc && e.options?.length > 0
    && e.options.every((o) => o.label && typeof o.resolve === 'function')), '事件结构与选项 resolve 完整')
  assert(REWARD_OPTIONS.every((o) => o.label && typeof o.resolve === 'function'), '奖励选项 resolve 完整')
  assert(PET_DEFS.every((p) => p.chibis?.normal && p.fullImg), '桌宠常态Q版与全身立绘字段完整')
}

console.log('— 默认代理配置引用（动态校验：资源改动后默认配置仍指向存在条目） —')
{
  const cfg = defaultAgentConfig()
  const tIds = new Set(Object.keys(TRANSLATORS))
  const eIds = new Set(EVENTS.map((e) => e.id))
  assert(OPERATORS.some((o) => o.id === cfg.opening.operator) && WEAPONS.some((w) => w.id === cfg.opening.weapon), '默认开局干员/武器存在')
  assert(Object.keys(cfg.eventPriority).every((id) => eIds.has(id)), '默认事件优先级引用的事件全部存在')
  assert(cfg.shop.buyPriorities.every((id) => tIds.has(id)), '默认商店清单引用的转译器全部存在')
  assert(Object.entries(cfg.bossLoot).every(([boss, ids]) => ids.every((id) => TRANSLATORS[id]?.boss === boss)), '默认BOSS掉落清单引用的转译器全部存在且归属正确')
  assert(cfg.corePriority.every((id) => tIds.has(id)), '默认核心放置清单引用的转译器全部存在')
}

console.log('— 图片存在性 —')
{
  const resolve = (rel) => join(RES_ROOT, ...rel.split('/'))
  let missing = []
  // 桌宠：每只 10 状态 + 全身立绘
  for (const p of PET_DEFS) {
    for (const [state, url] of Object.entries(p.chibis)) {
      const rel = url.replace('game://', '')
      if (!existsSync(resolve(rel))) missing.push(`${p.id}/${state}`)
    }
    if (p.fullImg && !existsSync(resolve(p.fullImg.replace('game://', '')))) missing.push(`${p.id}/full`)
  }
  assert(missing.length === 0, missing.length === 0 ? '桌宠全部状态立绘存在' : `缺失：${missing.slice(0, 5).join('、')}`)

  // 三类「文件名=id」目录：资源定义的每个 id 都有图
  const cats = [['characters', OPERATORS.map((o) => o.id)], ['weapons', WEAPONS.map((w) => w.id)], ['translators', Object.keys(TRANSLATORS)]]
  let miss2 = []
  for (const [cat, ids] of cats) {
    for (const id of ids) {
      if (!existsSync(resolve(`images/${cat}/${id}.png`))) miss2.push(`${cat}/${id}`)
    }
  }
  assert(miss2.length === 0, miss2.length === 0 ? '干员/武器/转译器贴图齐全' : `缺失：${miss2.slice(0, 5).join('、')}`)

  // 骰子引用完整性：武器/敌人骰池引用的骰子 id 存在
  let miss3 = []
  for (const w of WEAPONS) for (const id of w.special) if (!ALL_DICE[id]) miss3.push(`weapons/${w.id}→${id}`)
  for (const en of [...ENEMY_TEMPLATES, ...BOSSES]) for (const id of en.pool?.special || []) if (!ALL_DICE[id]) miss3.push(`enemies/${en.id}→${id}`)
  assert(miss3.length === 0, miss3.length === 0 ? '骰池引用的骰子 id 全部存在' : `未知骰子：${miss3.join('、')}`)
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
