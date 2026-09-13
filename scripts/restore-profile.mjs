// 存档恢复脚本：从历史备份恢复用户档案（无BOM写入）
// 运行：node scripts/restore-profile.mjs
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(process.env.APPDATA, 'variable-protocol', 'saves', 'profile.json')

const profile = {
  bestLayer: 75,
  totalRuns: 4,
  totalKills: 75,
  coins: 1000,
  pet: {
    owned: { muelsyse: true },
    active: 'muelsyse',
    food: 0,
    satiety: { muelsyse: 50 },
    affection: { muelsyse: 0 },
    lastDecay: Date.now()
  },
  sound: { enabled: true, volume: 0.8 },
  ai: {
    endpoint: 'https://api.deepseek.com',
    // 密钥从环境变量传入（VP_AI_KEY），禁止硬编码
    apiKey: process.env.VP_AI_KEY || '',
    model: 'deepseek-flash'
  },
  agentConfig: {
    eventPriority: {
      randomNumber: { prefer: [0, 1], minFlux: 120, minHpPct: 0.6 },
      dataDebris: { prefer: [2, 1, 0], minHpPct: 0.6 },
      overclock: { prefer: [0, 1], minHpPct: 0.7 },
      resonance: { prefer: [0, 1] },
      entropyAbyss: { prefer: [0, 1], minHpPct: 0.65 },
      parallelSample: { prefer: [0, 1] },
      voidWhisper: { prefer: [0, 1], minHpPct: 0.5 },
      redundantBackup: { prefer: [0] }
    },
    shop: {
      healBelowPct: 0.55,
      buyPriorities: [
        'greedySample', 'fluxSiphon', 'fuseBreaker', 'hotSpare', 'fastIter',
        'freqShift', 'spectrumProbe', 'etchMold', 'psyLens', 'signalAmp', 'mirrorReflect'
      ],
      keepFlux: 70,
      buyPoolExpand: true,
      buyDicePack: true
    },
    rewardPriority: { prefer: [0, 1, 2], healBelowPct: 0.5 },
    bossLoot: {
      verifier: ['assertModule', 'redundantCheck', 'exceptionCatch'],
      recursion: ['tailCall', 'memLeak', 'stackOverflow'],
      nullref: ['nullMerge', 'lazyEval', 'shortCircuit']
    },
    corePriority: ['covarianceCore', 'entropyEngine', 'boundPointer']
  },
  miniStyle: 'pet'
}

// Node writeFileSync 默认 UTF-8 无 BOM，JSON.parse 可直接读取
writeFileSync(OUT, JSON.stringify(profile, null, 2), 'utf-8')
console.log(`已恢复存档：${OUT}`)
console.log(`算力币 1000 · 最深层 75 · AI配置与自动代理优先级已还原`)
