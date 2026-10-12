export function commentDateWindow(from?: Date, to?: Date, now = Date.now()) {
  if (!from) return {
    since: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
    until: new Date(now).toISOString(),
  }
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const end = new Date(to ?? from)
  end.setHours(0, 0, 0, 0)
  end.setDate(end.getDate() + 1)
  return { since: start.toISOString(), until: end.toISOString() }
}
