// 验证抠图结果：透明度分布 + 边角采样 + 主体保留检查
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const buf = readFileSync(process.argv[2])
let pos = 8
let W = 0, H = 0
const idat = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  if (type === 'IHDR') { W = buf.readUInt32BE(pos + 8); H = buf.readUInt32BE(pos + 12) }
  else if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len))
  else if (type === 'IEND') break
  pos += 12 + len
}
const raw = inflateSync(Buffer.concat(idat))
const stride = W * 4 + 1
const px = Buffer.alloc(H * W * 4)
let rp = 1
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W * 4; x++) px[y * W * 4 + x] = raw[y * stride + 1 + x]
}
const a = (x, y) => px[(y * W + x) * 4 + 3]

// 透明度统计
let transparent = 0, opaque = 0, semi = 0
for (let i = 3; i < px.length; i += 4) {
  if (px[i] < 10) transparent++
  else if (px[i] > 240) opaque++
  else semi++
}
const total = W * H
console.log(`尺寸: ${W}x${H}`)
console.log(`透明 ${(transparent / total * 100).toFixed(1)}% · 不透明 ${(opaque / total * 100).toFixed(1)}% · 半透明 ${(semi / total * 100).toFixed(1)}%`)

// 四角与四边中点采样（应全透明）
const pts = [[5, 5], [W - 6, 5], [5, H - 6], [W - 6, H - 6], [W >> 1, 5], [5, H >> 1], [W - 6, H >> 1], [W >> 1, H - 6]]
console.log('边角alpha: ' + pts.map(([x, y]) => a(x, y)).join(', '))

// 主体保留：中心区域不透明占比
let centerOpaque = 0, centerTotal = 0
for (let y = Math.floor(H * 0.3); y < H * 0.7; y += 4) {
  for (let x = Math.floor(W * 0.35); x < W * 0.65; x += 4) {
    centerTotal++
    if (a(x, y) > 200) centerOpaque++
  }
}
console.log(`中心区不透明占比: ${(centerOpaque / centerTotal * 100).toFixed(1)}%（主体应>60%）`)

// 残留检查：扫描边缘带（外围15%）的不透明块数量
let edgeRemain = 0
for (let y = 0; y < H; y += 6) {
  for (let x = 0; x < W; x += 6) {
    const inEdge = x < W * 0.15 || x > W * 0.85 || y < H * 0.15 || y > H * 0.85
    if (inEdge && a(x, y) > 200) edgeRemain++
  }
}
console.log(`边缘带不透明采样点: ${edgeRemain}（接近0为佳；少量为发型/装饰外溢）`)
