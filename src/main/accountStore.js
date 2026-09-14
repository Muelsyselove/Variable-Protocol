// 账号存储：登录态独立于玩家档案（<数据目录>/account.json）
// 独立存放的原因：token 是本机凭据，混入 profile.json 会随云存档上传/回传，
// 造成凭据在设备间串用；账号数据只属于当前设备。
import { app } from 'electron'
import { join, dirname } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'

function accountFile() {
  return join(app.getPath('userData'), 'account.json')
}

// 读取登录态：{ username, account, token, savedAt }，无/损坏返回 null
export function readAccount() {
  try {
    let text = readFileSync(accountFile(), 'utf-8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // 剥离 BOM
    const data = JSON.parse(text)
    if (typeof data?.username === 'string' && typeof data?.token === 'string') return data
    return null
  } catch {
    return null
  }
}

// 写入登录态（覆盖式）
export function writeAccount(data) {
  const file = accountFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ ...data, savedAt: Date.now() }, null, 2), 'utf-8')
  return true
}

// 登出：清除本机凭据
export function clearAccount() {
  try { rmSync(accountFile()) } catch { /* 忽略不存在 */ }
  return true
}
