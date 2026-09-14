// 转译器定义注册表（数据来自外部资源包 resources/game/data/translators.json）
// 效果以 {"fx":"名","params":{...}} 声明，由核心 fxRegistry（core/fxRegistry.js）编译解释；
// 资源不携带算法，数值/文案在此，行为在核心。
// 由 core/gameData.js 加载填充；保持导出对象/数组引用不变（原地填充），消费方 import 无需改动。

export const TRANSLATORS = {}
export const NORMAL_POOL = []
export const BOSS_POOLS = { verifier: [], recursion: [], nullref: [] }
