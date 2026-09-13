// 游戏图标生成脚本：纯 Node 实现，程序化绘制 + PNG/ICO 编码（零依赖）
// 运行：node scripts/gen-icon.mjs
// 产出：resources/icon.png（256×256）、resources/icon.ico（16~256 多尺寸）
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const S = 1024 // 超采样画布尺寸，最终下采样

// ── RGBA 画布 ──
const px = new Float32Array(S * S * 4)

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return
  const i = (y * S + x) * 4
  const da = px[i + 3] / 255 // 目标透明度归一化到 0..1
  const oa = a + da * (1 - a)
  if (oa <= 0) return
  px[i] = (r * a + px[i] * da * (1 - a)) / oa
  px[i + 1] = (g * a + px[i + 1] * da * (1 - a)) / oa
  px[i + 2] = (b * a + px[i + 2] * da * (1 - a)) / oa
  px[i + 3] = oa * 255
}

const hex = (h) => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function fillCircle(cx, cy, rad, color, alpha = 1) {
  const [r, g, b] = hex(color)
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d <= rad) blend(x, y, r, g, b, alpha)
    }
}

function fillPoly(pts, color, alpha = 1) {
  const [r, g, b] = hex(color)
  const ys = pts.map((p) => p[1])
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(S - 1, Math.ceil(Math.max(...ys)))
  const xs = pts.map((p) => p[0])
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(S - 1, Math.ceil(Math.max(...xs)))
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      // 射线法：点在多边形内（以像素中心判定）
      const cxp = x + 0.5, cyp = y + 0.5
      let inside = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j]
        if ((yi > cyp) !== (yj > cyp) && cxp < ((xj - xi) * (cyp - yi)) / (yj - yi) + xi) inside = !inside
      }
      if (inside) blend(x, y, r, g, b, alpha)
    }
}

function fillRoundRect(x0, y0, w, h, rad, color, alpha = 1) {
  const [r, g, b] = hex(color)
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(S, y0 + h); y++)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(S, x0 + w); x++) {
      const cxp = Math.max(x0 + rad, Math.min(x + 0.5, x0 + w - rad))
      const cyp = Math.max(y0 + rad, Math.min(y + 0.5, y0 + h - rad))
      if (Math.hypot(x + 0.5 - cxp, y + 0.5 - cyp) <= rad) blend(x, y, r, g, b, alpha)
    }
}

// ── 绘制：终端底板 + 等距骰方 ──
const BG = '#0a1017', GRID = '#56c8e8'
const G1 = '#3ee08f', G2 = '#2a9d68', G3 = '#1d7a52'

// 1) 圆角底板（带轻微渐变：顶部略暗）
for (let y = 0; y < S; y++) {
  const t = y / S
  const base = [10 + 6 * t, 16 + 8 * t, 23 + 10 * t]
  for (let x = 24; x < S - 24; x++) {
    const i = (y * S + x) * 4
    if (inRoundRect(x + 0.5, y + 0.5, 24, 24, S - 48, S - 48, 120)) {
      px[i] = base[0]; px[i + 1] = base[1]; px[i + 2] = base[2]; px[i + 3] = 255
    }
  }
}
function inRoundRect(x, y, rx, ry, w, h, rad) {
  const cx = Math.max(rx + rad, Math.min(x, rx + w - rad))
  const cy = Math.max(ry + rad, Math.min(y, ry + h - rad))
  return Math.hypot(x - cx, y - cy) <= rad
}

// 2) 背景网格（低透明度青色细线）
for (let p = 96; p < S - 24; p += 96) {
  for (let y = 24; y < S - 24; y++) { if (inRoundRect(p, y + 0.5, 24, 24, S - 48, S - 48, 120)) blend(p, y, ...hex(GRID), 0.05) }
  for (let x = 24; x < S - 24; x++) { if (inRoundRect(x + 0.5, p, 24, 24, S - 48, S - 48, 120)) blend(x, p, ...hex(GRID), 0.05) }
}

// 3) 中心辉光（径向渐变绿）
const gcx = S / 2, gcy = S / 2 + 20, grad = 330
for (let y = 0; y < S; y++)
  for (let x = 24; x < S - 24; x++) {
    const d = Math.hypot(x + 0.5 - gcx, y + 0.5 - gcy)
    if (d < grad) {
      const a = 0.16 * (1 - d / grad) ** 2
      const i = (y * S + x) * 4
      if (px[i + 3] > 0) { px[i] = px[i] + (62 - px[i]) * a; px[i + 1] = px[i + 1] + (224 - px[i + 1]) * a; px[i + 2] = px[i + 2] + (143 - px[i + 2]) * a }
    }
  }

// 4) 等距骰方（三面体：顶/左/右）
const C = [S / 2, S / 2 + 14], s = 235, dy = s * 0.58
const T = [C[0], C[1] - dy], R = [C[0] + s, C[1]], B = [C[0], C[1] + dy], L = [C[0] - s, C[1]]
const D1 = [C[0], C[1] + s], D2 = [C[0] + s, C[1] + s], D3 = [C[0] - s, C[1] + s]
// 面描边底（外扩阴影，增强立体感）
const shade = (pts, ex) => pts.map(([x, y]) => [x + ex, y + ex * 0.6])
fillPoly(shade([T, R, D1, L], 14), '#000000', 0.5)
fillPoly(shade([L, B, D1, D3], 14), '#000000', 0.5)
fillPoly(shade([B, R, D2, D1], 14), '#000000', 0.5)
// 三面
fillPoly([T, R, B, L], G1)          // 顶面：亮绿
fillPoly([L, B, D1, D3], G2)        // 左面：中绿
fillPoly([B, R, D2, D1], G3)        // 右面：暗绿

