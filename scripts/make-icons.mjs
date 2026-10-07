// 앱 아이콘(PNG) 만들기 — 남색 바탕에 빨간 우체국 소인. 외부 프로그램 없이 직접 그린다.
// 사용법: node scripts/make-icons.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { ROOT } from './lib/common.mjs';

const NAVY = [0x1a, 0x22, 0x33];
const RED = [0xe2, 0x3b, 0x3b];
const PAPER = [0xee, 0xf1, 0xf5];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return ~c >>> 0; };

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 모양은 0~1 좌표로 정의하고, 픽셀마다 4x4 로 나눠 찍어 가장자리를 부드럽게
function draw(size, { background, rounded, scale = 1, mono = false }) {
  const buf = Buffer.alloc(size * size * 4);
  const S = 4;
  const ring = (x, y, cx, cy, r, w) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= w / 2;
  const shape = (x, y) => {
    // 가운데 기준으로 크기 조정 (maskable 은 안전 영역 안에 들어오게 작게)
    const u = 0.5 + (x - 0.5) / scale;
    const v = 0.5 + (y - 0.5) / scale;
    const cx = 0.42, cy = 0.5;
    if (ring(u, v, cx, cy, 0.25, 0.045) || ring(u, v, cx, cy, 0.165, 0.02)) return RED;
    if (Math.hypot(u - cx, v - cy) < 0.07) return RED;
    for (const ly of [0.4, 0.5, 0.6]) {
      if (u > 0.69 && u < 0.86 && Math.abs(v - ly - 0.018 * Math.sin((u - 0.69) * 37)) < 0.017) return PAPER;
    }
    return null;
  };
  const inBg = (x, y) => {
    if (!rounded) return true;
    const r = 0.22, dx = Math.max(r - x, 0, x - (1 - r)), dy = Math.max(r - y, 0, y - (1 - r));
    return Math.hypot(dx, dy) <= r;
  };
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let rgb = [0, 0, 0], a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const x = (px + (sx + 0.5) / S) / size, y = (py + (sy + 0.5) / S) / size;
      let c = shape(x, y);
      if (mono) c = c ? [255, 255, 255] : null;
      else if (!c && background && inBg(x, y)) c = NAVY;
      if (c) { rgb = rgb.map((v, i) => v + c[i]); a++; }
    }
    const i = (py * size + px) * 4;
    if (a) { buf[i] = rgb[0] / a; buf[i + 1] = rgb[1] / a; buf[i + 2] = rgb[2] / a; }
    buf[i + 3] = Math.round((a / (S * S)) * 255);
  }
  return png(size, buf);
}

const dir = join(ROOT, 'docs', 'icons');
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'icon-192.png'), draw(192, { background: true, rounded: true }));
await writeFile(join(dir, 'icon-512.png'), draw(512, { background: true, rounded: true }));
await writeFile(join(dir, 'maskable-512.png'), draw(512, { background: true, scale: 0.78 }));
await writeFile(join(dir, 'badge-96.png'), draw(96, { mono: true, scale: 1.15 }));
console.log('아이콘 4개를 docs/icons 에 만들었어요.');
