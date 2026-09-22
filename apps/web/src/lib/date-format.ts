export function formatListAddedDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    const day = String(d.getDate()).padStart(2, "0")
    const month = String(d.getMonth() + 1).padStart(2, "0")
    const year = d.getFullYear()
    return `${day}.${month}.${year}`
  } catch {
    return null
  }
}

export function formatListTooltip(name: string, iso: string | null | undefined): string {
  const addedDate = formatListAddedDate(iso)
  return addedDate ? `Added to ${name} on ${addedDate}` : `List: ${name}`
}
