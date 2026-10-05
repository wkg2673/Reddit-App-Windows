/**
 * Generates the application icon without any image tooling.
 *
 * Renders the mark with 4x4 supersampled signed-distance math, encodes a PNG
 * (for the repo / docs) and a multi-resolution .ico (for Windows), which is
 * what electron-builder needs for the exe, the installer and the shortcuts.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'build');

const ICON_SIZES = [16, 24, 32, 48, 64, 96, 128, 256];

const ORANGE_TOP = [255, 92, 32];
const ORANGE_BOTTOM = [214, 48, 0];
const WHITE = [255, 255, 255];

/* ------------------------------------------------------------------ drawing */

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const inRing = (x, y, cx, cy, inner, outer) => {
  const d = (x - cx) ** 2 + (y - cy) ** 2;
  return d >= inner * inner && d <= outer * outer;
};

/** Renders one RGBA pixel of the mark, coordinates normalised to 0..1. */
function sample(x, y) {
  if (!inCircle(x, y, 0.5, 0.5, 0.5)) return [0, 0, 0, 0];

  const base = mix(ORANGE_TOP, ORANGE_BOTTOM, Math.min(1, Math.max(0, y * 0.85 + 0.1)));
  let colour = base;

  // Body: a crescent tucked under the head, sharing its edge so the two merge.
  if (inRing(x, y, 0.5, 0.44, 0.243, 0.395) && y > 0.6) colour = WHITE;

  // Head.
  if (inCircle(x, y, 0.5, 0.44, 0.245)) colour = WHITE;

  // Eyes.
  if (inCircle(x, y, 0.415, 0.4, 0.052) || inCircle(x, y, 0.585, 0.4, 0.052)) colour = base;

  // Smile: lower half of a ring centred on the mouth.
  if (inRing(x, y, 0.5, 0.44, 0.075, 0.105) && y > 0.45) colour = base;

  // Antenna.
  if (inRing(x, y, 0.5, 0.15, 0.0, 0.03) && y > 0.1) colour = WHITE;
  if (inCircle(x, y, 0.5, 0.09, 0.05)) colour = WHITE;

  return [colour[0], colour[1], colour[2], 255];
}

/** Renders the mark to an RGBA buffer with 4x4 supersampling. */
function renderRGBA(size) {
  const data = Buffer.alloc(size * size * 4);
  const step = 1 / (size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const x = (px * 4 + sx + 0.5) * step;
          const y = (py * 4 + sy + 0.5) * step;
          const [pr, pg, pb, pa] = sample(x, y);
          const weight = pa / 255;
          r += pr * weight;
          g += pg * weight;
          b += pb * weight;
          a += pa;
        }
      }
      const offset = (py * size + px) * 4;
      const samples = 16;
      const alpha = a / samples;
      const norm = alpha === 0 ? 0 : samples * (alpha / 255);
      data[offset] = Math.round(r / norm);
      data[offset + 1] = Math.round(g / norm);
      data[offset + 2] = Math.round(b / norm);
      data[offset + 3] = Math.round(alpha);
    }
  }
  return data;
}

/* -------------------------------------------------------------- png encoder */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- ico encoder */

/** 32-bit BGRA DIB entry, bottom-up, with an (unused) 1bpp AND mask. */
function encodeDIB(rgba, size) {
  const header = Buffer.alloc(40);
  const xorSize = size * size * 4;
  const andStride = Math.ceil(size / 32) * 4;
  const andSize = andStride * size;
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND stacked
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(xorSize + andSize, 20);

  const pixels = Buffer.alloc(xorSize);
  for (let y = 0; y < size; y += 1) {
    const src = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x += 1) {
      const from = src + x * 4;
      const to = (y * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(andSize)]);
}

function encodeICO(entries) {
  const directory = Buffer.alloc(6 + entries.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(entries.length, 4);

  let offset = directory.length;
  const blobs = [];
  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0;
    directory[at + 3] = 0;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
    blobs.push(entry.data);
  });

  return Buffer.concat([directory, ...blobs]);
}

/* -------------------------------------------------------------------- main */

mkdirSync(outDir, { recursive: true });

const cache = new Map();
const render = (size) => {
  if (!cache.has(size)) cache.set(size, renderRGBA(size));
  return cache.get(size);
};

const png512 = encodePNG(render(512), 512);
writeFileSync(resolve(outDir, 'icon.png'), png512);

const icoEntries = ICON_SIZES.map((size) => ({
  size,
  data: size >= 256 ? encodePNG(render(size), size) : encodeDIB(render(size), size),
}));
writeFileSync(resolve(outDir, 'icon.ico'), encodeICO(icoEntries));

console.log(
  `icon written: build/icon.ico (${ICON_SIZES.join(', ')} px) and build/icon.png (512 px, ${png512.length} bytes)`,
);
