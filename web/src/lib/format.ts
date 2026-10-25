import { format, formatDistanceStrict } from "date-fns";
import { DONE_STATES } from "./constants";
import type { ComplaintStatus } from "./types";

const HOUR = 3_600_000;

export function complaintRef(id: number) {
  return `CF-${String(id).padStart(5, "0")}`;
}

/** Accepts "CF-01042", "cf1042" or "1042". */
export function parseComplaintRef(input: string): number | null {
  const digits = input.trim().replace(/^cf-?/i, "");
  if (!/^\d{1,9}$/.test(digits)) return null;
  const id = Number(digits);
  return id > 0 ? id : null;
}

export function formatDate(iso: string) {
  return format(new Date(iso), "d MMM yyyy");
}

export function formatDateTime(iso: string) {
  return format(new Date(iso), "d MMM yyyy, h:mm a");
}

export function formatShortDateTime(iso: string) {
  return format(new Date(iso), "d MMM, h:mm a");
}

export function timeAgo(iso: string, now = Date.now()) {
  return `${formatDistanceStrict(new Date(iso), now)} ago`;
}

export function formatHours(hours: number | null) {
  if (hours === null || Number.isNaN(hours)) return "n/a";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function formatPct(value: number | null) {
  return value === null ? "n/a" : `${Math.round(value)}%`;
}

export function formatDuration(ms: number) {
  const abs = Math.abs(ms);
  const h = abs / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(abs / 60_000))}m`;
  if (h < 48) return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;
  return `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h`;
}

export type SlaLevel = "ok" | "warning" | "breached" | "met" | "missed" | "closed";

export interface SlaState {
  level: SlaLevel;
  /** 0..1 share of the SLA window used (capped at 1.25 for drawing overshoot). */
  used: number;
  label: string;
  remainingMs: number;
}

/**
 * The SLA clock: drives the SLA bar, queue sorting and colours.
 * Warning when under 25% of the window remains.
 */
export function slaState(
  c: { createdAt: string; slaDeadline: string; resolvedAt: string | null; status: ComplaintStatus },
  now = Date.now(),
): SlaState {
  const start = new Date(c.createdAt).getTime();
  const end = new Date(c.slaDeadline).getTime();
  const window = Math.max(end - start, 1);

  if (DONE_STATES.includes(c.status)) {
    if (c.status === "DUPLICATE") {
      return { level: "closed", used: 0, label: "Merged into another report", remainingMs: 0 };
    }
    const doneAt = c.resolvedAt ? new Date(c.resolvedAt).getTime() : now;
    const used = (doneAt - start) / window;
    const met = doneAt <= end;
    return {
      level: met ? "met" : "missed",
      used: Math.min(used, 1.25),
      label: met ? `Resolved within SLA` : `Resolved ${formatDuration(doneAt - end)} late`,
      remainingMs: end - doneAt,
    };
  }

  const remainingMs = end - now;
  const used = (now - start) / window;
  if (remainingMs < 0) {
    return { level: "breached", used: Math.min(used, 1.25), label: `Breached ${formatDuration(remainingMs)} ago`, remainingMs };
  }
  return {
    level: remainingMs / window < 0.25 ? "warning" : "ok",
    used,
    label: `${formatDuration(remainingMs)} left`,
    remainingMs,
  };
}

export function initials(name: string) {
  return name
    .replace(/^(Dr|Mr|Ms|Mrs|S)\.?\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
