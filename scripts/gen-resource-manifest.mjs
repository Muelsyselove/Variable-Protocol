// 资源清单生成（开发工具，发版前运行）：扫描 resources/game，计算 sha256，写入 manifest.json
// 用法：node scripts/gen-resource-manifest.mjs [版本号]
// 注意：此脚本属于开发工具，变更不写入版本更新记录（项目惯例）
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../resources/game/', import.meta.url))
const version = process.argv[2] || '2.0.0'

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = {}
for (const p of walk(ROOT)) {
  const rel = relative(ROOT, p).replaceAll('\\', '/')
  if (rel === 'manifest.json') continue
  files[rel] = createHash('sha256').update(readFileSync(p)).digest('hex')
}

const manifest = {
  format: 1,
  version,
  minCore: '2.0.0',
  generatedAt: new Date().toISOString(),
  files
}

writeFileSync(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
console.log(`manifest.json 已生成：版本 ${version}，${Object.keys(files).length} 个文件`)
