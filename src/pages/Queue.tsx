import { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Sparkles, Undo2 } from "lucide-react";
import type { Batch, Post, Settings } from "../lib/types";
import { PostCard } from "../components/PostCard";
import { ScheduleDialog } from "../components/ScheduleDialog";
import { useToast } from "../components/Toast";
import { dayKey, dayLabel, relative, timeHM, TIMEZONE } from "../lib/time";
import { useBatches, useNow } from "../lib/data";
import { go } from "../lib/router";
import { cutoffAt, dateIn } from "../lib/slots";
import { clearPicks, lockDay, pickRecommended } from "../lib/actions";

type Tab = "upcoming" | "drafts" | "posted" | "failed" | "all";

const TABS: { key: Tab; label: string }[] = [
  { key: "drafts", label: "Drafts" },
  { key: "upcoming", label: "Upcoming" },
  { key: "posted", label: "Posted" },
  { key: "failed", label: "Failed" },
  { key: "all", label: "All" },
];

function inTab(p: Post, tab: Tab) {
  if (tab === "upcoming") return p.status === "scheduled" || p.status === "publishing";
  if (tab === "drafts") return p.status === "draft";
  if (tab === "posted") return p.status === "posted";
  if (tab === "failed") return p.status === "failed";
  return true;
}

function anchor(p: Post): string | null {
  if (p.status === "posted") return p.posted_at ?? p.scheduled_at;
  return p.scheduled_at;
}

// Best first: chosen, Claude's picks, then score.
function rank(a: Post, b: Post) {
  return (
    Number(b.picked) - Number(a.picked) ||
    Number(b.recommended) - Number(a.recommended) ||
    (b.score ?? -1) - (a.score ?? -1) ||
    b.created_at.localeCompare(a.created_at)
  );
}

type Group = { key: string; label: string; sub: string; items: Post[]; batch?: Batch; batchDate?: string };

export function Queue({ posts, loading, settings }: { posts: Post[]; loading: boolean; settings: Settings | null }) {
  const [tab, setTab] = useState<Tab>(() => (sessionStorageGet("queue-tab") as Tab) || "drafts");
  const [scheduling, setScheduling] = useState<Post | null>(null);
  const { batches } = useBatches(true);
  const now = useNow(15_000);

  useEffect(() => {
    try {
      sessionStorage.setItem("queue-tab", tab);
    } catch { /* storage unavailable */ }
  }, [tab]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], dialog")) return;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey) go("/new");
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const counts = useMemo(() => {
    const c = { upcoming: 0, drafts: 0, posted: 0, failed: 0, all: posts.length } as Record<Tab, number>;
    for (const p of posts) for (const t of ["upcoming", "drafts", "posted", "failed"] as Tab[]) if (inTab(p, t)) c[t]++;
    return c;
  }, [posts]);

  const stats = useMemo(() => {
    const upcoming = posts
      .filter((p) => p.status === "scheduled" && p.scheduled_at)
      .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!));
    const weekAgo = now - 7 * 86_400_000;
    return {
      next: upcoming[0]?.scheduled_at ?? null,
      scheduled: upcoming.length,
      posted7: posts.filter((p) => p.status === "posted" && p.posted_at && new Date(p.posted_at).getTime() > weekAgo)
        .length,
      failed: counts.failed,
    };
  }, [posts, now, counts.failed]);

  const groups = useMemo<Group[]>(() => {
    const list = posts.filter((p) => inTab(p, tab));

    if (tab === "drafts") {
      const out: Group[] = [];
      const byBatch = new Map<string, Post[]>();
      const loose: Post[] = [];
      for (const p of list) {
        if (p.batch_date) byBatch.set(p.batch_date, [...(byBatch.get(p.batch_date) ?? []), p]);
        else loose.push(p);
      }
      for (const d of [...byBatch.keys()].sort().reverse()) {
        const [y, m, dd] = d.split("-").map(Number);
        const { label, sub } = dayLabel(new Date(y, m - 1, dd), new Date(now));
        out.push({
          key: `batch-${d}`,
          label: sub ? `${label}'s batch` : `Batch · ${label}`,
          sub,
          items: byBatch.get(d)!.sort(rank),
          batch: batches.find((b) => b.batch_date === d),
          batchDate: d,
        });
      }
      if (loose.length) out.push({ key: "loose", label: "Other drafts", sub: "", items: loose.sort(rank) });
      return out;
    }

    const desc = tab === "posted" || tab === "failed" || tab === "all";
    list.sort((a, b) => {
      const av = anchor(a), bv = anchor(b);
      if (!av && !bv) return b.updated_at.localeCompare(a.updated_at);
      if (!av) return -1;
      if (!bv) return 1;
      return desc ? bv.localeCompare(av) : av.localeCompare(bv);
    });
    const out: Group[] = [];
    for (const p of list) {
      const a = anchor(p);
      const key = a ? dayKey(a) : "none";
      let g = out.find((x) => x.key === key);
      if (!g) {
        const { label, sub } = a ? dayLabel(a, new Date(now)) : { label: "No date", sub: "" };
        g = { key, label, sub, items: [] };
        out.push(g);
      }
      g.items.push(p);
    }
    return out;
  }, [posts, tab, now, batches]);

  return (
    <div className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="page__title">Queue</h1>
          <p className="page__sub">Times shown in {TIMEZONE.replace("_", " ")}</p>
        </div>
        <a href="#/new" className="btn btn--primary">
          <Plus size={16} strokeWidth={2} aria-hidden />
          New post
          <kbd className="kbd">N</kbd>
        </a>
      </header>

      <section className="stats" aria-label="Summary">
        <div className="stat">
          <span className="stat__label">Next post</span>
          <span className="stat__value">{stats.next ? relative(stats.next, now).replace("in ", "") : "-"}</span>
          {stats.next && <span className="stat__hint">{timeHM(stats.next)}</span>}
        </div>
        <div className="stat">
          <span className="stat__label">Scheduled</span>
          <span className="stat__value">{stats.scheduled}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Posted · 7 days</span>
          <span className="stat__value">{stats.posted7}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Failed</span>
          <span className="stat__value">{stats.failed}</span>
          {stats.failed > 0 && (
            <button className="stat__hint link-btn" onClick={() => setTab("failed")}>
              Review
            </button>
          )}
        </div>
      </section>

      <div className="tabs" role="tablist" aria-label="Filter posts">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab${tab === t.key ? " is-active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="tab__count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="cards" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="pc pc--skeleton" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Empty tab={tab} />
      ) : (
        groups.map((g) => (
          <section key={g.key} className="group">
            {g.batchDate ? (
              <BatchHead group={g} posts={posts} settings={settings} now={now} />
            ) : (
              <h2 className="group__head">
                <span>{g.label}</span>
                {g.sub && <span className="group__sub">{g.sub}</span>}
              </h2>
            )}
            <div className="cards">
              {g.items.map((p) => (
                <PostCard key={p.id} post={p} settings={settings} now={now} onSchedule={setScheduling} />
              ))}
            </div>
          </section>
        ))
      )}

      {scheduling && (
        <ScheduleDialog
          post={posts.find((p) => p.id === scheduling.id) ?? scheduling}
          posts={posts}
          settings={settings}
          onClose={() => setScheduling(null)}
        />
      )}
    </div>
  );
}

