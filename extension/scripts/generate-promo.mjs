import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storeAssetsDir = path.resolve(__dirname, "../store-assets");
mkdirSync(storeAssetsDir, { recursive: true });

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

/**
 * Generates a 440x280 Small Promo Tile for Chrome Web Store
 */
function generatePromoTile(width = 440, height = 280) {
  const rowBytes = width * 4;
  const rawData = Buffer.alloc((1 + rowBytes) * height);

  const cx = width / 2;
  const cy = height / 2 - 14; // Slightly elevated to give breathing room
  const iconRadius = 56;
  const strokeW = 4.2;
  const rOuter = iconRadius * 0.76;
  const rMiddle = iconRadius * 0.46;
  const rDot = iconRadius * 0.18;
  const cornerR = iconRadius * 0.42;

  for (let y = 0; y < height; y++) {
    rawData[y * (1 + rowBytes)] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const idx = y * (1 + rowBytes) + 1 + x * 4;

      // Dark background with subtle radial gradient centered at (cx, cy)
      const distFromCenter = Math.hypot(x - cx, y - cy);
      const bgNorm = Math.min(1, distFromCenter / (width * 0.7));
      
      // Base background: #0c0a09 (very dark stone) radiating to #000000
      let r = Math.round(18 * (1 - bgNorm) + 8 * bgNorm);
      let g = Math.round(16 * (1 - bgNorm) + 7 * bgNorm);
      let b = Math.round(15 * (1 - bgNorm) + 6 * bgNorm);
      let a = 255;

      // Subtle orange atmospheric glow around the icon center
      const glowDist = distFromCenter / 140;
      if (glowDist < 1) {
        const glowFactor = (1 - glowDist) * 0.28;
        r = Math.min(255, Math.round(r + 234 * glowFactor));
        g = Math.min(255, Math.round(g + 88 * glowFactor * 0.6));
        b = Math.min(255, Math.round(b + 12 * glowFactor * 0.2));
      }

      // Rounded rectangle container for the central icon
      const qx = Math.abs(x + 0.5 - cx) - (iconRadius - cornerR);
      const qy = Math.abs(y + 0.5 - cy) - (iconRadius - cornerR);
      const distBox = (qx > 0 && qy > 0)
        ? Math.hypot(qx, qy) - cornerR
        : Math.max(qx, qy) - cornerR + Math.min(Math.max(qx, qy), 0);

      const boxAlpha = Math.min(1, Math.max(0, 0.5 - distBox));
      if (boxAlpha > 0) {
        // Icon container background: crisp white card with slight border
        const isBorder = distBox > -1.2 && distBox <= 0;
        let cardR = isBorder ? 228 : 255;
        let cardG = isBorder ? 228 : 255;
        let cardB = isBorder ? 231 : 255;

        // Orange gradient inside concentric circles
        const distToIconCenter = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const t = (x - (cx - iconRadius) + y - (cy - iconRadius)) / (4 * iconRadius);
        const fgR = Math.round(251 * (1 - t) + 234 * t);
        const fgG = Math.round(146 * (1 - t) + 88 * t);
        const fgB = Math.round(60 * (1 - t) + 12 * t);

        let circleCov = 0;
        // Center dot
        const dotCov = Math.min(1, Math.max(0, rDot + 0.5 - distToIconCenter));
        if (dotCov > 0) circleCov = Math.max(circleCov, dotCov);

        // Middle ring
        const midDist = Math.abs(distToIconCenter - rMiddle);
        const midCov = Math.min(1, Math.max(0, (strokeW / 2 + 0.5) - midDist));
        if (midCov > 0) circleCov = Math.max(circleCov, midCov * 0.95);

        // Outer ring
        const outDist = Math.abs(distToIconCenter - rOuter);
        const outCov = Math.min(1, Math.max(0, (strokeW / 2 + 0.5) - outDist));
        if (outCov > 0) circleCov = Math.max(circleCov, outCov);

        if (circleCov > 0) {
          cardR = Math.round(cardR * (1 - circleCov) + fgR * circleCov);
          cardG = Math.round(cardG * (1 - circleCov) + fgG * circleCov);
          cardB = Math.round(cardB * (1 - circleCov) + fgB * circleCov);
        }

        // Blend container card onto background
        r = Math.round(r * (1 - boxAlpha) + cardR * boxAlpha);
        g = Math.round(g * (1 - boxAlpha) + cardG * boxAlpha);
        b = Math.round(b * (1 - boxAlpha) + cardB * boxAlpha);
      }

      rawData[idx + 0] = r;
      rawData[idx + 1] = g;
      rawData[idx + 2] = b;
      rawData[idx + 3] = a;
    }
  }

  // PNG Signature & Chunks
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // Bit depth
  ihdr[9] = 6;  // Color type: RGBA
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

const promoPng = generatePromoTile(440, 280);
const outPath = path.join(storeAssetsDir, "promo-tile-440x280.png");
writeFileSync(outPath, promoPng);
console.log(`Generated ${outPath} (440x280)`);
