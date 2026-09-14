#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════
// 变量协议 · 服务器管理 CLI（在服务器上执行；数据目录与服务端一致，经 DATA_DIR 环境变量共享）
//
// 用法（或 npm run server:admin -- <命令> …）：
//   node admin.mjs publish-resource <资源目录> <版本> [--min-core <最低核心版本>]
//       发布一个资源包版本。<资源目录> 为完整资源包（与仓库 resources/game 同构：
//       data/*.json + images/…），自动计算全部文件 sha256 并登记版本清单。
//       同版本重复发布会整包覆盖。
//   node admin.mjs publish-core <安装包exe路径> <版本> [--name "发布名"] [--notes <说明md文件>]
//       发布一个核心安装包版本（成为「最新」，客户端自动下载并校验 sha256）。
//   node admin.mjs unpublish-resource <版本>   移除一个资源版本（不影响更高版本的增量基准）
//   node admin.mjs unpublish-core <版本>       移除一个核心版本
//   node admin.mjs list                        列出已发布版本
//   node admin.mjs user-list                   列出全部用户
//   node admin.mjs user-pass <用户名> <新密码> 重置密码（清除全部登录令牌）
//   node admin.mjs user-del <用户名>           删除用户及其云端存档
// ══════════════════════════════════════════════════════════════════════
import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync, statSync, renameSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, 'data'))
const USERS_FILE = join(DATA_DIR, 'users.json')
const PLAYERS_FILE = join(DATA_DIR, 'players.json')
const VERSIONS_FILE = join(DATA_DIR, 'versions.json')
const PACKAGES_DIR = join(DATA_DIR, 'packages', 'resources')
const CORES_DIR = join(DATA_DIR, 'cores')
for (const d of [DATA_DIR, PACKAGES_DIR, CORES_DIR]) mkdirSync(d, { recursive: true })

function loadJSON(file, fallback) {
  try {
    let t = readFileSync(file, 'utf-8')
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
    return JSON.parse(t)
  } catch {
    return fallback
  }
}
function saveJSON(file, data) {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, file)
}
function die(msg) { console.error(`错误：${msg}`); process.exit(1) }
function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const [cmd, ...args] = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const versions = loadJSON(VERSIONS_FILE, { resources: {}, cores: {} })

switch (cmd) {
  case 'publish-resource': {
    const src = args[0]
    const version = args[1]
    if (!src || !version) die('用法：publish-resource <资源目录> <版本> [--min-core <版本>]')
    const root = resolve(src)
    if (!existsSync(join(root, 'data'))) die('资源目录需包含 data/ 子目录（与仓库 resources/game 同构）')
    const minCore = flag('--min-core') || '0'
    // 版本清单：全部文件（manifest.json 由客户端自行生成，不入清单）
    const files = {}
    for (const p of walk(root)) {
      const rel = p.slice(root.length + 1).replaceAll('\\', '/')
      if (rel === 'manifest.json') continue
      files[rel] = sha256(p)
    }
    const dest = join(PACKAGES_DIR, version)
    rmSync(dest, { recursive: true, force: true }) // 同版本重发整包覆盖
    mkdirSync(dest, { recursive: true })
    cpSync(root, dest, { recursive: true })
    versions.resources[version] = { minCore, files, createdAt: Date.now() }
    saveJSON(VERSIONS_FILE, versions)
    console.log(`已发布资源版本 v${version}：${Object.keys(files).length} 个文件，minCore=${minCore}`)
    break
  }

  case 'publish-core': {
    const src = args[0]
    const version = args[1]
    if (!src || !version) die('用法：publish-core <安装包exe路径> <版本> [--name "发布名"] [--notes <说明md文件>]')
    const file = resolve(src)
    if (!existsSync(file)) die(`文件不存在：${file}`)
    const name = flag('--name') || `变量协议 v${version}`
    let notes = ''
    const notesFile = flag('--notes')
    if (notesFile && existsSync(notesFile)) notes = readFileSync(notesFile, 'utf-8').slice(0, 6000)
    const hash = sha256(file)
    const dest = join(CORES_DIR, version)
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    cpSync(file, join(dest, basename(file)))
    versions.cores[version] = {
      file: basename(file), sha256: hash, size: statSync(file).size,
      name, notes, publishedAt: new Date().toISOString()
    }
    saveJSON(VERSIONS_FILE, versions)
    console.log(`已发布核心版本 v${version}：${basename(file)}（${(statSync(file).size / 1048576).toFixed(1)} MB）`)
    break
  }

  case 'unpublish-resource': {
    const v = args[0]
    if (!v || !versions.resources[v]) die('版本不存在')
    delete versions.resources[v]
    saveJSON(VERSIONS_FILE, versions)
    rmSync(join(PACKAGES_DIR, v), { recursive: true, force: true })
    console.log(`已移除资源版本 v${v}`)
    break
  }

  case 'unpublish-core': {
    const v = args[0]
    if (!v || !versions.cores[v]) die('版本不存在')
    delete versions.cores[v]
    saveJSON(VERSIONS_FILE, versions)
    rmSync(join(CORES_DIR, v), { recursive: true, force: true })
    console.log(`已移除核心版本 v${v}`)
    break
  }

  case 'list': {
    const res = Object.entries(versions.resources).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    console.log('资源版本：')
    for (const [v, e] of res) console.log(`  v${v} · ${Object.keys(e.files).length} 文件 · minCore=${e.minCore}`)
    console.log('核心版本：')
    for (const [v, e] of Object.entries(versions.cores)) console.log(`  v${v} · ${e.file} · ${(e.size / 1048576).toFixed(1)} MB`)
    break
  }

  case 'user-list': {
    const users = loadJSON(USERS_FILE, { users: {} })
    for (const [name, u] of Object.entries(users.users)) {
      console.log(`  ${name} · 注册于 ${new Date(u.createdAt).toLocaleString('zh-CN')} · ${u.tokens?.length || 0} 个登录令牌`)
    }
    break
  }

  case 'user-pass': {
    const name = args[0]
    const pass = args[1]
    if (!name || !pass) die('用法：user-pass <用户名> <新密码>')
    if (pass.length < 6 || pass.length > 64) die('密码长度需为 6~64 位')
    const users = loadJSON(USERS_FILE, { users: {} })
    if (!users.users[name]) die('用户不存在')
    const salt = randomBytes(16).toString('hex')
    users.users[name] = { ...users.users[name], salt, hash: scryptSync(pass, salt, 32).toString('hex'), tokens: [] }
    saveJSON(USERS_FILE, users)
    console.log(`已重置 ${name} 的密码（全部登录令牌已失效）`)
    break
  }

  case 'user-del': {
    const name = args[0]
    if (!name) die('用法：user-del <用户名>')
    const users = loadJSON(USERS_FILE, { users: {} })
    if (!users.users[name]) die('用户不存在')
    delete users.users[name]
    saveJSON(USERS_FILE, users)
    const players = loadJSON(PLAYERS_FILE, {})
    delete players[name]
    saveJSON(PLAYERS_FILE, players)
    console.log(`已删除用户 ${name} 及其云端存档`)
    break
  }

  default:
    console.log('用法：node admin.mjs <命令> …（publish-resource / publish-core / unpublish-resource / unpublish-core / list / user-list / user-pass / user-del）')
    process.exit(cmd ? 1 : 0)
}
