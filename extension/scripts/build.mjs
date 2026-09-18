import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(projectRoot, "dist");
const watch = process.argv.includes("--watch");
const isProd = process.argv.includes("--prod");

const entry = (name) => path.join(projectRoot, "src", name);
const options = (entryPath, outfile, format) => ({
  absWorkingDir: projectRoot,
  entryPoints: [entryPath],
  outfile: path.join(outdir, outfile),
  bundle: true,
  format,
  target: ["chrome120"],
  sourcemap: !isProd,
  logLevel: "info",
});

async function copyStatic() {
  if (isProd) {
    const raw = await readFile(path.join(projectRoot, "manifest.json"), "utf8");
    const manifest = JSON.parse(raw);
    const filterDev = (pattern) => !pattern.includes("localhost") && !pattern.includes("127.0.0.1");

    if (Array.isArray(manifest.host_permissions)) {
      manifest.host_permissions = manifest.host_permissions.filter(filterDev);
    }
    if (Array.isArray(manifest.content_scripts)) {
      for (const cs of manifest.content_scripts) {
        if (Array.isArray(cs.matches)) {
          cs.matches = cs.matches.filter(filterDev);
        }
      }
    }
    if (manifest.externally_connectable && Array.isArray(manifest.externally_connectable.matches)) {
      manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter(filterDev);
    }
    await writeFile(path.join(outdir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  } else {
    await cp(path.join(projectRoot, "manifest.json"), path.join(outdir, "manifest.json"));
  }
  await cp(path.join(projectRoot, "src/popup/popup.html"), path.join(outdir, "popup/popup.html"));
  await cp(path.join(projectRoot, "src/popup/popup.css"), path.join(outdir, "popup/popup.css"));
  await cp(path.join(projectRoot, "icons"), path.join(outdir, "icons"), { recursive: true });
}

async function fullBuild() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(path.join(outdir, "popup"), { recursive: true });
  await copyStatic();
  await Promise.all([
    build(options(entry("background.ts"), "background.js", "esm")),
    build(options(entry("content.ts"), "content.js", "iife")),
    build(options(entry("substack.ts"), "substack.js", "iife")),
    build(options(entry("page-observer.ts"), "page-observer.js", "iife")),
    build(options(entry("activity-bridge.ts"), "activity-bridge.js", "iife")),
    build(options(entry("popup/popup.ts"), "popup/popup.js", "iife")),
  ]);
}

if (watch) {
  await fullBuild();
  const watchers = [
    context(options(entry("background.ts"), "background.js", "esm")),
    context(options(entry("content.ts"), "content.js", "iife")),
    context(options(entry("substack.ts"), "substack.js", "iife")),
    context(options(entry("page-observer.ts"), "page-observer.js", "iife")),
    context(options(entry("activity-bridge.ts"), "activity-bridge.js", "iife")),
    context(options(entry("popup/popup.ts"), "popup/popup.js", "iife")),
  ];
  await Promise.all(watchers.map((watcher) => watcher.then((w) => w.watch())));
  console.log("Watching for changes…");
} else {
  await fullBuild();
}
