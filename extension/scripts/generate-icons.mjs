import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.resolve(__dirname, "../icons");
mkdirSync(iconsDir, { recursive: true });

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function generateCirclesIcon(size) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2;
  const strokeW = Math.max(1.2, size * 0.055);
  const rOuter = R * 0.72;
  const rMiddle = R * 0.44;
  const rDot = R * 0.16;
  const cornerR = R * 0.4;

  const rowBytes = size * 4;
  const rawData = Buffer.alloc((1 + rowBytes) * size);

  for (let y = 0; y < size; y++) {
    rawData[y * (1 + rowBytes)] = 0; // Filter: None
    for (let x = 0; x < size; x++) {
      const idx = y * (1 + rowBytes) + 1 + x * 4;

      // Rounded rectangle distance
      const qx = Math.abs(x + 0.5 - cx) - (cx - cornerR);
      const qy = Math.abs(y + 0.5 - cy) - (cy - cornerR);
      const distBox = (qx > 0 && qy > 0)
        ? Math.hypot(qx, qy) - cornerR
        : Math.max(qx, qy) - cornerR + Math.min(Math.max(qx, qy), 0);
      
      const boxAlpha = Math.min(1, Math.max(0, 0.5 - distBox));
      if (boxAlpha <= 0) {
        rawData[idx + 0] = 0;
        rawData[idx + 1] = 0;
        rawData[idx + 2] = 0;
        rawData[idx + 3] = 0;
        continue;
      }

      // Border factor for subtle crisp edge around the white icon
      const isBorder = distBox > -1.2 && distBox <= 0;
      let r = isBorder ? 228 : 255;
      let g = isBorder ? 228 : 255;
      let b = isBorder ? 231 : 255;
      let a = boxAlpha;

      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);

      // Gradient factor: warm orange (#fb923c: 251, 146, 60) to deep orange (#ea580c: 234, 88, 12)
      const t = (x + y) / (2 * size);
      const fgR = Math.round(251 * (1 - t) + 234 * t);
      const fgG = Math.round(146 * (1 - t) + 88 * t);
      const fgB = Math.round(60 * (1 - t) + 12 * t);

      // Circles coverage
      let circleCov = 0;

      // Center dot
      const dotCov = Math.min(1, Math.max(0, rDot + 0.5 - dist));
      if (dotCov > 0) circleCov = Math.max(circleCov, dotCov);

      // Middle ring
      const midDist = Math.abs(dist - rMiddle);
      const midCov = Math.min(1, Math.max(0, (strokeW / 2 + 0.5) - midDist));
      if (midCov > 0) circleCov = Math.max(circleCov, midCov * 0.9);

      // Outer ring
      const outDist = Math.abs(dist - rOuter);
      const outCov = Math.min(1, Math.max(0, (strokeW / 2 + 0.5) - outDist));
      if (outCov > 0) circleCov = Math.max(circleCov, outCov * 0.95);

      if (circleCov > 0) {
        r = Math.round(r * (1 - circleCov) + fgR * circleCov);
        g = Math.round(g * (1 - circleCov) + fgG * circleCov);
        b = Math.round(b * (1 - circleCov) + fgB * circleCov);
      }

      rawData[idx + 0] = r;
      rawData[idx + 1] = g;
      rawData[idx + 2] = b;
      rawData[idx + 3] = Math.round(a * 255);
    }
  }

  // PNG Signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: RGBA
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace: None

  const idat = deflateSync(rawData);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    sig,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", iend),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  const png = generateCirclesIcon(size);
  const outPath = path.join(iconsDir, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${size}x${size})`);
}

// Also write favicon.png for apps/web
const favicon32 = generateCirclesIcon(32);
const faviconPath = path.resolve(__dirname, "../../apps/web/public/favicon.png");
writeFileSync(faviconPath, favicon32);
console.log(`Generated ${faviconPath}`);
