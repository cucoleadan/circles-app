import { createRoot } from "react-dom/client"
import "@workspace/ui/globals.css"
import "./panel.css"
import { App } from "./app"
import { btnPrimary, card } from "./ui"

// The app's dark tokens hang off a .dark class; the panel follows the system.
const dark = window.matchMedia("(prefers-color-scheme: dark)")
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches)
applyTheme()
dark.addEventListener("change", applyTheme)

/**
 * First install opens this page as a tab, because Chrome only opens a side
 * panel from a click. Show it at panel width and offer the real side panel.
 */
function InTab({ tab }: { tab: chrome.tabs.Tab }) {
  const openPanel = async () => {
    await chrome.sidePanel.open({ windowId: tab.windowId })
    if (tab.id !== undefined) await chrome.tabs.remove(tab.id)
  }
  return (
    <div className="flex h-full flex-col items-center gap-3 bg-stone-100 p-6 dark:bg-stone-900">
      <div className={`${card} flex w-full max-w-[400px] items-center gap-3 p-3 text-xs`}>
        <p className="flex-1 text-stone-600 dark:text-stone-300">
          Circles opens in Chrome's side panel, next to the page you're reading. Later, click the Circles icon in the toolbar.
        </p>
        <button type="button" className={btnPrimary} onClick={() => void openPanel()}>Open side panel</button>
      </div>
      <div className="min-h-0 w-full max-w-[400px] flex-1 overflow-hidden rounded-xl border border-stone-200/80 shadow-xl dark:border-stone-800">
        <App />
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById("root")!)
// getCurrent() returns the tab only when this page is open as one, not in the side panel.
void chrome.tabs.getCurrent().then((tab) => root.render(tab ? <InTab tab={tab} /> : <App />))
