// 核心逻辑烟雾测试（Node 环境运行，不依赖渲染层）
// 运行：node test/smoke.mjs
import { loadGameDataFromRepo } from './loadGameData.mjs'
loadGameDataFromRepo() // 资源外部化后：先从仓库资源包加载填充各数据注册表
import { computeAttribute, computeEffAttrs } from '../src/renderer/src/core/attributes.js'
import { typeFormula, DamageType } from '../src/renderer/src/core/damage.js'
import { seedRNG, rng, rngInt } from '../src/renderer/src/core/rng.js'
import { effectCoef } from '../src/renderer/src/core/dice.js'
import { createBattle, battleStep, chooseReroll } from '../src/renderer/src/core/combat.js'
import {
  createRun, startBattle, afterBattleVictory, nodeAt, generateEnemySpec, advanceLayer, ENEMY_STAT_MULT
} from '../src/renderer/src/core/run.js'
import { addShieldLayers, addBarrier, runHealPipeline } from '../src/renderer/src/core/judgment.js'
import { ENEMY_TEMPLATES } from '../src/renderer/src/data/enemies.js'
import { TRANSLATORS, NORMAL_POOL, BOSS_POOLS } from '../src/renderer/src/data/translators.js'
import { SPECIAL_DICE } from '../src/renderer/src/data/diceDefs.js'
import { addTranslator } from '../src/renderer/src/data/events.js'
import { defaultAgentConfig, sanitizeAgentConfig, decideEventOption, decideBossLoot, decideRewardOption, decideShopActions, decideCoreSlot } from '../src/renderer/src/core/agentConfig.js'
import { migratePetIds } from '../src/renderer/src/core/petMigrate.js'

