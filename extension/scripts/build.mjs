import { build, context } from "esbuild";
import { build as viteBuild } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { cp, mkdir, rm } from "node:fs/promises";
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

const scripts = [
  ["background.ts", "background.js", "esm"],
  ["content.ts", "content.js", "iife"],
  ["substack.ts", "substack.js", "iife"],
  ["page-observer.ts", "page-observer.js", "iife"],
  ["activity-bridge.ts", "activity-bridge.js", "iife"],
];

// The side panel is a React page built from the web app's own components and
// globals.css, so Vite + the Tailwind plugin build it like the web app.
const buildPanel = () => viteBuild({
  configFile: false,
  root: path.join(projectRoot, "src/sidepanel"),
  base: "./",
  plugins: [tailwindcss()],
  logLevel: "warn",
  build: {
    outDir: path.join(outdir, "sidepanel"),
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: !isProd,
    // Extension pages allow no inline scripts; skip Vite's preload helper.
    modulePreload: false,
    watch: watch ? {} : null,
  },
});

// The Circles server is paired by each user at runtime, so the manifest ships as-is.
async function copyStatic() {
  await cp(path.join(projectRoot, "manifest.json"), path.join(outdir, "manifest.json"));
  await cp(path.join(projectRoot, "icons"), path.join(outdir, "icons"), { recursive: true });
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await copyStatic();
await Promise.all([
  ...scripts.map(([source, outfile, format]) => build(options(entry(source), outfile, format))),
  buildPanel(),
]);

if (watch) {
  const watchers = await Promise.all(
    scripts.map(([source, outfile, format]) => context(options(entry(source), outfile, format))),
  );
  await Promise.all(watchers.map((watcher) => watcher.watch()));
  console.log("Watching for changes…");
}
