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
//   node admin.mjs user-list                   列出全部用户（含 11 位账号）
//   node admin.mjs user-pass <用户名> <新密码> 重置密码（清除全部登录令牌）
//   node admin.mjs user-del <用户名>           删除用户及其云端存档
//   node admin.mjs announce-add <标题> <内容> [--category system|game]
//       发布公告（内容为文本或 .txt/.md 文件路径；置顶显示）。分类：system 系统通知
//       （版本更新/调整细节，默认）、game 游戏公告（新增内容/更新前瞻）。
//   node admin.mjs announce-list               列出全部公告（含分类）
//   node admin.mjs announce-del <id>           删除指定公告
//   node admin.mjs mail-send <收件人：用户名|all> <标题> <发件人> <正文>
//       [--attach coins:100] [--attach food:5] [--attach pet:<petId>] [--expires <天数>]
//       发送邮件（正文为文本或 .txt/.md 文件路径）。附件可重复传入多个；
//       coins/food 后跟数量，pet 后跟桌宠 id（客户端入账时校验）。
//   node admin.mjs mail-list                   列出全部邮件（含领取统计）
//   node admin.mjs mail-del <id>               删除指定邮件
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
const ANNOUNCEMENTS_FILE = join(DATA_DIR, 'announcements.json')
const MAILS_FILE = join(DATA_DIR, 'mails.json')
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
    // 旧数据兜底：无账号号的用户在此补发（与服务端启动迁移同规则）
    let changed = false
    const existing = new Set(Object.values(users.users).map((u) => u.account).filter(Boolean))
    const genAccount = () => {
      for (;;) {
        let n = String(1 + Math.floor(Math.random() * 9))
        for (let i = 0; i < 15; i++) n += Math.floor(Math.random() * 10)
        if (!existing.has(n)) return n
      }
    }
    for (const u of Object.values(users.users)) {
      if (!u.account) { u.account = genAccount(); existing.add(u.account); changed = true }
    }
    if (changed) saveJSON(USERS_FILE, users)
    for (const [name, u] of Object.entries(users.users)) {
      console.log(`  ${name} · 账号 ${u.account || '?'} · 注册于 ${new Date(u.createdAt).toLocaleString('zh-CN')} · ${u.tokens?.length || 0} 个登录令牌`)
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

  case 'announce-add': {
    const title = args[0]
    const contentArg = args[1]
    if (!title || !contentArg) die('用法：announce-add <标题> <内容：文本或 .txt/.md 文件路径> [--category system|game]')
    // 内容为已存在的文件路径则读文件，否则按字面文本
    const contentPath = resolve(contentArg)
    const content = existsSync(contentPath) && /\.(txt|md)$/i.test(contentPath)
      ? readFileSync(contentPath, 'utf-8')
      : contentArg
    const category = flag('--category') === 'game' ? 'game' : 'system'
    const ann = loadJSON(ANNOUNCEMENTS_FILE, { list: [] })
    ann.list = Array.isArray(ann.list) ? ann.list : []
    const id = ann.list.reduce((m, a) => Math.max(m, Number(a.id) || 0), 0) + 1
    ann.list.unshift({ id, category, title, content: content.slice(0, 4000), date: new Date().toISOString() })
    saveJSON(ANNOUNCEMENTS_FILE, ann)
    console.log(`已发布${category === 'game' ? '游戏公告' : '系统通知'} #${id}：${title}`)
    break
  }

  case 'announce-list': {
    const ann = loadJSON(ANNOUNCEMENTS_FILE, { list: [] })
    const list = Array.isArray(ann.list) ? ann.list : []
    if (list.length === 0) { console.log('（暂无公告）'); break }
    for (const a of list) {
      const cat = a.category === 'game' ? '游戏公告' : '系统通知'
      console.log(`  #${a.id} · [${cat}] · ${new Date(a.date).toLocaleString('zh-CN')} · ${a.title}`)
      console.log(`    ${String(a.content || '').slice(0, 60).replace(/\n/g, ' ')}${String(a.content || '').length > 60 ? '…' : ''}`)
    }
    break
  }

  case 'announce-del': {
    const id = Number(args[0])
    if (!id) die('用法：announce-del <id>')
    const ann = loadJSON(ANNOUNCEMENTS_FILE, { list: [] })
    const list = Array.isArray(ann.list) ? ann.list : []
    if (!list.some((a) => Number(a.id) === id)) die(`公告 #${id} 不存在`)
    ann.list = list.filter((a) => Number(a.id) !== id)
    saveJSON(ANNOUNCEMENTS_FILE, ann)
    console.log(`已删除公告 #${id}`)
    break
  }

  // ── 邮件管理 ──
  // 附件参数格式 --attach type:value：coins/food 的 value 为数量，pet 的 value 为桌宠 id
  case 'mail-send': {
    const to = args[0]
    const title = args[1]
    const from = args[2]
    const contentArg = args[3]
    if (!to || !title || !from || !contentArg) {
      die('用法：mail-send <收件人：用户名|all> <标题> <发件人> <正文：文本或 .txt/.md 文件路径> [--attach coins:100 --attach food:5 --attach pet:<id>] [--expires <天数>]')
    }
    if (to !== 'all') {
      const users = loadJSON(USERS_FILE, { users: {} })
      if (!users.users[to]) die(`用户 ${to} 不存在（全部用户见 user-list；全服邮件收件人填 all）`)
    }
    const contentPath = resolve(contentArg)
    const body = (existsSync(contentPath) && /\.(txt|md)$/i.test(contentPath) ? readFileSync(contentPath, 'utf-8') : contentArg).slice(0, 4000)
    const attaches = args.flatMap((a, i) => (a === '--attach' ? [args[i + 1]] : [])).filter(Boolean)
    const attachments = []
    for (const raw of attaches) {
      const idx = String(raw).indexOf(':')
      const type = idx > 0 ? String(raw).slice(0, idx) : ''
      const value = idx > 0 ? String(raw).slice(idx + 1) : ''
      if (!['coins', 'food', 'pet'].includes(type) || !value) die(`附件格式无效：${raw}（应为 coins:数量 / food:数量 / pet:桌宠id）`)
      if (type === 'pet') attachments.push({ type, id: value })
      else {
        const amount = Math.floor(Number(value))
        if (!Number.isFinite(amount) || amount <= 0) die(`附件数量无效：${raw}`)
        attachments.push({ type, amount })
      }
      if (attachments.length > 8) die('附件数量上限为 8 个')
    }
    const expDays = Number(flag('--expires') || 0)
    const expiresAt = expDays > 0 ? Date.now() + expDays * 86400000 : null
    const mails = loadJSON(MAILS_FILE, { list: [] })
    mails.list = Array.isArray(mails.list) ? mails.list : []
    const id = mails.list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1
    mails.list.unshift({ id, to, title, from, body, attachments, date: new Date().toISOString(), expiresAt, claimed: {} })
    saveJSON(MAILS_FILE, mails)
    const att = attachments.length ? `（附件 ${attachments.map(fmtAttach).join('、')}）` : '（无附件）'
    console.log(`已发送邮件 #${id} → ${to === 'all' ? '全体用户' : to}：${title}${att}`)
    break
  }

  case 'mail-list': {
    const mails = loadJSON(MAILS_FILE, { list: [] })
    const list = Array.isArray(mails.list) ? mails.list : []
    if (list.length === 0) { console.log('（暂无邮件）'); break }
    for (const m of list) {
      const exp = m.expiresAt ? ` · ${new Date(m.expiresAt).toLocaleDateString('zh-CN')} 过期` : ''
      const att = (m.attachments || []).length ? `（附件 ${m.attachments.map(fmtAttach).join('、')}）` : ''
      const claimedN = Object.keys(m.claimed || {}).length
      const reach = m.to === 'all' ? `已领取 ${claimedN} 人次` : m.claimed?.[m.to] ? '已领取' : '未领取'
      console.log(`  #${m.id} · → ${m.to === 'all' ? '全体用户' : m.to} · ${new Date(m.date).toLocaleString('zh-CN')}${exp}`)
      console.log(`    「${m.title}」发件人：${m.from} ${att} · ${reach}`)
    }
    break
  }

  case 'mail-del': {
    const id = Number(args[0])
    if (!id) die('用法：mail-del <id>')
    const mails = loadJSON(MAILS_FILE, { list: [] })
    const list = Array.isArray(mails.list) ? mails.list : []
    if (!list.some((m) => Number(m.id) === id)) die(`邮件 #${id} 不存在`)
    mails.list = list.filter((m) => Number(m.id) !== id)
    saveJSON(MAILS_FILE, mails)
    console.log(`已删除邮件 #${id}`)
    break
  }

  default:
    console.log('用法：node admin.mjs <命令> …（publish-resource / publish-core / unpublish-resource / unpublish-core / list / user-list / user-pass / user-del / announce-add / announce-list / announce-del / mail-send / mail-list / mail-del）')
    process.exit(cmd ? 1 : 0)
}

// 附件展示文本（mail-send/mail-list 共用）
function fmtAttach(a) {
  if (!a || !a.type) return '?'
  if (a.type === 'coins') return `算力币×${a.amount}`
  if (a.type === 'food') return `口粮×${a.amount}`
  if (a.type === 'pet') return `桌宠:${a.id}`
  return `${a.type}:${a.amount ?? a.id ?? '?'}`
}
