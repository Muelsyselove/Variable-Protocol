// 贴图接口：三类「文件名=id」目录的图片映射（数据来自资源包 images/ 目录，主进程扫描）
// 映射值形如 game://images/<分类>/<文件名>，由 core/gameData.js 加载时填充（fillImageMap）
// 目录结构（1024×1024 原图，界面按需缩放）：
//   images/characters/<干员id>.png      角色立绘
//   images/weapons/<武器id>.png         武器贴图
//   images/translators/<转译器id>.png   转译器贴图
// 桌宠图片路径由 pets.json 显式声明，不在此映射
// 调用：characterImg('baseline') / weaponImg('heavy') / translatorImg('assertModule')

let CHARACTER_IMGS = {}
let WEAPON_IMGS = {}
let TRANSLATOR_IMGS = {}

export function fillImageMap(map) {
  const m = map || {}
  CHARACTER_IMGS = m.characters || {}
  WEAPON_IMGS = m.weapons || {}
  TRANSLATOR_IMGS = m.translators || {}
}

export function characterImg(id) {
  return CHARACTER_IMGS[id] || null
}

export function weaponImg(id) {
  return WEAPON_IMGS[id] || null
}

export function translatorImg(id) {
  return TRANSLATOR_IMGS[id] || null
}
