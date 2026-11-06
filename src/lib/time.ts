export const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const hm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fullFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const timeHM = (d: Date | string) => hm.format(new Date(d));
export const fullDate = (d: Date | string) => fullFmt.format(new Date(d));

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

export function dayKey(d: Date | string): string {
  const c = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${c.getFullYear()}-${p(c.getMonth() + 1)}-${p(c.getDate())}`;
}

export function dayLabel(d: Date | string, now = new Date()): { label: string; sub: string } {
  const date = new Date(d);
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const sub = dayFmt.format(date);
  if (diff === 0) return { label: "Today", sub };
  if (diff === 1) return { label: "Tomorrow", sub };
  if (diff === -1) return { label: "Yesterday", sub };
  return { label: sub, sub: "" };
}

export function relative(d: Date | string, now = Date.now()): string {
  const ms = new Date(d).getTime() - now;
  const abs = Math.abs(ms);
  if (abs < 45_000) return ms >= 0 ? "in under a minute" : "just now";
  const m = Math.round(abs / 60_000);
  const h = Math.floor(m / 60);
  const days = Math.floor(h / 24);
  let span: string;
  if (days >= 2) span = `${days}d`;
  else if (h >= 1) span = m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  else span = `${m}m`;
  return ms >= 0 ? `in ${span}` : `${span} ago`;
}

export function toInputs(d: Date): { date: string; time: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

export function fromInputs(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Tomorrow (or today if still ahead) at the given hour.
export function nextAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= Date.now() + 60_000) d.setDate(d.getDate() + 1);
  return d;
}

export function inMinutes(min: number): Date {
  const d = new Date(Date.now() + min * 60_000);
  d.setSeconds(0, 0);
  return d;
}
