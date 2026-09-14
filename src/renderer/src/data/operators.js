// 干员定义注册表（数据来自外部资源包 resources/game/data/operators.json）
// setupFx/abilityFx 声明由核心 fxRegistry 编译（ability 为旧版遗留字段，统一并入 setup 生效）
// 由 core/gameData.js 加载填充；保持导出数组引用不变（原地填充）。

export const OPERATORS = []
