import { ExternalLink, Puzzle } from "lucide-react"

const REPO_EXTENSION_DOCS = "https://github.com/cucoleadan/circles-app#browser-extension"
const PUBLIC_STORE_URL = "https://chromewebstore.google.com/detail/circles-companion/bkflpfcomkiclmnllggooedkfcbmflnn"

/** Chrome Web Store listing: the public Circles Companion unless EXTENSION_STORE_URL overrides it (see index.astro). */
export function extensionStoreUrl() {
  if (typeof document === "undefined") return PUBLIC_STORE_URL
  return document.querySelector<HTMLMetaElement>('meta[name="circles-extension-store-url"]')?.content || PUBLIC_STORE_URL
}

export function SettingsExtensionTab() {
  const storeUrl = extensionStoreUrl()
  const host = typeof location === "undefined" ? "https://your-circles-host" : location.origin
  const steps = [
    <>
      Install{" "}
      <a href={storeUrl} target="_blank" rel="noreferrer" className="font-medium text-[#f15a3a] hover:underline">
        Circles Companion
      </a>{" "}
      from the Chrome Web Store.
    </>,
    <>
      Click the Circles icon in the browser toolbar, enter <code className="font-mono">{host}</code> as the{" "}
      <strong>Circles server</strong>, choose <strong>Save</strong> and allow access when Chrome asks.
    </>,
    <>Circles opens and connects your Substack session automatically.</>,
  ]

  return (
    <div className="space-y-3">
      <div className="rounded border border-stone-200/80 bg-white p-3.5 shadow-none dark:border-stone-800 dark:bg-stone-900 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded bg-gradient-to-br from-[#f15a3a] to-[#ff7e5f] text-white flex items-center justify-center shadow-xs">
            <Puzzle className="size-4" />
          </div>
          <div>
            <h3 className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-sm">Circles Companion Extension</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Chrome Manifest V3 · Substack session sync &amp; outbound touch capture
            </p>
          </div>
        </div>

        <p className="text-stone-600 dark:text-stone-300 text-xs leading-relaxed">
          The companion connects your Substack session and captures your outbound likes, restacks, and comments into
          Circles while you browse Substack. It works with any Circles server, including self-hosted ones.
        </p>

        <a
          href={storeUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded bg-[#f15a3a] hover:bg-[#d94828] text-white px-3.5 py-1.5 text-xs font-semibold shadow-xs transition-colors"
        >
          <ExternalLink className="size-3.5" />
          Install from Chrome Web Store
        </a>
      </div>

      <div className="rounded border border-stone-200/80 bg-white p-3.5 shadow-none dark:border-stone-800 dark:bg-stone-900 space-y-2.5">
        <h4 className="font-bold text-[10.5px] uppercase tracking-wider text-stone-500">Set up</h4>
        <ol className="space-y-2 text-xs">
          {steps.map((step, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="size-4.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold flex items-center justify-center shrink-0 text-[10px]">
                {index + 1}
              </span>
              <p className="text-muted-foreground text-[11px] break-all">{step}</p>
            </li>
          ))}
        </ol>
        <a
          href={REPO_EXTENSION_DOCS}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#f15a3a] hover:underline"
        >
          Build the extension from source
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  )
}
