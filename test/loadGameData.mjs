// Node 测试环境的资源数据加载器：从仓库 resources/game/data/ 直读 JSON 并填充注册表
// 供 test/smoke.mjs 与 test/resourceLint.mjs 共用（渲染层走 game:// 协议，此处走 fs）
import { readFileSync } from 'node:fs'
import { applyGameData } from '../src/renderer/src/core/gameData.js'

const DATA_DIR = new URL('../resources/game/data/', import.meta.url)

function readJson(name) {
  let text = readFileSync(new URL(`${name}.json`, DATA_DIR), 'utf-8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // 剥离 BOM
  return JSON.parse(text)
}

export function loadGameDataFromRepo() {
  const names = ['dice', 'translators', 'enemies', 'operators', 'weapons', 'events', 'pets']
  const data = {}
  for (const n of names) data[n] = readJson(n)
  applyGameData(data, null)
  return data
}