function BatchHead({ group, posts, settings, now }: { group: Group; posts: Post[]; settings: Settings | null; now: number }) {
  const toast = useToast();
  const d = group.batchDate!;
  const all = posts.filter((p) => p.batch_date === d);
  const target = settings?.daily_posts ?? 7;
  const chosen = all.filter((p) => p.picked || p.status === "scheduled" || p.status === "posted" || p.status === "publishing").length;
  const cutoff = settings ? cutoffAt(settings, d) : null;
  const locked = group.batch?.locked_at;
  const isPastDay = settings ? d < dateIn(settings.slot_timezone) : false;
  const hasRecommended = all.some((p) => p.recommended && p.status === "draft" && !p.picked);
  const hasPicks = all.some((p) => p.picked && p.status === "draft");

  let status: string;
  if (locked) status = `Locked ${group.batch?.locked_by === "auto" ? "automatically" : "by you"} at ${timeHM(locked)}. New picks get the next free slot.`;
  else if (isPastDay) status = "Past day";
  else if (cutoff && cutoff.getTime() > now)
    status = `Auto-picks at ${timeHM(cutoff)} (${relative(cutoff, now)}). Open slots get filled with Claude's picks.`;
  else status = "Auto-picking now";

  return (
    <div className="batch">
      <div className="batch__info">
        <h2 className="batch__title">
          {group.label}
          {group.sub && <span className="group__sub">{group.sub}</span>}
        </h2>
        <p className="batch__status">
          <span className="batch__count">
            {chosen}/{target} chosen
          </span>
          {status}
        </p>
      </div>
      {!locked && !isPastDay && (
        <div className="batch__actions">
          {hasRecommended && (
            <button className="btn" onClick={async () => { const e = await pickRecommended(all); if (e) toast(e); }}>
              <Sparkles size={15} strokeWidth={2} aria-hidden />
              Choose Claude's picks
            </button>
          )}
          {hasPicks && (
            <button className="btn btn--ghost" onClick={async () => { const e = await clearPicks(all); if (e) toast(e); }}>
              <Undo2 size={15} strokeWidth={2} aria-hidden />
              Clear
            </button>
          )}
          <button
            className="btn btn--primary"
            onClick={async () => toast(await lockDay(d))}
            title="Schedules your chosen posts now and fills any open slots with Claude's picks"
          >
            <Lock size={15} strokeWidth={2} aria-hidden />
            Lock day now
          </button>
        </div>
      )}
    </div>
  );
}

function Empty({ tab }: { tab: Tab }) {
  const copy: Record<Tab, [string, string]> = {
    upcoming: ["Nothing scheduled", "Choose posts in Drafts or pick a time. The publisher runs every minute, even with your computer off."],
    drafts: ["No drafts", "Claude's daily batch lands here every morning."],
    posted: ["Nothing posted yet", "Posts land here once they go live on X."],
    failed: ["No failures", "If X rejects a post, it shows here with the reason."],
    all: ["Your queue is empty", "Create your first post to get started."],
  };
  const [title, body] = copy[tab];
  return (
    <div className="empty">
      <h2 className="empty__title">{title}</h2>
      <p className="muted">{body}</p>
      {(tab === "upcoming" || tab === "all" || tab === "drafts") && (
        <a href="#/new" className="btn">
          <Plus size={16} strokeWidth={2} aria-hidden />
          New post
        </a>
      )}
    </div>
  );
}

function sessionStorageGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
