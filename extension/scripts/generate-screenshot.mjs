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
 * Generates a 1280x800 Screenshot (24-bit RGB, NO ALPHA)
 * Simulates the Circles CRM dashboard with the companion extension active.
 */
function generateScreenshot(width = 1280, height = 800) {
  const rowBytes = width * 3;
  const rawData = Buffer.alloc((1 + rowBytes) * height);

  function setPixel(x, y, r, g, b) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * (1 + rowBytes) + 1 + x * 3;
    rawData[idx + 0] = r;
    rawData[idx + 1] = g;
    rawData[idx + 2] = b;
  }

  function fillRect(x1, y1, w, h, r, g, b) {
    const x2 = Math.min(width, x1 + w);
    const y2 = Math.min(height, y1 + h);
    for (let y = Math.max(0, y1); y < y2; y++) {
      for (let x = Math.max(0, x1); x < x2; x++) {
        setPixel(x, y, r, g, b);
      }
    }
  }

  function drawRoundedRect(rx, ry, rw, rh, rad, r, g, b, borderR = -1, borderG = 0, borderB = 0) {
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const qx = Math.abs(x + 0.5 - (rx + rw / 2)) - (rw / 2 - rad);
        const qy = Math.abs(y + 0.5 - (ry + rh / 2)) - (rh / 2 - rad);
        const dist = (qx > 0 && qy > 0)
          ? Math.hypot(qx, qy) - rad
          : Math.max(qx, qy) - rad + Math.min(Math.max(qx, qy), 0);

        if (dist <= 0) {
          if (borderR >= 0 && dist > -1.2) {
            setPixel(x, y, borderR, borderG, borderB);
          } else {
            setPixel(x, y, r, g, b);
          }
        }
      }
    }
  }

  // 1. Base dark theme background #09090b
  fillRect(0, 0, width, height, 9, 9, 11);

  // 2. Top Browser bar / Window header (0 to 44px)
  fillRect(0, 0, width, 44, 24, 24, 27);
  // Three window controls dots (mac/browser style)
  drawRoundedRect(18, 16, 12, 12, 6, 239, 68, 68);
  drawRoundedRect(36, 16, 12, 12, 6, 245, 158, 11);
  drawRoundedRect(54, 16, 12, 12, 6, 16, 185, 129);

  // Address bar
  drawRoundedRect(140, 8, 720, 28, 6, 15, 15, 18, 39, 39, 42);
  // URL indicator (small lock & text representation)
  drawRoundedRect(155, 15, 10, 14, 2, 234, 88, 12);
  fillRect(175, 18, 260, 8, 161, 161, 170); // "https://circles.mhntwrkdan.dev"

  // Extension toolbar icon in browser bar
  drawRoundedRect(width - 70, 10, 24, 24, 6, 234, 88, 12);

  // 3. Left CRM Sidebar (x: 0 to 240, y: 44 to 800)
  fillRect(0, 44, 240, height - 44, 18, 18, 21);
  fillRect(239, 44, 1, height - 44, 39, 39, 42); // vertical divider

  // Logo & App Name in Sidebar
  drawRoundedRect(24, 68, 28, 28, 6, 234, 88, 12);
  fillRect(62, 74, 100, 14, 244, 244, 245); // "Circles CRM"

  // Sidebar Menu Items
  const menuItems = [
    { name: "Workspace", active: true },
    { name: "Priority to Engage", active: false },
    { name: "Needs Your Reply", active: false },
    { name: "Mutual Circle", active: false },
    { name: "Conversations", active: false },
    { name: "Outbound Touches", active: false },
    { name: "Contact Lists", active: false },
    { name: "Settings", active: false },
  ];

  let menuY = 126;
  for (const item of menuItems) {
    if (item.active) {
      drawRoundedRect(14, menuY - 4, 212, 34, 6, 39, 39, 42);
      drawRoundedRect(18, menuY + 4, 16, 16, 4, 234, 88, 12);
      fillRect(44, menuY + 7, 90, 10, 244, 244, 245);
    } else {
      drawRoundedRect(18, menuY + 4, 16, 16, 4, 82, 82, 91);
      fillRect(44, menuY + 7, 110, 10, 161, 161, 170);
    }
    menuY += 42;
  }

  // 4. Main CRM Content Area (x: 240 to width, y: 44 to 800)
  // Header bar inside content area
  fillRect(240, 44, width - 240, 64, 14, 14, 17);
  fillRect(240, 108, width - 240, 1, 39, 39, 42);

  // Search input bar
  drawRoundedRect(268, 60, 340, 34, 8, 24, 24, 27, 45, 45, 50);
  fillRect(290, 72, 140, 10, 113, 113, 122); // Search placeholder

  // Sync button in header
  drawRoundedRect(628, 62, 110, 30, 6, 39, 39, 42);
  fillRect(648, 72, 70, 10, 228, 228, 231);

  // Stats Ribbon (4 metric cards)
  const metricCards = [
    { label: "People in CRM", value: "692" },
    { label: "Interactions", value: "1,891" },
    { label: "Needs Reply", value: "14" },
    { label: "Sync Status", value: "Live" },
  ];
  let cardX = 268;
  for (const c of metricCards) {
    drawRoundedRect(cardX, 126, 136, 72, 8, 20, 20, 24, 39, 39, 42);
    fillRect(cardX + 14, 142, 70, 8, 161, 161, 170);
    fillRect(cardX + 14, 162, 40, 18, 244, 244, 245);
    cardX += 152;
  }

  // CRM Contact Cards List
  let contactY = 220;
  for (let i = 0; i < 5; i++) {
    drawRoundedRect(268, contactY, 576, 94, 10, 18, 18, 22, 34, 34, 38);
    // Avatar
    drawRoundedRect(286, contactY + 18, 44, 44, 22, 234, 88, 12);
    // Name & Handle
    fillRect(344, contactY + 24, 140, 12, 244, 244, 245);
    fillRect(344, contactY + 44, 90, 10, 161, 161, 170);
    // Badges / Tags
    drawRoundedRect(500, contactY + 24, 64, 20, 4, 39, 39, 42);
    drawRoundedRect(572, contactY + 24, 52, 20, 4, 234, 88, 12);
    // Action stats & score
    fillRect(740, contactY + 32, 70, 12, 234, 88, 12);
    contactY += 108;
  }

  // 5. Active Floating Extension Companion Card (x: 880 to 1230, y: 64 to 730)
  // Drop shadow
  drawRoundedRect(878, 62, 354, 664, 16, 0, 0, 0);
  // Main popup card
  drawRoundedRect(880, 64, 350, 660, 14, 24, 24, 27, 63, 63, 70);

  // Popup Header
  drawRoundedRect(900, 86, 26, 26, 6, 234, 88, 12);
  fillRect(936, 92, 70, 14, 244, 244, 245); // "Circles"
  drawRoundedRect(1014, 90, 76, 18, 4, 39, 39, 42);
  fillRect(1022, 94, 60, 10, 234, 88, 12); // "Companion"

  // Status Box inside Popup
  drawRoundedRect(900, 134, 310, 80, 8, 15, 15, 18, 39, 39, 42);
  // Substack status row
  drawRoundedRect(916, 148, 8, 8, 4, 16, 185, 129); // green dot
  fillRect(934, 148, 65, 8, 161, 161, 170); // "Substack"
  fillRect(1130, 148, 60, 8, 16, 185, 129); // "Connected"
  // Circles status row
  drawRoundedRect(916, 184, 8, 8, 4, 16, 185, 129); // green dot
  fillRect(934, 184, 75, 8, 161, 161, 170); // "Circles CRM"
  fillRect(1130, 184, 60, 8, 16, 185, 129); // "Connected"

  // "Add to Circles" Card Section
  drawRoundedRect(900, 232, 310, 460, 10, 18, 18, 22, 39, 39, 42);
  fillRect(916, 250, 100, 12, 244, 244, 245); // "Add to Circles"
  fillRect(1160, 252, 34, 10, 113, 113, 122); // "v0.2.5"

  // Profile detected box
  drawRoundedRect(916, 280, 278, 60, 8, 24, 24, 27, 45, 45, 50);
  drawRoundedRect(930, 292, 36, 36, 18, 234, 88, 12); // avatar
  fillRect(980, 298, 110, 10, 244, 244, 245); // Author Name
  fillRect(980, 316, 75, 8, 161, 161, 170);  // @handle

  // Form label & Input: Handle
  fillRect(916, 360, 95, 8, 161, 161, 170); // "Substack Handle"
  drawRoundedRect(916, 376, 278, 36, 6, 15, 15, 18, 45, 45, 50);
  fillRect(930, 388, 14, 12, 234, 88, 12); // @ symbol
  fillRect(950, 390, 80, 10, 244, 244, 245);

  // Form label & List checkboxes
  fillRect(916, 428, 80, 8, 161, 161, 170); // "Add to Lists"
  const lists = ["Mutual Circle", "VIP Supporters", "Writers Network"];
  let listY = 446;
  for (let l = 0; l < lists.length; l++) {
    drawRoundedRect(916, listY, 278, 32, 6, 24, 24, 27, 40, 40, 44);
    drawRoundedRect(928, listY + 8, 16, 16, 4, l === 0 ? 234 : 39, l === 0 ? 88 : 39, l === 0 ? 12 : 42); // checkbox
    fillRect(954, listY + 12, 100, 8, 228, 228, 231);
    listY += 38;
  }

  // Tags input
  fillRect(916, 572, 35, 8, 161, 161, 170); // "Tags"
  drawRoundedRect(916, 588, 278, 34, 6, 15, 15, 18, 45, 45, 50);
  fillRect(930, 600, 120, 8, 113, 113, 122); // "subscriber, restacker"

  // Primary Button: "Add to CRM"
  drawRoundedRect(916, 638, 278, 42, 8, 234, 88, 12);
  fillRect(1015, 652, 80, 14, 255, 255, 255); // "Add to CRM" button text

  // 6. Output 24-bit RGB PNG (no alpha)
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 2; // Color type: RGB (24-bit, NO ALPHA)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(rawData);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    sig,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", iend),
  ]);
}

const screenshotPng = generateScreenshot(1280, 800);
const outPath = path.join(storeAssetsDir, "screenshot-1280x800.png");
writeFileSync(outPath, screenshotPng);
console.log(`Generated ${outPath} (1280x800, 24-bit RGB no-alpha)`);
