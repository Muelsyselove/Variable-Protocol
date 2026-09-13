// 深入分析：边缘颜色分布 + 主体边界探测
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const file = process.argv[2]
const buf = readFileSync(file)
let pos = 8
let width = 0, height = 0, colorType
const idatChunks = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  const data = buf.subarray(pos + 8, pos + 8 + len)
  if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9] }
  else if (type === 'IDAT') idatChunks.push(data)
  else if (type === 'IEND') break
  pos += 12 + len
}
const ch = 3
const raw = inflateSync(Buffer.concat(idatChunks))
const stride = width * ch
const pixels = Buffer.alloc(height * stride)
let rp = 0
for (let y = 0; y < height; y++) {
  const filter = raw[rp++]
  const rowStart = y * stride
  for (let x = 0; x < stride; x++) {
    const cur = raw[rp++]
    const left = x >= ch ? pixels[rowStart + x - ch] : 0
    const up = y > 0 ? pixels[rowStart - stride + x] : 0
    const ul = (y > 0 && x >= ch) ? pixels[rowStart - stride + x - ch] : 0
    let val
    switch (filter) {
      case 0: val = cur; break
      case 1: val = cur + left; break
      case 2: val = cur + up; break
      case 3: val = cur + ((left + up) >> 1); break
      case 4: {
        const p = left + up - ul
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul)
        val = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)
        break
      }
      default: val = cur
    }
    pixels[rowStart + x] = val & 0xff
  }
}
const px = (x, y) => {
  const i = (y * width + x) * ch
  return [pixels[i], pixels[i + 1], pixels[i + 2]]
}
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`

// 顶边/底边/左边的颜色序列（粗采样）
console.log('── 顶边 y=0 ──')
for (let x = 0; x < width; x += 128) console.log(`  x=${x}: ${rgb(px(x, 0))}`)
console.log('── 底边 y=' + (height - 1) + ' ──')
for (let x = 0; x < width; x += 128) console.log(`  x=${x}: ${rgb(px(x, height - 1))}`)
console.log('── 左边 x=0 ──')
for (let y = 0; y < height; y += 192) console.log(`  y=${y}: ${rgb(px(0, y))}`)
console.log('── 中心行 y=' + Math.floor(height / 2) + ' ──')
for (let x = 0; x < width; x += 128) console.log(`  x=${x}: ${rgb(px(x, Math.floor(height / 2)))}`)

// 主体边界探测：从四边向内找第一个"非背景"像素（以角点色为基准，容差60）
const corner = px(2, 2)
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
const TOL = 60
console.log(`角点基准色: ${rgb(corner)} · 容差 ${TOL}`)
function findEdge(from, to, fixed, isVertical) {
  for (let t = from; t < to; t++) {
    const c = isVertical ? px(t, fixed) : px(fixed, t)
    if (dist(c, corner) > TOL) return t
  }
  return -1
}
const midY = Math.floor(height / 2), midX = Math.floor(width / 2)
console.log(`中线左边界: x=${findEdge(0, width, midY, false)} · 右边界: x=${findEdge(width - 1, 0, midY, false)}`)
console.log(`中线上边界: y=${findEdge(0, height, midX, true)} · 下边界: y=${findEdge(height - 1, 0, midX, true)}`)
