import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");

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

// 1. Check version alignment across all 4 files per AGENTS.md
console.log("--> Verifying version alignment...");
const manifest = JSON.parse(readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const pkgLock = JSON.parse(readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));
const versionJson = JSON.parse(readFileSync(path.join(projectRoot, "version.json"), "utf8"));

const vManifest = manifest.version;
const vPkg = pkg.version;
const vLock = pkgLock.version;
const vJson = versionJson.version;

if (vManifest !== vPkg || vManifest !== vLock || vManifest !== vJson) {
  console.error("Version mismatch found:");
  console.error(`  manifest.json:     ${vManifest}`);
  console.error(`  package.json:      ${vPkg}`);
  console.error(`  package-lock.json: ${vLock}`);
  console.error(`  version.json:      ${vJson}`);
  process.exit(1);
}
console.log(`✓ All version files match version ${vManifest}`);

// 2. Ensure promo tile asset exists
const promoTilePath = path.join(projectRoot, "store-assets/promo-tile-440x280.png");
if (!existsSync(promoTilePath)) {
  console.log("--> Generating promo tile asset...");
  execSync(`node "${path.join(__dirname, "generate-promo.mjs")}"`, { stdio: "inherit" });
}

// 3. Run production build
console.log("--> Building extension with --prod...");
execSync(`node "${path.join(__dirname, "build.mjs")}" --prod`, { cwd: projectRoot, stdio: "inherit" });

// 4. Validate dist/manifest.json
console.log("--> Validating production dist/manifest.json...");
const distManifest = JSON.parse(readFileSync(path.join(distDir, "manifest.json"), "utf8"));
const hasDevOrigin = (arr) => Array.isArray(arr) && arr.some((item) => item.includes("localhost") || item.includes("127.0.0.1"));

if (hasDevOrigin(distManifest.host_permissions)) {
  throw new Error("dist/manifest.json still contains localhost in host_permissions!");
}
for (const cs of distManifest.content_scripts ?? []) {
  if (hasDevOrigin(cs.matches)) {
    throw new Error("dist/manifest.json still contains localhost in content_scripts.matches!");
  }
}
if (hasDevOrigin(distManifest.externally_connectable?.matches)) {
  throw new Error("dist/manifest.json still contains localhost in externally_connectable.matches!");
}
console.log("✓ Production manifest verified (clean of localhost/127.0.0.1).");

// 5. Gather all files in dist
function getAllFiles(dir, baseDir = dir) {
  let files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getAllFiles(fullPath, baseDir));
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      files.push({ fullPath, relPath });
    }
  }
  return files;
}

const entries = getAllFiles(distDir);
console.log(`--> Packaging ${entries.length} files into zip...`);

// 6. Create ZIP buffer using raw deflate
function createZip(fileEntries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  // Fixed DOS date/time: 2026-09-18 12:00:00
  const dosTime = (12 << 11) | (0 << 5) | (0 >> 1);
  const dosDate = ((2026 - 1980) << 9) | (9 << 5) | 18;

  for (const { fullPath, relPath } of fileEntries) {
    const rawData = readFileSync(fullPath);
    const uncompressedSize = rawData.length;
    const fileCrc = crc32(rawData);

    let compressedData = deflateRawSync(rawData);
    let compressionMethod = 8; // DEFLATE
    if (compressedData.length >= uncompressedSize) {
      compressedData = rawData;
      compressionMethod = 0; // STORE
    }
    const compressedSize = compressedData.length;
    const nameBuffer = Buffer.from(relPath, "utf8");

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed
    localHeader.writeUInt16LE(0, 6);          // Flags
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(fileCrc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    nameBuffer.copy(localHeader, 30);

    localHeaders.push(localHeader, compressedData);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central header signature
    centralHeader.writeUInt16LE(20, 4);         // Version made by
    centralHeader.writeUInt16LE(20, 6);         // Version needed
    centralHeader.writeUInt16LE(0, 8);          // Flags
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(fileCrc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);         // Extra field length
    centralHeader.writeUInt16LE(0, 32);         // Comment length
    centralHeader.writeUInt16LE(0, 34);         // Disk number
    centralHeader.writeUInt16LE(0, 36);         // Internal attr
    centralHeader.writeUInt32LE(0, 38);         // External attr
    centralHeader.writeUInt32LE(offset, 42);    // Local header relative offset
    nameBuffer.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    offset += localHeader.length + compressedData.length;
  }

  const centralDirOffset = offset;
  const centralDirBuffer = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuffer.length;

  // End of Central Directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);           // EOCD signature
  eocd.writeUInt16LE(0, 4);                    // Disk number
  eocd.writeUInt16LE(0, 6);                    // Disk with central dir
  eocd.writeUInt16LE(fileEntries.length, 8);   // Entries on this disk
  eocd.writeUInt16LE(fileEntries.length, 10);  // Total entries
  eocd.writeUInt32LE(centralDirSize, 12);      // Size of central dir
  eocd.writeUInt32LE(centralDirOffset, 16);    // Central dir offset
  eocd.writeUInt16LE(0, 20);                   // Comment length

  return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
}

const zipBuffer = createZip(entries);
const outZipName = `circles-companion-${vManifest}.zip`;
const outZipPath = path.join(projectRoot, outZipName);
writeFileSync(outZipPath, zipBuffer);

console.log(`\n========================================`);
console.log(`SUCCESS! Package created:`);
console.log(`  File: ${outZipPath}`);
console.log(`  Size: ${(zipBuffer.length / 1024).toFixed(1)} KB`);
console.log(`  Version: ${vManifest}`);
console.log(`========================================\n`);
