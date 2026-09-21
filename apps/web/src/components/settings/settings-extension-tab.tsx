import { Check, CheckCircle2, Download, ExternalLink, Puzzle } from "lucide-react"

export const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/circles-companion/bkflpfcomkiclmnllggooedkfcbmflnn?authuser=1&hl=en"

export function SettingsExtensionTab() {
  return (
    <div className="space-y-5">
      {/* Extension Hero & Install Card */}
      <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-2xs dark:border-stone-800 dark:bg-stone-900 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-[#f15a3a] to-[#ff7e5f] text-white flex items-center justify-center shadow-xs">
              <Puzzle className="size-5" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 dark:text-stone-100 text-sm flex items-center gap-2">
                Circles Companion Extension
                <span className="rounded-full bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300 px-2 py-0.5 text-[10px] font-semibold">
                  v0.2.5
                </span>
                <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/80 px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1">
                  <Check className="size-2.5" /> Web Store
                </span>
              </h3>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">
                Chrome Manifest V3 · Seamless Substack sync &amp; outbound touch capture
              </p>
            </div>
          </div>
        </div>

        <p className="text-stone-600 dark:text-stone-300 text-xs leading-relaxed">
          Circles Companion is officially published on the Chrome Web Store. Install it directly with 1 click to automatically sync your session and capture outbound likes, restacks, and comments into Circles.
        </p>

        <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f15a3a] hover:bg-[#d94828] text-white px-5 py-2.5 text-xs font-semibold shadow-xs transition-colors"
          >
            <ExternalLink className="size-4" />
            Install from Chrome Web Store
          </a>
          <a
            href="/downloads/circles-companion-0.2.5.zip"
            download="circles-companion-0.2.5.zip"
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-stone-200 bg-stone-50/80 hover:bg-stone-100 text-stone-700 dark:border-stone-800 dark:bg-stone-800/80 dark:text-stone-300 dark:hover:bg-stone-800 px-3.5 py-2 text-xs font-medium transition-colors"
          >
            <Download className="size-3.5" />
            Download ZIP (Developer Mode)
          </a>
        </div>
      </div>

      {/* 1-Click Install Guide */}
      <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-2xs dark:border-stone-800 dark:bg-stone-900 space-y-3.5">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-stone-900 dark:text-stone-100 text-xs uppercase tracking-wider text-stone-500">
            Quick 1-Click Installation
          </h4>
          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="size-3" /> Recommended
          </span>
        </div>

        <ol className="space-y-3 pt-1 text-xs">
          <li className="flex items-start gap-2.5">
            <span className="size-5 rounded-full bg-[#f15a3a]/10 text-[#f15a3a] font-bold flex items-center justify-center shrink-0 text-[11px]">
              1
            </span>
            <div className="space-y-0.5">
              <p className="font-semibold text-stone-800 dark:text-stone-200">
                Open the Chrome Web Store listing
              </p>
              <p className="text-muted-foreground text-[11.5px]">
                Click the{" "}
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[#f15a3a] hover:underline inline-flex items-center gap-0.5"
                >
                  Install from Chrome Web Store
                  <ExternalLink className="size-2.5" />
                </a>{" "}
                button above to go to the official listing page.
              </p>
            </div>
          </li>

          <li className="flex items-start gap-2.5">
            <span className="size-5 rounded-full bg-[#f15a3a]/10 text-[#f15a3a] font-bold flex items-center justify-center shrink-0 text-[11px]">
              2
            </span>
            <div className="space-y-0.5">
              <p className="font-semibold text-stone-800 dark:text-stone-200">
                Click "Add to Chrome"
              </p>
              <p className="text-muted-foreground text-[11.5px]">
                On the Google store page, click <strong>Add to Chrome</strong> (or your browser's install button) and confirm the extension permissions.
              </p>
            </div>
          </li>

          <li className="flex items-start gap-2.5">
            <span className="size-5 rounded-full bg-[#f15a3a]/10 text-[#f15a3a] font-bold flex items-center justify-center shrink-0 text-[11px]">
              3
            </span>
            <div className="space-y-0.5">
              <p className="font-semibold text-stone-800 dark:text-stone-200">
                Browse Substack &amp; Enjoy Automatic Capture
              </p>
              <p className="text-muted-foreground text-[11.5px]">
                Open Substack in your browser. Circles Companion automatically detects your session and captures your outbound likes, restacks, and replies directly into Circles!
              </p>
            </div>
          </li>
        </ol>
      </div>

      {/* Developer Mode Alternative (Collapsible) */}
      <details className="group rounded-2xl border border-stone-200/80 bg-white p-5 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
        <summary className="font-bold text-stone-900 dark:text-stone-100 text-xs uppercase tracking-wider text-stone-500 cursor-pointer flex items-center justify-between list-none select-none">
          <span>Alternative: Manual Developer Mode Install</span>
          <span className="text-[11px] text-stone-400 font-normal group-open:rotate-180 transition-transform">▼</span>
        </summary>

        <div className="pt-4 space-y-3.5">
          <p className="text-stone-600 dark:text-stone-300 text-xs leading-relaxed">
            If you prefer installing manually from the downloaded ZIP archive instead of the Chrome Web Store:
          </p>

          <ol className="space-y-3 pt-1 text-xs">
            <li className="flex items-start gap-2.5">
              <span className="size-5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold flex items-center justify-center shrink-0 text-[11px]">
                1
              </span>
              <div className="space-y-0.5">
                <p className="font-semibold text-stone-800 dark:text-stone-200">
                  Download &amp; Unzip
                </p>
                <p className="text-muted-foreground text-[11.5px]">
                  Click the "Download ZIP" button and extract the ZIP archive to a folder on your computer.
                </p>
              </div>
            </li>

            <li className="flex items-start gap-2.5">
              <span className="size-5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold flex items-center justify-center shrink-0 text-[11px]">
                2
              </span>
              <div className="space-y-0.5">
                <p className="font-semibold text-stone-800 dark:text-stone-200">
                  Open Chrome Extension Manager
                </p>
                <p className="text-muted-foreground text-[11.5px]">
                  In Chrome, Brave, or Edge, navigate to{" "}
                  <code className="bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded font-mono text-[11px]">
                    chrome://extensions
                  </code>
                  .
                </p>
              </div>
            </li>

            <li className="flex items-start gap-2.5">
              <span className="size-5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold flex items-center justify-center shrink-0 text-[11px]">
                3
              </span>
              <div className="space-y-0.5">
                <p className="font-semibold text-stone-800 dark:text-stone-200">
                  Enable Developer Mode
                </p>
                <p className="text-muted-foreground text-[11.5px]">
                  In the top right corner of the Extensions page, switch the <strong>Developer mode</strong> toggle to ON.
                </p>
              </div>
            </li>

            <li className="flex items-start gap-2.5">
              <span className="size-5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold flex items-center justify-center shrink-0 text-[11px]">
                4
              </span>
              <div className="space-y-0.5">
                <p className="font-semibold text-stone-800 dark:text-stone-200">
                  Click "Load unpacked"
                </p>
                <p className="text-muted-foreground text-[11.5px]">
                  Click the <strong>Load unpacked</strong> button in the top-left toolbar, and select the unzipped extension folder (containing <code className="font-mono">manifest.json</code>).
                </p>
              </div>
            </li>
          </ol>
        </div>
      </details>

      {/* Web Store Active Info Card */}
      <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20 text-stone-600 dark:text-stone-400 text-xs">
        <p className="flex items-center gap-1.5 font-semibold text-emerald-900 dark:text-emerald-300">
          <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" /> Official Chrome Web Store Listing
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-emerald-800/90 dark:text-emerald-300/80">
          Installing directly from the Chrome Web Store provides 1-click installation and automatic background updates.
        </p>
        <div className="mt-2.5">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#f15a3a] hover:underline"
          >
            Open listing on Chrome Web Store
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  )
}
