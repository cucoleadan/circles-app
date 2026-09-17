export function readableDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function relativeTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;

  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1_000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

export function formatNaturalRelativeTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;

  const diffMs = Date.now() - time;
  const seconds = Math.max(0, Math.floor(diffMs / 1_000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 30) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  if (minutes < 60) return "less than 1 hour ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "1 week ago";
  if (weeks < 4) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

export function noteImageThumbnail(url: string, width = 320) {
  return `https://substackcdn.com/image/fetch/w_${width},c_limit,f_auto,q_auto:good,fl_progressive:steep/${encodeURIComponent(url)}`;
}
