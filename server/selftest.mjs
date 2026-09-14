#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════
// 服务器部署自检（开发工具）：在临时数据目录里发布测试版本并启动服务，
// 端到端验证 注册/登录/鉴权/云存档/资源增量diff/核心包下发(含Range) 全链路。
// 用法：node server/selftest.mjs   （或 npm run server:selftest）
// 全部通过输出 PASS 并以 0 退出；任一失败输出原因并以 1 退出。
// ══════════════════════════════════════════════════════════════════════
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PORT = 18000 + Math.floor(Math.random() * 2000)
const BASE = `http://127.0.0.1:${PORT}`

let passed = 0, failed = 0
function assert(cond, name, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${detail ? '：' + detail : ''}`) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 准备临时数据目录与测试资源包 ──
const dataDir = mkdtempSync(join(tmpdir(), 'vp-server-test-'))
const pkg1 = join(dataDir, 'pkg-1.0.0')
const pkg2 = join(dataDir, 'pkg-1.0.1')
mkdirSync(join(pkg1, 'data'), { recursive: true })
mkdirSync(join(pkg1, 'images'), { recursive: true })
writeFileSync(join(pkg1, 'data', 'dice.json'), JSON.stringify({ v: 1 }))
writeFileSync(join(pkg1, 'images', 'a.png'), Buffer.from('fake-png-a'))
cpSync(pkg1, pkg2, { recursive: true })
writeFileSync(join(pkg2, 'data', 'dice.json'), JSON.stringify({ v: 2 })) // 变更文件
writeFileSync(join(pkg2, 'images', 'b.png'), Buffer.from('fake-png-b')) // 新增文件
const coreExe = join(dataDir, 'Setup-test.exe')
const coreBytes = randomBytes(65536)
writeFileSync(coreExe, coreBytes)

// ── 用 admin CLI 发布版本 ──
const adminEnv = { ...process.env, DATA_DIR: dataDir }
function admin(...args) {
  const r = spawnSync(process.execPath, [join(__dirname, 'admin.mjs'), ...args], { env: adminEnv, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`admin ${args.join(' ')} 失败：${r.stderr}`)
  return r.stdout.trim()
}

console.log('— 发布测试版本（admin CLI） —')
try {
  admin('publish-resource', pkg1, '1.0.0', '--min-core', '0')
  admin('publish-resource', pkg2, '1.0.1', '--min-core', '0')
  admin('publish-core', coreExe, '2.0.0', '--name', '自检版本')
  assert(true, 'admin 发布资源 1.0.0 / 1.0.1 与核心 2.0.0')
} catch (err) {
  assert(false, 'admin 发布', err.message)
  process.exit(1)
}

// ── 启动服务 ──
const server = spawn(process.execPath, [join(__dirname, 'server.mjs')], {
  env: { ...adminEnv, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
})
server.stdout.on('data', () => {})
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return true
    } catch { /* 未就绪 */ }
    await sleep(200)
  }
  return false
}

const ready = await waitReady()
assert(ready, '服务启动并通过健康检查')
if (!ready) { server.kill(); process.exit(1) }

const j = async (path, opts) => {
  const r = await fetch(BASE + path, opts)
  return { status: r.status, data: await r.json().catch(() => null) }
}

// ── 账号与云存档 ──
console.log('— 账号与云存档 —')
{
  // 纯英文字母用户名（注册规则 v2.1.0：2~24 位字母）：时间戳数字映射为字母保证唯一
  const toLetters = (n) => String(n).replace(/\d/g, (d) => 'abcdefghij'[d])
  const name = 'selftest' + toLetters(Date.now())
  const post = (path, body) => j(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const bad = await post('/api/auth/register', { username: name, password: '123' })
  assert(bad.status === 400, '注册拒绝过短密码')
  const badName = await post('/api/auth/register', { username: '用户名' + Date.now(), password: 'pass123456' })
  assert(badName.status === 400, '注册拒绝非纯英文用户名')

  const reg = await post('/api/auth/register', { username: name, password: 'pass123456' })
  assert(reg.status === 200 && reg.data.token, '注册成功并返回令牌')
  assert(/^\d{11}$/.test(reg.data.account || ''), '注册自动分配 11 位纯数字账号')
  const dup = await post('/api/auth/register', { username: name, password: 'pass123456' })
  assert(dup.status === 409, '重复注册被拒绝')

  const wrong = await post('/api/auth/login', { username: reg.data.account, password: 'wrong-pass' })
  assert(wrong.status === 401, '错误密码登录被拒绝')
  const noAcc = await post('/api/auth/login', { username: '9' + '0'.repeat(10), password: 'pass123456' })
  assert(noAcc.status === 401, '不存在的账号登录被拒绝')

  const login = await post('/api/auth/login', { username: reg.data.account, password: 'pass123456' })
  assert(login.status === 200 && login.data.token && login.data.account === reg.data.account, '账号登录成功')
  const legacy = await post('/api/auth/login', { username: name, password: 'pass123456' })
  assert(legacy.status === 200 && legacy.data.account === reg.data.account, '旧版用户名登录仍可用（返回同一账号）')

  const auth = { Authorization: `Bearer ${login.data.token}`, 'Content-Type': 'application/json' }
  const me = await j('/api/auth/me', { headers: auth })
  assert(me.status === 200 && me.data.account === reg.data.account, '会话信息接口返回账号')
  const meNo = await j('/api/auth/me', {})
  assert(meNo.status === 401, '无令牌访问会话信息被拒绝')
  const noauth = await j('/api/player/data', {})
  assert(noauth.status === 401, '无令牌访问云存档被拒绝')

  // 修改密码：原密码错误被拒；成功后旧令牌失效、新令牌可用
  const wrongOld = await j('/api/auth/password', { method: 'PUT', headers: auth, body: JSON.stringify({ oldPassword: 'bad-old', newPassword: 'newpass123' }) })
  assert(wrongOld.status === 400, '修改密码拒绝错误原密码')
  const chg = await j('/api/auth/password', { method: 'PUT', headers: auth, body: JSON.stringify({ oldPassword: 'pass123456', newPassword: 'newpass123' }) })
  assert(chg.status === 200 && chg.data.token, '修改密码成功并返回新令牌')
  const oldTok = await j('/api/player/data', { headers: auth })
  assert(oldTok.status === 401, '修改密码后旧令牌失效')
  const newAuth = { Authorization: `Bearer ${chg.data.token}`, 'Content-Type': 'application/json' }
  const relogin = await post('/api/auth/login', { username: reg.data.account, password: 'newpass123' })
  assert(relogin.status === 200, '新密码可登录')

  // 预哈希密码兼容性：客户端只发送 SHA-256 十六进制（64 字符），服务端须照常接受并校验
  const hname = 'sth' + toLetters(Date.now())
  const fakeHash = createHash('sha256').update('player-real-password').digest('hex')
  const regH = await post('/api/auth/register', { username: hname, password: fakeHash })
  assert(regH.status === 200 && regH.data.token, '注册接受预哈希密码（64位十六进制）')
  const loginH = await post('/api/auth/login', { username: regH.data.account, password: fakeHash })
  assert(loginH.status === 200 && loginH.data.token, '预哈希密码登录成功（同一哈希可登录）')
  const wrongH = await post('/api/auth/login', { username: regH.data.account, password: createHash('sha256').update('other-password').digest('hex') })
  assert(wrongH.status === 401, '错误哈希登录被拒绝（非明文比对仍有效）')

  const put = await j('/api/player/data', { method: 'PUT', headers: newAuth, body: JSON.stringify({ profile: { coins: 42, pet: { owned: { muelsyse: true } } }, clientVersion: '2.0.0' }) })
  assert(put.status === 200, '上传云存档')
  const get = await j('/api/player/data', { headers: newAuth })
  assert(get.status === 200 && get.data.profile?.coins === 42 && get.data.profile?.pet?.owned?.muelsyse === true, '读取云存档数据一致')

  // 注销账号：密码确认、数据清除、令牌失效
  const delWrong = await j('/api/auth/account', { method: 'DELETE', headers: newAuth, body: JSON.stringify({ password: 'wrong-pass' }) })
  assert(delWrong.status === 400, '注销账号拒绝错误密码')
  const del = await j('/api/auth/account', { method: 'DELETE', headers: newAuth, body: JSON.stringify({ password: 'newpass123' }) })
  assert(del.status === 200, '注销账号成功')
  const goneTok = await j('/api/player/data', { headers: newAuth })
  assert(goneTok.status === 401, '注销后令牌失效')
  const goneLogin = await post('/api/auth/login', { username: reg.data.account, password: 'newpass123' })
  assert(goneLogin.status === 401, '注销后账号无法登录')
}

// ── 公告 ──
console.log('— 公告 —')
{
  const empty = await j('/api/announcements')
  assert(empty.status === 200 && empty.data.ok && Array.isArray(empty.data.announcements), '公告接口可用')
  admin('announce-add', '系统通知公告', '这是一条系统通知内容')
  admin('announce-add', '游戏公告内容', '这是游戏公告内容', '--category', 'game')
  const after = await j('/api/announcements')
  const sys = after.data.announcements.find((a) => a.title === '系统通知公告')
  const game = after.data.announcements.find((a) => a.title === '游戏公告内容')
  assert(after.status === 200 && sys && sys.content && sys.category === 'system', '默认发布为系统通知分类')
  assert(game && game.content && game.category === 'game', '--category game 发布为游戏公告分类')
  admin('announce-del', String(sys.id))
  admin('announce-del', String(game.id))
  const removed = await j('/api/announcements')
  assert(!removed.data.announcements.some((a) => a.id === sys.id || a.id === game.id), '删除公告后不再返回')
}

// ── 邮件 ──
console.log('— 邮件 —')
{
  const toLetters = (n) => String(n).replace(/\d/g, (d) => 'abcdefghij'[d])
  const name = 'mailer' + toLetters(Date.now())
  const post = (path, body, headers = {}) => j(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const reg = await post('/api/auth/register', { username: name, password: 'pass123456' })
  assert(reg.status === 200, '注册邮件测试用户')
  const auth = { Authorization: `Bearer ${reg.data.token}`, 'Content-Type': 'application/json' }

  // 未登录访问被拒
  const noauth = await j('/api/mail', {})
  assert(noauth.status === 401, '无令牌访问邮件被拒绝')

  // 定向邮件（带附件）
  admin('mail-send', name, '定向补偿', '运营团队', '这是发给指定玩家的补偿邮件', '--attach', 'coins:500', '--attach', 'food:3')
  const mine = await j('/api/mail', { headers: auth })
  const direct = mine.data.mails.find((m) => m.title === '定向补偿')
  assert(mine.status === 200 && direct, '定向邮件对收件人可见')
  assert(direct.attachments.length === 2 && direct.attachments[0].type === 'coins' && direct.attachments[0].amount === 500, '附件清单正确（coins:500 + food:3）')
  assert(direct.claimed === false, '初始未领取')

  // 全服邮件
  admin('mail-send', 'all', '全服福利', '运营团队', '这是全体玩家的福利邮件')
  const allMail = (await j('/api/mail', { headers: auth })).data.mails.find((m) => m.title === '全服福利')
  assert(allMail, '全服邮件对用户可见')

  // 领取：成功 → 重复领取被拒
  const claim = await post('/api/mail/claim', { id: direct.id }, auth)
  assert(claim.status === 200 && claim.data.ok && claim.data.attachments.length === 2, '领取附件成功并回传清单')
  const reclaim = await post('/api/mail/claim', { id: direct.id }, auth)
  assert(reclaim.status === 409, '重复领取被拒绝（409）')
  const after = await j('/api/mail', { headers: auth })
  assert(after.data.mails.find((m) => m.id === direct.id).claimed === true, '领取后状态为已领取')

  // 不存在的邮件
  const ghost = await post('/api/mail/claim', { id: 999999 }, auth)
  assert(ghost.status === 404, '领取不存在的邮件被拒绝')

  // 删除
  admin('mail-del', String(direct.id))
  admin('mail-del', String(allMail.id))
  const cleaned = await j('/api/mail', { headers: auth })
  assert(!cleaned.data.mails.some((m) => m.id === direct.id || m.id === allMail.id), '删除邮件后不再返回')

  // 清理测试用户
  await j('/api/auth/account', { method: 'DELETE', headers: auth, body: JSON.stringify({ password: 'pass123456' }) })
}

// ── 资源增量 diff ──
console.log('— 资源增量同步 —')
{
  const from100 = (await j('/api/resources/latest?core=2.0.0&resource=1.0.0')).data
  assert(from100.version === '1.0.1', '1.0.0 → 返回最新 1.0.1')
  const changed = Object.keys(from100.changed || {})
  assert(changed.length === 2 && changed.includes('data/dice.json') && changed.includes('images/b.png'),
    '增量 diff 仅含变更+新增文件', JSON.stringify(changed))
  assert(Array.isArray(from100.removes) && from100.removes.length === 0, '无删除文件')
  assert(Object.keys(from100.manifest).length === 3, '全量清单完整（3 文件）')

  const same = (await j('/api/resources/latest?core=2.0.0&resource=1.0.1')).data
  assert(!same.version, '已是最新版本 → 无更新')

  const unknown = (await j('/api/resources/latest?core=2.0.0&resource=0.9.0')).data
  assert(unknown.version === '1.0.1' && Object.keys(unknown.changed).length === 3, '未知版本 → 全量下发')

  const file = await fetch(`${BASE}${from100.changed['data/dice.json'].url}`)
  const body = await file.text()
  assert(file.status === 200 && body === JSON.stringify({ v: 2 }), '资源文件下发内容正确')

  const sha = createHash('sha256').update(body).digest('hex')
  assert(sha === from100.changed['data/dice.json'].sha256, '资源文件 sha256 与清单一致')
}

// ── 核心包下发 ──
console.log('— 核心包下发 —')
{
  const core = (await j('/api/core/latest?core=2.0.0')).data
  assert(core.version === '2.0.0' && core.fileName === 'Setup-test.exe', '核心版本查询')
  assert(core.sha256 === createHash('sha256').update(coreBytes).digest('hex'), '核心 sha256 与文件一致')

  const dl = await fetch(`${BASE}${core.downloadUrl}`)
  const buf = Buffer.from(await dl.arrayBuffer())
  assert(dl.status === 200 && buf.equals(coreBytes), '核心安装包完整下载')

  const partial = await fetch(`${BASE}${core.downloadUrl}`, { headers: { Range: 'bytes=0-99' } })
  const pbuf = Buffer.from(await partial.arrayBuffer())
  assert(partial.status === 206 && pbuf.length === 100 && pbuf.equals(coreBytes.subarray(0, 100)), 'Range 断点续传（206 + 正确片段）')
}

// ── 清理 ──
server.kill()
try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* 临时目录残留不影响结论 */ }

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
