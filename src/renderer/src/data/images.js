// 贴图接口：按 文件名（=内容id）自动收集各分类文件夹下的图片
// 文件夹结构（1024×1024 原图，界面按需缩放）：
//   assets/characters/<干员id>.png      角色立绘
//   assets/weapons/<武器id>.png         武器贴图
//   assets/translators/<转译器id>.png   转译器贴图
// 文件名即 id（不含扩展名，支持png/jpg/jpeg/webp）；放入文件后无需改代码，自动生效
// 调用：characterImg('baseline') / weaponImg('heavy') / translatorImg('assertModule')

// 注意：import.meta.glob 需要字面量模式串，故逐类收集
const CHARACTER_MODS = import.meta.glob('../assets/characters/*.{png,jpg,jpeg,webp}', { eager: true, import: 'default' })
const WEAPON_MODS = import.meta.glob('../assets/weapons/*.{png,jpg,jpeg,webp}', { eager: true, import: 'default' })
const TRANSLATOR_MODS = import.meta.glob('../assets/translators/*.{png,jpg,jpeg,webp}', { eager: true, import: 'default' })

function toMap(mods) {
  const map = {}
  for (const [path, url] of Object.entries(mods)) {
    const base = path.split('/').pop().replace(/\.(png|jpe?g|webp)$/i, '')
    map[base] = url
  }
  return map
}

const CHARACTER_IMGS = toMap(CHARACTER_MODS)
const WEAPON_IMGS = toMap(WEAPON_MODS)
const TRANSLATOR_IMGS = toMap(TRANSLATOR_MODS)

export function characterImg(id) {
  return CHARACTER_IMGS[id] || null
}

export function weaponImg(id) {
  return WEAPON_IMGS[id] || null
}

export function translatorImg(id) {
  return TRANSLATOR_IMGS[id] || null
}
