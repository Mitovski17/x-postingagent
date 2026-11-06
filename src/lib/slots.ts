import type { Post, Settings } from "./types";

// Offset (ms) of a time zone from UTC at a given instant.
function tzOffset(ts: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const { type, value } of f.formatToParts(new Date(ts))) if (type !== "literal") p[type] = Number(value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
}

// "2026-11-03" + "08:00" in America/New_York -> real Date.
export function zoned(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffset(guess, tz);
  const second = guess - tzOffset(t, tz);
  if (second !== t) t = second;
  return new Date(t);
}

export function dateIn(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function slotAt(s: Settings, date: string, slot: number): Date | null {
  const t = s.slot_times?.[slot - 1];
  return t ? zoned(date, t, s.slot_timezone) : null;
}

export function cutoffAt(s: Settings, date: string): Date | null {
  if (!s.slot_times?.length) return null;
  const first = [...s.slot_times].sort()[0];
  return new Date(zoned(date, first, s.slot_timezone).getTime() - s.pick_cutoff_minutes * 60_000);
}

export type SlotInfo = { slot: number; at: Date; takenBy: Post | null; past: boolean };

export function slotsFor(s: Settings, date: string, posts: Post[], exceptId?: string): SlotInfo[] {
  const now = Date.now();
  const busy = posts
    .filter((p) => p.id !== exceptId && (p.status === "scheduled" || p.status === "publishing" || p.status === "posted"))
    .map((p) => ({ p, t: new Date((p.posted_at ?? p.scheduled_at)!).getTime() }))
    .filter((x) => !Number.isNaN(x.t));
  return (s.slot_times ?? []).map((_, i) => {
    const slot = i + 1;
    const at = slotAt(s, date, slot)!;
    // Taken when any post goes out within 45 minutes of the slot.
    const hit = busy.find((x) => Math.abs(x.t - at.getTime()) < 45 * 60_000);
    return { slot, at, takenBy: hit?.p ?? null, past: at.getTime() < now + 2 * 60_000 };
  });
}
