/** Find local midnight by calendar date, so DST days can be 23 or 25 hours. */
export function localDayRange(date: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Use YYYY-MM-DD")
  const nominal = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(nominal.getTime()) || nominal.toISOString().slice(0, 10) !== date)
    throw new Error("Invalid calendar date")
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  const dateAt = (ms: number) => {
    const parts = formatter.formatToParts(ms)
    return ["year", "month", "day"].map((kind) => parts.find((part) => part.type === kind)!.value).join("-")
  }
  const boundary = (target: string, center: number) => {
    let lo = center - 36 * 3600000
    let hi = center + 36 * 3600000
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (dateAt(mid) < target) lo = mid + 1
      else hi = mid
    }
    if (dateAt(lo) !== target) throw new Error("This calendar date does not exist in that timezone")
    return new Date(lo).toISOString()
  }
  const next = new Date(nominal.getTime() + 86400000)
  return { from: boundary(date, nominal.getTime()), to: boundary(next.toISOString().slice(0, 10), next.getTime()) }
}
