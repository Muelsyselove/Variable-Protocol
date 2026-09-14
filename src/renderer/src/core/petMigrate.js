// 桌宠存档 id 迁移（纯函数，供 state.js 读档清洗与 Node 测试共用）
// 安全不变量：仅当旧 id 已从当前桌宠定义表「退役」（不存在于 knownIds）时才执行迁移，
// 防止复用旧 id 的新内容（如 v1.6.0 后复用 muelsyse 的新缪尔赛思）在每次启动时被误迁移删除。
// 迁移完成后记录到 pet.migrations 数组，同一条目只执行一次；定义表未加载（空）时不迁移。

export function migratePetIds(pet, knownIds, table) {
  const ids = knownIds instanceof Set ? knownIds : new Set(knownIds || [])
  const migrations = Array.isArray(pet.migrations) ? pet.migrations : []
  // 定义表为空（资源缺失/未加载）时无法判断退役状态，跳过迁移避免误删
  if (ids.size === 0) return pet
  for (const [oldId, newId] of Object.entries(table || {})) {
    const mark = `${oldId}->${newId}`
    // 旧 id 仍是活定义（id 被新内容复用）或已迁移过：跳过
    if (ids.has(oldId) || migrations.includes(mark)) continue
    if (pet.owned?.[oldId]) {
      pet.owned[newId] = true
      delete pet.owned[oldId]
    }
    if (pet.satiety?.[oldId] != null && pet.satiety[newId] == null) {
      pet.satiety[newId] = pet.satiety[oldId]
      delete pet.satiety[oldId]
    }
    if (pet.affection?.[oldId] != null && pet.affection[newId] == null) {
      pet.affection[newId] = pet.affection[oldId]
      delete pet.affection[oldId]
    }
    if (pet.active === oldId) pet.active = newId
    migrations.push(mark)
  }
  pet.migrations = migrations
  return pet
}
