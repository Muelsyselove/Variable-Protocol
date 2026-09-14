// 骰子定义注册表（数据来自外部资源包 resources/game/data/dice.json，由 core/gameData.js 加载填充）
// onRoll 描述符由战斗引擎（core/combat.js）解释执行——声明式范式的原始样板
// 注意：保持导出对象引用不变（原地填充），全部消费方 import 无需改动

export const BASE_DICE = {}
export const SPECIAL_DICE = {}
export const PURE_DICE = {}
export const EXTRA_DICE = {}
export const ALL_DICE = {}

// 生成带随机点数的基础骰实例定义（1~6点等概率，由调用方传入点数）
export function baseDieWithPips(kind, pips) {
  const def = BASE_DICE[kind]
  return { ...def, pips }
}
