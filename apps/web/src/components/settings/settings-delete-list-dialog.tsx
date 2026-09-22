import { AlertTriangle } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import type { ListRecord } from "../../lib/types"

export function SettingsDeleteListDialog({
  list,
  isDeleting,
  onConfirm,
  onCancel,
}: {
  list: ListRecord | null
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={Boolean(list)} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white dark:bg-stone-900 p-5 shadow-2xl border border-stone-200 dark:border-stone-800 space-y-4"
        showCloseButton={false}
      >
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 shrink-0">
            <AlertTriangle className="size-5" />
          </span>
          <div className="space-y-1">
            <DialogTitle className="text-sm font-bold text-stone-900 dark:text-stone-100">
              Delete "{list?.name}"?
            </DialogTitle>
            <DialogDescription className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
              This list currently contains{" "}
              <strong>{list?.count} {list?.count === 1 ? "contact" : "contacts"}</strong>.
            </DialogDescription>
          </div>
        </div>

        <div className="rounded-xl bg-stone-50 dark:bg-stone-950/80 p-3 border border-stone-200/80 dark:border-stone-800 text-[11.5px] text-stone-600 dark:text-stone-300 leading-relaxed">
          <p className="font-semibold text-stone-800 dark:text-stone-200 mb-0.5">
            Safe Deletion:
          </p>
          Contacts in this list will <strong>not</strong> be deleted, and their engagement stats and notes remain intact. Only this list category and memberships will be removed.
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDeleting}
            onClick={onCancel}
            className="text-xs rounded-lg"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isDeleting}
            onClick={onConfirm}
            className="text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-xs"
          >
            {isDeleting ? "Deleting…" : "Delete List"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