let passed = 0, failed = 0
function assert(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}`) }
}

console.log('— 属性计算器 —')
{
  // ((100+50)×1.3+10)×1.1 = 225.5
  const v = computeAttribute(100, [
    { type: 'ADDITION', value: 50 },
    { type: 'MULTIPLIER', value: 0.3 },
    { type: 'FINAL_ADDITION', value: 10 },
    { type: 'FINAL_SCALER', value: 1.1 }
  ])
  assert(Math.abs(v - 225.5) < 1e-9, '四类修饰器叠加 = 225.5')
  // 负向乘算统一加算：100×(1+0.3-0.6)=70
  const v2 = computeAttribute(100, [
    { type: 'MULTIPLIER', value: 0.3 },
    { type: 'MULTIPLIER', value: -0.6 }
  ])
  assert(Math.abs(v2 - 70) < 1e-9, '负向乘算统一加算 = 70')
  // 1+Dt < 0 补正为 0
  const v3 = computeAttribute(100, [{ type: 'MULTIPLIER', value: -2 }])
  assert(v3 === 0, '乘算下限补正为 0')
  // 钳制
  const v4 = computeAttribute(150, [], 0, 100)
  assert(v4 === 100, '范围钳制 [0,100]')
}

console.log('— 伤害公式 —')
{
  assert(typeFormula(DamageType.PHYSICAL, 1000, { def: 300 }) === 700, '物理：1000-300=700')
  assert(typeFormula(DamageType.PHYSICAL, 1000, { def: 2000 }) === 50, '物理下限 5%')
  assert(typeFormula(DamageType.MAGIC, 1000, { resist: 0 }) === 1000, '法术：0抗性全额')
  assert(typeFormula(DamageType.MAGIC, 1000, { resist: 50 }) === 500, '法术：50抗性减半')
  assert(typeFormula(DamageType.PSYCHIC, 1000, { resist: 40 }) === 600, '心理：40抗性')
  assert(typeFormula(DamageType.TRUE, 777) === 777, '真实伤害直通')
}

console.log('— 骰子机制 —')
{
  seedRNG(42)
  assert(Math.abs(effectCoef(6) - 1.0) < 1e-9, '6点系数 = 1.0')
  assert(Math.abs(effectCoef(1) - (0.5 + 1 / 12)) < 1e-9, '1点系数 ≈ 0.583')
  // 概率模拟：5颗6点 + 1-5各1颗 → P(6)=0.5
  const pool = []
  for (let p = 1; p <= 5; p++) pool.push({ pips: p })
  for (let i = 0; i < 5; i++) pool.push({ pips: 6 })
  let six = 0
  const N = 60000
  for (let i = 0; i < N; i++) if (pool[rngInt(pool.length)].pips === 6) six++
  assert(Math.abs(six / N - 0.5) < 0.02, `骰池等概率抽取 P(6)=${(six / N).toFixed(3)}`)
}

console.log('— 行动线节点 —')
{
  const seq = []
  for (let L = 1; L <= 20; L++) seq.push(nodeAt(L))
  assert(seq[0] === 'BATTLE' && seq[1] === 'BATTLE' && seq[2] === 'EVENT' && seq[3] === 'BATTLE' && seq[4] === 'BOSS', '第1段：战斗战斗事件战斗BOSS')
  assert(seq[7] === 'SHOP' && seq[12] === 'EVENT' && seq[17] === 'REWARD', '特殊节点轮换：事件→商店→事件→奖励')
}

console.log('— 虚质生成 —')
{
  seedRNG(7)
  const run = createRun('baseline', 'standard')
  const spec = generateEnemySpec(run)
  const tmpl = ENEMY_TEMPLATES.find((t) => t.name === spec.name)
  assert(!!tmpl && spec.attrs.hp >= tmpl.attrs.hp * 1.1 * ENEMY_STAT_MULT - 1, `第1层虚质生命缩放 ≥1.1×${ENEMY_STAT_MULT}（${spec.name}：${spec.attrs.hp}）`)
  run.layer = 5
  const boss = generateEnemySpec(run)
  assert(boss.name === '校验者', '第5层BOSS=校验者')
  run.layer = 20
  const boss2 = generateEnemySpec(run)
  assert(boss2.name === '校验者' && Math.abs(boss2.attrs.hp - 18000 * 1.5 * ENEMY_STAT_MULT) < 1, '第20层第二轮校验者×1.5×全局倍率')
}

console.log('— 敌方削弱规则 —')
{
  const mkSpec = (name) => ({
    name, title: '',
    attrs: {
      atk: 1000, hp: 100000, def: 0, magicResist: 0,
      physPenPct: 0, magicPenPct: 0, physPenFlat: 0, magicPenFlat: 0,
      maxPsy: 1000, psychicResist: 0, damageResist: 0
    },
    pool: []
  })
  const battle = createBattle({ allySpec: mkSpec('A'), enemySpec: mkSpec('E') })
  // 护盾：我方正常获得，敌方被禁止
  const allyShieldEv = addShieldLayers(battle.ally, 2, '测试')
  assert(allyShieldEv && battle.ally.shieldLayers === 2, '我方护盾：正常获得2层')
  const enemyShieldEv = addShieldLayers(battle.enemy, 2, '测试')
  assert(enemyShieldEv === null && battle.enemy.shieldLayers === 0, '敌方护盾：无法获得（返回null不入事件流）')
  // 屏障：敌方固定降低99.9%，我方不受影响
  const enemyBarEv = addBarrier(battle.enemy, 1000, '测试')
  assert(enemyBarEv.value === 1 && battle.enemy.barrier === 1, '敌方屏障：1000×0.1% = 1（保底1点）')
  const allyBarEv = addBarrier(battle.ally, 1000, '测试')
  assert(allyBarEv.value === 1000 && battle.ally.barrier === 1000, '我方屏障：不受衰减影响')
  // 治疗：敌方固定降低99.9%，我方不受影响
  battle.ally.hp = 50000
  battle.enemy.hp = 50000
  const enemyHealEvs = runHealPipeline(battle, battle.enemy, 10000)
  assert(enemyHealEvs[0].amount === 10, '敌方治疗：10000×0.1% = 10')
  const allyHealEvs = runHealPipeline(battle, battle.ally, 10000)
  assert(allyHealEvs[0].amount === 10000, '我方治疗：不受衰减影响')
}

console.log('— 整场战斗模拟（各干员×武器，多场） —')
{
  const combos = [
    ['baseline', 'standard'], ['offset', 'heavy'],
    ['overflow', 'interferometer'], ['parity', 'ripple']
  ]
  for (let ci = 0; ci < combos.length; ci++) {
    const [opId, wpnId] = combos[ci]
    const run = createRun(opId, wpnId)
    run.seed = 1000 + ci // 固定每组种子，覆盖 createRun 的时间种子，保证测试确定性
    let battles = 0
    while (run.layer <= 12 && battles < 30) {
      const node = nodeAt(run.layer)
      if (node === 'EVENT' || node === 'SHOP' || node === 'REWARD') {
        advanceLayer(run)
        continue
      }
      const { battle } = startBattle(run)
      let steps = 0
      while (!battle.over && steps < 5000) {
        const res = battleStep(battle)
        steps++
        if (battle.waiting) chooseReroll(battle, rng() < 0.3 ? 0 : null)
      }
      assert(!!battle.over, `${opId}/${wpnId} 第${run.layer}层战斗正常结束（${steps}步，${battle.over}）`)
      if (battle.over !== 'victory') break
      afterBattleVictory(run, battle)
      advanceLayer(run)
      battles++
      if (battles >= 8) break
    }
  }
}

console.log('— 心理崩溃链路（专项） —')
{
  // 固定种子（startBattle 读取 run.seed 恢复随机数状态，保证确定性）
  const run = createRun('overflow', 'standard')
  run.extraDice.push('gloomDie', 'gloomDie', 'chaosDie', 'overloadDie')
  run.seed = 20260910
  const { battle } = startBattle(run)
  // 双方生命值放大，确保战斗持续足够长以观察崩溃链路
  battle.ally.attrs.hp = 50_000_000
  battle.ally.hp = 50_000_000
  battle.enemy.attrs.hp = 50_000_000
  battle.enemy.hp = 50_000_000
  let crashed = false, paralysisSeen = false, steps = 0
  while (steps < 4000 && !(crashed && paralysisSeen)) {
    const res = battleStep(battle)
    steps++
    if (battle.waiting) chooseReroll(battle, null)
    for (const e of res.events) {
      if (e.type === 'crash') crashed = true
      if (e.type === 'paralysis') paralysisSeen = true
    }
    if (battle.over) break
  }
  assert(crashed, '心理损伤累计触发了崩溃')
  assert(paralysisSeen, '过载崩溃产生麻痹充能')
}

console.log('— 自动代理优先级 —')
{
  const cfg = defaultAgentConfig()
  const run = createRun('baseline', 'standard')
  // 事件：熵蚀深渊 生命过低时回落到"拒绝"（末选项）
  run.hp = run.hp * 0.3
  const idxLow = decideEventOption(cfg, 'entropyAbyss', [{ label: '接受' }, { label: '拒绝' }], run)
  run.hp = run.hp * 2
  const idxHigh = decideEventOption(cfg, 'entropyAbyss', [{ label: '接受' }, { label: '拒绝' }], run)
  assert(idxLow === 1 && idxHigh === 0, `事件优先级：低生命拒绝(${idxLow}) 高生命接受(${idxHigh})`)
  // BOSS掉落优先序
  assert(decideBossLoot(cfg, 'verifier', ['exceptionCatch', 'assertModule']) === 'assertModule', 'BOSS掉落按优先序选择')
  // 奖励关：低生命优先治疗
  run.hp = 1000
  assert(decideRewardOption(cfg, run) === 2, '奖励关低生命优先治疗')
  // 商店：生命不足时优先恢复商品
  const shelf = [
    { kind: 'translator', id: 'hotSpare', name: '热备援', price: 90 },
    { kind: 'special', ref: { id: 'injection' }, name: '恢复注射', price: 80 }
  ]
  run.flux = 300
  const acts = decideShopActions(cfg, run, shelf)
  assert(acts[0].type === 'buy' && shelf[acts[0].idx].ref?.id === 'injection', '商店：低生命优先恢复注射')
  assert(acts[acts.length - 1].type === 'leave', '商店动作序列以离开结束')
  // 核心放置：槽满时低优先级被替换
  run.coreSlots = ['boundPointer', 'entropyEngine', 'covarianceCore']
  const slot = decideCoreSlot(cfg, run, 'covarianceCore')
  assert(slot === 0, '核心槽满时替换最低优先级（boundPointer）')
  // 校验：非法配置回落默认
  const bad = sanitizeAgentConfig({ eventPriority: { nonsense: { prefer: [9] } }, shop: { keepFlux: 'x' }, corePriority: ['notExist'] })
  assert(bad.corePriority.length === 3 && bad.shop.keepFlux === 60, '非法配置项回落默认')
}

console.log('— 资源规模与一致性（动态校验：规模只设下限防数据丢失，内容增长无需改测试） —')
{
  const tl = Object.values(TRANSLATORS)
  // 规模下限：以当前资源包规模为底线（捕获数据文件损坏/漏加载/误删；新增内容不受限）
  assert(Object.keys(TRANSLATORS).length >= 104, `转译器总数 ≥104（实际 ${Object.keys(TRANSLATORS).length}）`)
  assert(Object.keys(SPECIAL_DICE).length >= 51, `特殊骰总数 ≥51（实际 ${Object.keys(SPECIAL_DICE).length}）`)
  assert(NORMAL_POOL.length >= 71, `普通转译器 ≥71（实际 ${NORMAL_POOL.length}）`)
  assert(tl.filter((t) => t.tier === 'core').length >= 9, '核心转译器 ≥9 个')
  assert(tl.filter((t) => t.tier === 'high').length >= 24, '高阶转译器 ≥24 个')
  assert(['verifier', 'recursion', 'nullref'].every((b) => BOSS_POOLS[b].length >= 8), '各BOSS高阶池 ≥8 个')
  assert(tl.filter((t) => t.synergy).length >= 18, '连携型转译器 ≥18 个')
  // 派生一致性：加载/编译无遗漏（普通池与 normal 层互为镜像）
  assert(NORMAL_POOL.length === tl.filter((t) => t.tier === 'normal').length
    && NORMAL_POOL.every((t) => t.tier === 'normal'), '普通池与 normal 层完全一致')
  assert(Object.entries(BOSS_POOLS).every(([boss, ids]) => ids.every((id) => TRANSLATORS[id]?.boss === boss)), 'BOSS池id与归属一致')
  // id 唯一与引用完整
  assert(new Set(tl.map((t) => t.id)).size === tl.length, '转译器 id 唯一')
  assert(tl.every((t) => !t.synergy || t.synergy.requires.every((id) => TRANSLATORS[id])), '连携 requires 引用的转译器全部存在')
  // 设计契约（不随内容增长放宽）
  assert(NORMAL_POOL.every((t) => [60, 90, 120, 150].includes(t.price)), '普通转译器定价仅 60/90/120/150 四档')
  assert(tl.every((t) => ['normal', 'core', 'high'].includes(t.tier) && t.desc), '转译器 tier 枚举与 desc 字段完整')
}

console.log('— v0.23.0 扩充内容：新fx引擎专项 —')
{
  // 单骰池驱动：我方仅1颗测试骰、敌方1颗纯点骰，事件流可观测
  const spec = (name, pool, attrs = {}) => ({
    name, title: '',
    attrs: {
      atk: 1000, hp: 100000, def: 0, magicResist: 0,
      physPenPct: 0, magicPenPct: 0, physPenFlat: 0, magicPenFlat: 0,
      maxPsy: 1000, psychicResist: 0, damageResist: 0, ...attrs
    },
    pool
  })
  const pureDie = { id: 'pure1', pips: 6, kinds: ['PURE'], onRoll: [] } // 敌方6点纯骰：避免与低点测试骰平局死循环
  function drive(allyPool, maxSteps = 40, onSetup) {
    seedRNG(42)
    const battle = createBattle({
      allySpec: spec('A', allyPool),
      enemySpec: spec('E', [pureDie], { atk: 10 }),
      onSetup
    })
    const events = []
    let steps = 0
    while (!battle.over && steps < maxSteps) {
      const res = battleStep(battle)
      steps++
      events.push(...res.events)
      if (battle.waiting) chooseReroll(battle, null)
    }
    return { battle, events }
  }
  const die = (id) => ({ ...SPECIAL_DICE[id] })

  // 护盾骰：护盾层事件
  {
    const { events } = drive([die('shieldDie')])
    assert(events.some((e) => e.type === 'shieldLayerGain' && e.side === 'ally'), '护盾骰：获得护盾层')
  }
  // 不稳骰：2500固定真伤
  {
    const { events, battle } = drive([die('unstableDie')])
    const dmg = events.find((e) => e.type === 'damage' && e.side === 'enemy')
    assert(dmg && dmg.amount === 2500 && dmg.dtype === DamageType.TRUE, `不稳骰：2500固定真伤（${dmg?.amount}）`)
    assert(battle.ally.pool.length === 0, '不稳骰：易碎离池')
  }
  // 骰子淬火：易碎骰保留
  {
    const { battle } = drive([die('unstableDie')], 40, (b) => {
      TRANSLATORS.dieHardening.onBattle({ battle: b, ally: b.ally, stacks: 1, run: { translators: [] } })
    })
    assert(battle.ally.flags.fragileKeep && battle.ally.pool.length > 0, '骰子淬火：易碎骰投出后保留')
  }
  // 弹幕骰：3段独立结算
  {
    const { events } = drive([die('gatlingDie')], 14)
    const segs = events.filter((e) => e.type === 'damage' && e.side === 'enemy').length
    assert(segs >= 3, `弹幕骰：单回合3段伤害（${segs}段）`)
  }
  // 吸血骰：造成伤害后产生治疗
  {
    const { events } = drive([die('leechDie')])
    assert(events.some((e) => e.type === 'damage' && e.side === 'enemy')
      && events.some((e) => e.type === 'heal' && e.side === 'ally'), '吸血骰：伤害+吸血治疗')
  }
  // 定身骰：敌方麻痹充能
  {
    const { events } = drive([die('freezeDie')], 30)
    assert(events.some((e) => e.type === 'paralysis' && e.side === 'enemy')
      || events.some((e) => e.type === 'paralyzed' && e.side === 'enemy'), '定身骰：敌方获得麻痹')
  }
  // 转置骰：点数交换事件
  {
    const { events } = drive([die('transposeDie'), { id: 'attack', pips: 2, kinds: ['ATTACK'], onRoll: [{ fx: 'attack' }] }], 20)
    assert(events.some((e) => e.type === 'transpose'), '转置骰：点数交换')
  }
  // 赏金骰：战后通量标记
  {
    const { battle } = drive([die('bountyDie')], 20)
    assert(battle._bonusFlux >= 25, `赏金骰：战后通量标记（+${battle._bonusFlux}）`)
  }
  // 尖峰骰：自伤真伤
  {
    const { events } = drive([die('spikeDie')])
    assert(events.some((e) => e.type === 'damage' && e.side === 'ally' && e.cause === 'selfDamage'), '尖峰骰：自身真伤')
  }
  // 裂伤骰：定时易伤（recvMults带turns）
  {
    const { events } = drive([die('vulnDie')])
    assert(events.some((e) => e.type === 'debuff' && e.side === 'enemy'), '裂伤骰：敌方易伤')
  }
  // 衰变协议：攻击附加DOT
  {
    const atk4 = { id: 'attack', pips: 4, kinds: ['ATTACK'], onRoll: [{ fx: 'attack' }] }
    const { battle } = drive([atk4], 20, (b) => {
      TRANSLATORS.decayProtocol.onBattle({ battle: b, ally: b.ally, stacks: 1, run: { translators: [] } })
    })
    assert(battle.enemy.dots.length > 0, '衰变协议：敌方持续伤害生效')
  }
  // 荆棘（哨岗骰）：反弹事件
  {
    const enemyAtk = { id: 'attack', pips: 6, kinds: ['ATTACK'], onRoll: [{ fx: 'attack' }] }
    seedRNG(7)
    const battle = createBattle({
      allySpec: spec('A', [die('sentryDie')], { hp: 500000 }),
      enemySpec: spec('E', [enemyAtk], { atk: 800 })
    })
    const events = []
    let steps = 0
    while (!battle.over && steps < 30) {
      const res = battleStep(battle)
      steps++
      events.push(...res.events)
      if (battle.waiting) chooseReroll(battle, null)
    }
    assert(events.some((e) => e.type === 'judgeProc' && String(e.label).startsWith('哨岗')), '哨岗骰：荆棘反弹')
  }
}

console.log('— v0.23.0 扩充内容：连携两态验证 —')
{
  // 玻璃大炮负面取消（单件 vs 组合）
  {
    const run = createRun('baseline', 'standard')
    run.seed = 99
    addTranslator(run, 'glassCannon')
    const single = startBattle(run).battle
    assert(single.ally.recvMults.some((m) => m.label === '玻璃大炮'), '玻璃大炮单件：受伤+10%生效')
    const run2 = createRun('baseline', 'standard')
    run2.seed = 99
    addTranslator(run2, 'glassCannon')
    addTranslator(run2, 'survivalInstinct')
    const combo = startBattle(run2).battle
    assert(combo.ally.recvMults.every((m) => m.label !== '玻璃大炮'), '连携：求生本能取消玻璃大炮负面')
    assert(combo.ally.dealMults.some((m) => m.label === '求生本能·连携'), '连携：求生本能追加低血增伤')
  }
  // 栈溢出阈值：标准武器8颗骰 → 单件+16%，组合+32%
  {
    const run = createRun('baseline', 'standard')
    run.seed = 98
    addTranslator(run, 'stackOverflow')
    const single = startBattle(run).battle
    const provOf = (b, label) => b.ally.dynamicProviders.flatMap((p) => p(b.ally)).filter((m) => m.label === label)
    assert(Math.abs(provOf(single, '栈溢出')[0]?.value - 0.16) < 1e-9, '栈溢出单件：第7颗起计（+16%）')
    const run2 = createRun('baseline', 'standard')
    run2.seed = 98
    addTranslator(run2, 'stackOverflow')
    addTranslator(run2, 'poolArchitect')
    const combo = startBattle(run2).battle
    assert(Math.abs(provOf(combo, '栈溢出')[0]?.value - 0.32) < 1e-9, '连携：栈溢出阈值改为第5颗起计（+32%）')
  }
  // 应急熔断复活比例：单件30% vs 组合60%+2护盾
  {
    const run = createRun('baseline', 'standard')
    run.seed = 97
    addTranslator(run, 'fuseBreaker')
    const single = startBattle(run).battle
    assert(single.ally.flags.reviveAvailable && (single.ally.flags.reviveHpPct ?? 0.3) === 0.3, '应急熔断单件：30%复活')
    const run2 = createRun('baseline', 'standard')
    run2.seed = 97
    addTranslator(run2, 'fuseBreaker')
    addTranslator(run2, 'lastStand')
    const combo = startBattle(run2).battle
    assert(combo.ally.flags.reviveHpPct === 0.6 && combo.ally.flags.reviveShields === 2, '连携：复活60%+2层护盾')
  }
  // 通量透镜快照：1000通量 → +15%
  {
    const run = createRun('baseline', 'standard')
    run.seed = 96
    run.flux = 1000
    addTranslator(run, 'fluxLens')
    const { battle } = startBattle(run)
    battleStep(battle)
    assert(battle.ally.mods.some((m) => m.label === '通量透镜' && Math.abs(m.value - 0.15) < 1e-9), '通量透镜：1000通量快照+15%（触顶）')
  }
  // 量子重掷充能：单件1次 vs 组合2次
  {
    const run = createRun('baseline', 'standard')
    run.seed = 95
    addTranslator(run, 'quantumReroll')
    const { battle } = startBattle(run)
    battleStep(battle)
    assert(battle.ally.flags.rerollAnyCharges === 1, '量子重掷单件：不限点数重抽+1')
    const run2 = createRun('baseline', 'standard')
    run2.seed = 95
    addTranslator(run2, 'quantumReroll')
    addTranslator(run2, 'rerollMastery')
    const { battle: b2 } = startBattle(run2)
    battleStep(b2)
    assert(b2.ally.flags.rerollAnyCharges === 2, '连携：量子重掷充能1→2')
  }
  // 虚拟内存+骰池架构：骰池上限再+2
  {
    const run = createRun('baseline', 'standard')
    run.seed = 94
    addTranslator(run, 'virtualMemory')
    addTranslator(run, 'poolArchitect')
    const { battle } = startBattle(run)
    assert(battle.ally.poolCap === 14, `连携：骰池上限10+2+2=14（实际${battle.ally.poolCap}）`)
  }
  // 互斥锁：屏障倍率+击破赠盾标记
  {
    const run = createRun('baseline', 'standard')
    run.seed = 93
    addTranslator(run, 'mutex')
    run.coreSlots[0] = 'mutex'
    const { battle } = startBattle(run)
    assert(Math.abs(battle.ally.barrierMult - 1.2) < 1e-9 && battle.ally.flags.mutexOnBreak, '互斥锁核心：屏障+20%与击破赠盾')
  }
}

console.log('— v0.23.0 扩充内容：胜利结算钩子 —')
{
  const run = createRun('baseline', 'standard')
  run.flux = 0
  run.layer = 1
  addTranslator(run, 'compilerCache') // 叠2层
  addTranslator(run, 'compilerCache')
  const fake = { ally: { hp: 1000 }, _bonusFlux: 25 }
  const r = afterBattleVictory(run, fake)
  assert(r.flux === 79, `胜利结算：基础24+编译缓存30+赏金25=79（实际${r.flux}）`)
  // 复利计息上限：2000通量5%=100，单件上限50
  const run2 = createRun('baseline', 'standard')
  run2.flux = 2000
  addTranslator(run2, 'compoundInterest')
  const r2 = afterBattleVictory(run2, { ally: { hp: 1000 }, _bonusFlux: 0 })
  assert(r2.flux >= 50 && run2.flux > 2000, '复利计息：单次上限50生效')
  const run3 = createRun('baseline', 'standard')
  run3.flux = 2000
  addTranslator(run3, 'compoundInterest')
  addTranslator(run3, 'fluxLens')
  const before = run3.flux
  afterBattleVictory(run3, { ally: { hp: 1000 }, _bonusFlux: 0 })
  assert(run3.flux - before >= 100, '连携：复利计息上限50→100')
}

console.log('— v2.0.0 桌宠存档迁移（购买丢失 bug 修复） —')
{
  const MIGRATE = { muelsyse: 'luolian' }
  const liveIds = ['muelsyse', 'luolian', 'lilong', 'jingxi'] // 当前定义表：muelsyse 已被新缪尔赛思复用
  // 场景1：购买新缪尔赛思（owned.muelsyse）→ 重启清洗 → 必须保留（bug 修复核心验收）
  const bought = migratePetIds(
    { owned: { muelsyse: true }, active: 'muelsyse', satiety: { muelsyse: 50 }, affection: { muelsyse: 3 } },
    liveIds, MIGRATE
  )
  assert(bought.owned.muelsyse === true && bought.owned.luolian === undefined, '购买新缪尔赛思：活 id 不迁移，所有权保留')
  assert(bought.active === 'muelsyse' && bought.satiety.muelsyse === 50 && bought.affection.muelsyse === 3, '购买新缪尔赛思：装备/饱食度/好感度完整保留')
  // 场景2：未来 id 退役（muelsyse 从定义表移除）→ 旧数据一次性迁移到 luolian
  const retired = migratePetIds(
    { owned: { muelsyse: true }, active: 'muelsyse', satiety: { muelsyse: 40 }, affection: {} },
    ['luolian', 'lilong', 'jingxi'], MIGRATE
  )
  assert(retired.owned.luolian === true && retired.owned.muelsyse === undefined, 'id 退役：所有权迁移至新 id')
  assert(retired.active === 'luolian' && retired.satiety.luolian === 40, 'id 退役：装备与饱食度随迁')
  assert(Array.isArray(retired.migrations) && retired.migrations.includes('muelsyse->luolian'), '迁移记录写入 migrations 数组')
  // 场景3：已迁移过的存档再次清洗 → 幂等，不重复处理
  const again = migratePetIds(
    { owned: { luolian: true, muelsyse: true }, active: 'luolian', satiety: {}, affection: {}, migrations: ['muelsyse->luolian'] },
    ['luolian', 'lilong', 'jingxi'], MIGRATE
  )
  assert(again.owned.luolian === true && again.owned.muelsyse === true, '已迁移记录：同一条目只执行一次（幂等）')
  // 场景4：定义表未加载（资源缺失）→ 跳过迁移，不误删
  const noDefs = migratePetIds(
    { owned: { muelsyse: true }, active: 'muelsyse', satiety: {}, affection: {} },
    [], MIGRATE
  )
  assert(noDefs.owned.muelsyse === true, '定义表为空：跳过迁移，数据原样保留')
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