// 面内点数（屏幕空间绘制；顶面点绘制于菱形中心）
function pipTop() { fillCircle(C[0], C[1], 36, '#07271a', 0.95) }
function pipLeft(u, v, rad) {
  const x = L[0] + u * (B[0] - L[0])
  const y = L[1] + u * (B[1] - L[1]) + v * s
  fillCircle(x, y, rad, '#052015', 0.95)
}
function pipRight(u, v, rad) {
  const x = B[0] + u * (R[0] - B[0])
  const y = B[1] + u * (R[1] - B[1]) + v * s
  fillCircle(x, y, rad, '#041710', 0.95)
}
const PR = 30
pipTop()                                        // 顶面：1点（中心）
pipLeft(0.28, 0.35, PR); pipLeft(0.5, 0.55, PR); pipLeft(0.72, 0.75, PR)   // 左面：3点
pipRight(0.28, 0.3, PR); pipRight(0.72, 0.72, PR)                          // 右面：2点

// 5) 终端角括号（外框四角，青绿高亮）
const bk = 120, bw = 18, m = 88, bcol = '#2b4054'
const corner = (x, y, dx, dy) => {
  for (let i = 0; i < bw; i++) {
    for (let d = 0; d < bk; d++) {
      blend(x + dx * d, y + dy * i, ...hex(G1), 0.85)
      blend(x + dx * i, y + dy * d, ...hex(G1), 0.85)
    }
  }
}
corner(m, m, 1, 1); corner(S - m, m, -1, 1); corner(m, S - m, 1, -1); corner(S - m, S - m, -1, -1)

// 6) 底部小字装饰条（模拟终端状态条）
fillRoundRect(S / 2 - 150, S - 205, 300, 14, 7, G1, 0.9)
fillRoundRect(S / 2 - 150, S - 205, 190, 14, 7, '#bff5d9', 0.95)

// ── 下采样（盒滤波）──
function downscale(target) {
  const k = S / target
  const out = Buffer.alloc(target * target * 4)
  for (let y = 0; y < target; y++)
    for (let x = 0; x < target; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < k; sy++)
        for (let sx = 0; sx < k; sx++) {
          const i = ((y * k + sy) | 0) * S * 4 + ((x * k + sx) | 0) * 4
          const al = px[i + 3] / 255
          r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al; a += al
        }
      const n = k * k, o = (y * target + x) * 4
      const aa = a / n
      out[o] = aa > 0 ? Math.round(r / a) : 0
      out[o + 1] = aa > 0 ? Math.round(g / a) : 0
      out[o + 2] = aa > 0 ? Math.round(b / a) : 0
      out[o + 3] = Math.round(aa * 255)
    }
  return out
}

// ── PNG 编码（8位 RGBA，filter 0）──
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ── ICO 编码（≤64 用 BMP 帧，128/256 用 PNG 帧）──
function bmpFrame(rgba, w, h) {
  // BITMAPINFOHEADER（高度×2，含 AND 掩码）+ 底向上下 BGRA 行 + 全零 1bpp 掩码
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0); header.writeInt32LE(w, 4); header.writeInt32LE(h * 2, 8)
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14)
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = ((h - 1 - y) * w + x) * 4, di = (y * w + x) * 4
      data[di] = rgba[si + 2]; data[di + 1] = rgba[si + 1]; data[di + 2] = rgba[si]; data[di + 3] = rgba[si + 3]
    }
  const mask = Buffer.alloc(Math.ceil(w / 8) * h)
  return Buffer.concat([header, data, mask])
}
function encodeIco(entries) {
  // entries: [{size, buf(png|bmp), isPng}]
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + 16 * entries.length
  entries.forEach((e, i) => {
    const o = i * 16
    dir[o] = e.size >= 256 ? 0 : e.size
    dir[o + 1] = e.size >= 256 ? 0 : e.size
    dir[o + 2] = 0; dir[o + 3] = 0
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(e.buf.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += e.buf.length
  })
  return Buffer.concat([head, dir, ...entries.map((e) => e.buf)])
}

mkdirSync(join(ROOT, 'resources'), { recursive: true })
const png256 = encodePng(downscale(256), 256, 256)
writeFileSync(join(ROOT, 'resources', 'icon.png'), png256)

const sizes = [16, 24, 32, 48, 64, 128, 256]
const entries = sizes.map((sz) => {
  const rgba = downscale(sz)
  return sz >= 128
    ? { size: sz, buf: encodePng(rgba, sz, sz) }
    : { size: sz, buf: bmpFrame(rgba, sz, sz) }
})
writeFileSync(join(ROOT, 'resources', 'icon.ico'), encodeIco(entries))
console.log('图标已生成：resources/icon.png (256×256) + resources/icon.ico (' + sizes.join('/') + ')')
