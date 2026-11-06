import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Heart,
  MessageCircle,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { ReplyTarget, Settings, WatchAccount } from "../lib/types";
import { invoke, useNow, useReplyTargets, useWatchAccounts } from "../lib/data";
import { relative } from "../lib/time";
import { weightedLength } from "../lib/xtext";
import { useToast } from "../components/Toast";

type Tab = "ready" | "replied" | "skipped" | "watchlist";

const REPLY_LIMIT = 280;

function compact(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

function intentUrl(tweetId: string, text: string): string {
  return `https://x.com/intent/post?in_reply_to=${tweetId}&text=${encodeURIComponent(text)}`;
}

function tweetUrl(t: ReplyTarget): string {
  return `https://x.com/${t.author_username}/status/${t.tweet_id}`;
}

function readTab(): Tab {
  try {
    return (sessionStorage.getItem("replies-tab") as Tab) || "ready";
  } catch {
    return "ready";
  }
}

export function Replies({ settings }: { settings: Settings | null }) {
  const { targets, loading } = useReplyTargets(true);
  const { accounts } = useWatchAccounts(true);
  const [tab, setTab] = useState<Tab>(readTab);
  const [checking, setChecking] = useState(false);
  const toast = useToast();
  const now = useNow(30_000);

  useEffect(() => {
    try {
      sessionStorage.setItem("replies-tab", tab);
    } catch { /* storage unavailable */ }
  }, [tab]);

  const lists = useMemo(() => {
    const ready = targets.filter((t) => t.status === "ready" || t.status === "new" || t.status === "failed");
    // Freshest first: early replies get seen most.
    ready.sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""));
    return {
      ready,
      replied: targets.filter((t) => t.status === "replied").sort((a, b) => (b.replied_at ?? "").localeCompare(a.replied_at ?? "")),
      skipped: targets.filter((t) => t.status === "skipped" || t.status === "dismissed"),
    };
  }, [targets]);

  const repliedToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return lists.replied.filter((t) => t.replied_at && new Date(t.replied_at) >= start).length;
  }, [lists.replied]);

  async function checkNow() {
    setChecking(true);
    try {
      const r = await invoke<{ message: string }>("watch-poll", { source: "dashboard" });
      toast(r.message);
    } catch (e) {
      toast((e as Error).message);
    }
    setChecking(false);
  }

  const counts: Record<Tab, number> = {
    ready: lists.ready.length,
    replied: lists.replied.length,
    skipped: lists.skipped.length,
    watchlist: accounts.filter((a) => a.active).length,
  };

  return (
    <div className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="page__title">Replies</h1>
          <p className="page__sub">New posts from accounts you watch, with reply drafts. You post each reply yourself on X.</p>
        </div>
        <button className="btn" onClick={checkNow} disabled={checking}>
          <RefreshCw size={15} strokeWidth={2} aria-hidden className={checking ? "spin" : undefined} />
          {checking ? "Checking…" : "Check now"}
        </button>
      </header>

      <section className="stats" aria-label="Summary">
        <div className="stat">
          <span className="stat__label">Ready to reply</span>
          <span className="stat__value">{lists.ready.filter((t) => t.status === "ready").length}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Replied today</span>
          <span className="stat__value">{repliedToday}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Watching</span>
          <span className="stat__value">{counts.watchlist}</span>
        </div>
        <div className="stat" title={settings?.watcher_last_result ?? undefined}>
          <span className="stat__label">Last check</span>
          <span className="stat__value stat__value--sm">
            {settings?.watcher_last_run ? relative(settings.watcher_last_run, now) : "Never"}
          </span>
          {settings?.watcher_last_result && <span className="stat__hint">{settings.watcher_last_result}</span>}
        </div>
      </section>

      {settings && !settings.ai_connected && (
        <p className="notice rp-notice">
          New posts are being collected, but drafts need a Claude API key. <a href="#/settings">Add it in Settings</a>.
        </p>
      )}

      <div className="tabs" role="tablist" aria-label="Reply views">
        {(
          [
            ["ready", "Ready"],
            ["replied", "Replied"],
            ["skipped", "Skipped"],
            ["watchlist", "Watchlist"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`tab${tab === k ? " is-active" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
            <span className="tab__count">{counts[k]}</span>
          </button>
        ))}
      </div>

      {tab === "watchlist" ? (
        <Watchlist accounts={accounts} targets={targets} now={now} />
      ) : loading ? (
        <div className="cards" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="pc pc--skeleton" />
          ))}
        </div>
      ) : lists[tab].length === 0 ? (
        <div className="empty">
          <h2 className="empty__title">
            {tab === "ready" ? "Nothing to reply to right now" : tab === "replied" ? "No replies yet" : "Nothing skipped"}
          </h2>
          <p className="muted">
            {tab === "ready"
              ? "New posts from your watchlist show up here within 10 minutes, with drafts ready."
              : tab === "replied"
                ? "Replies you send from the Ready tab are listed here."
                : "Posts Claude didn't think were worth a reply land here, with the reason."}
          </p>
        </div>
      ) : (
        <div className="cards cards--replies">
          {lists[tab].map((t) => (
            <ReplyCard key={t.id} t={t} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- one post with its drafts ----------

function ReplyCard({ t, now }: { t: ReplyTarget; now: number }) {
  const toast = useToast();
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [choice, setChoice] = useState(0);
  const [text, setText] = useState(t.drafts?.[0]?.text ?? "");
  const [busy, setBusy] = useState(false);

  // New drafts arriving (first draft or redraft) reset the editor.
  const draftKey = JSON.stringify(t.drafts ?? []);
  useEffect(() => {
    setChoice(0);
    setText(t.drafts?.[0]?.text ?? "");
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || expanded) return;
    const check = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
      setOverflows(el.scrollHeight > lh * 8 + 2);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [t.text, expanded]);

  const len = weightedLength(text);

  function pick(i: number) {
    setChoice(i);
    setText(t.drafts?.[i]?.text ?? "");
  }

  async function replyOnX() {
    if (!text.trim()) return;
    window.open(intentUrl(t.tweet_id, text.trim()), "_blank", "noopener");
    const { error } = await supabase
      .from("reply_targets")
      .update({ status: "replied", replied_text: text.trim(), replied_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) toast(error.message);
    else toast("Opened on X. Moved to Replied.");
  }

  async function setStatus(status: ReplyTarget["status"], msg: string) {
    const { error } = await supabase.from("reply_targets").update({ status }).eq("id", t.id);
    toast(error ? error.message : msg);
  }

  async function redraft(force: boolean) {
    setBusy(true);
    try {
      const r = await invoke<{ status: string }>("watch-admin", { action: "redraft", id: t.id, force });
      toast(r.status === "skipped" ? "Claude still thinks this one isn't worth a reply." : "New drafts ready");
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Couldn't copy. Select the text instead.");
    }
  }

  const m = t.metrics ?? {};

  return (
    <article className={`pc rc rc--${t.status}`} aria-busy={busy || undefined}>
      <header className="rc__head">
        <span className="avatar" aria-hidden>
          {(t.author_name ?? t.author_username).charAt(0).toUpperCase()}
        </span>
        <div className="rc__who">
          <strong className="rc__name">{t.author_name ?? t.author_username}</strong>
          <span className="rc__meta">
            @{t.author_username} · {compact(t.author_followers)} followers
            {t.posted_at && <> · {relative(t.posted_at, now)}</>}
          </span>
        </div>
        <div className="pc__actions">
          <a className="act" href={tweetUrl(t)} target="_blank" rel="noreferrer" aria-label="Open post on X" title="Open post on X">
            <ExternalLink size={14} strokeWidth={2} aria-hidden />
          </a>
          {(t.status === "ready" || t.status === "failed") && (
            <button className="act" onClick={() => redraft(false)} disabled={busy} aria-label="New drafts" title="Write new drafts">
              <RefreshCw size={14} strokeWidth={2} aria-hidden className={busy ? "spin" : undefined} />
            </button>
          )}
          {(t.status === "ready" || t.status === "new" || t.status === "failed") && (
            <button className="act" onClick={() => setStatus("dismissed", "Skipped")} aria-label="Skip" title="Skip this post">
              <X size={15} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
      </header>

      <p ref={bodyRef} className={`rc__text${overflows && !expanded ? " is-clamped" : ""}`}>
        {t.text}
      </p>
      {(overflows || expanded) && (
        <button className="pc__more" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? "Show less" : "Show more"}
          {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
      )}

      <div className="rc__stats">
        <span title="Replies">
          <MessageCircle size={13} aria-hidden /> {compact(m.reply_count ?? 0)}
        </span>
        <span title="Likes">
          <Heart size={13} aria-hidden /> {compact(m.like_count ?? 0)}
        </span>
        {t.ai_note && <span className="rc__note">{t.ai_note}</span>}
      </div>

      {t.status === "new" && <p className="rc__waiting">Writing drafts…</p>}
      {t.status === "failed" && <p className="notice small">{t.error ?? "Drafting failed."}</p>}

      {t.status === "ready" && t.drafts && (
        <div className="rc__drafts">
          <div className="rc__options" role="radiogroup" aria-label="Reply drafts">
            {t.drafts.map((d, i) => (
              <button
                key={i}
                role="radio"
                aria-checked={choice === i}
                className={`rc__opt${choice === i ? " is-active" : ""}`}
                onClick={() => pick(i)}
              >
                <span className="rc__angle">{d.angle || `Option ${i + 1}`}</span>
                <span className="rc__optText">{d.text}</span>
              </button>
            ))}
          </div>
          <label className="field">
            <span className="field__label">
              Your reply <span className={`rc__count${len > REPLY_LIMIT ? " is-over" : ""}`}>{len}/{REPLY_LIMIT}</span>
            </span>
            <textarea className="input rc__editor" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="rc__send">
            <button className="btn btn--ghost" onClick={copy}>
              <Copy size={15} strokeWidth={2} aria-hidden />
              Copy
            </button>
            <button className="btn btn--primary" onClick={replyOnX} disabled={!text.trim() || len > REPLY_LIMIT}>
              <Send size={15} strokeWidth={2} aria-hidden />
              Reply on X
            </button>
          </div>
        </div>
      )}

      {t.status === "replied" && (
        <div className="rc__mine">
          <span className="rc__angle">
            <Check size={12} strokeWidth={2.5} aria-hidden /> You replied{t.replied_at ? ` ${relative(t.replied_at, now)}` : ""}
          </span>
          <p>{t.replied_text}</p>
          <button className="link-btn" onClick={() => setStatus("ready", "Moved back to Ready")}>
            Didn't post it? Move back to Ready
          </button>
        </div>
      )}

      {(t.status === "skipped" || t.status === "dismissed") && (
        <div className="rc__send">
          <button className="btn" onClick={() => redraft(true)} disabled={busy}>
            <RefreshCw size={15} strokeWidth={2} aria-hidden className={busy ? "spin" : undefined} />
            Draft replies anyway
          </button>
        </div>
      )}
    </article>
  );
}

// ---------- watchlist ----------

function Watchlist({ accounts, targets, now }: { accounts: WatchAccount[]; targets: ReplyTarget[]; now: number }) {
  const toast = useToast();
  const [handles, setHandles] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!handles.trim()) return;
    setBusy(true);
    try {
      const r = await invoke<{ added: string[]; missing: string[] }>("watch-admin", { action: "add_accounts", usernames: handles });
      const parts = [];
      if (r.added.length) parts.push(`Added ${r.added.map((h) => "@" + h).join(", ")}`);
      if (r.missing.length) parts.push(`Not found: ${r.missing.map((h) => "@" + h).join(", ")}`);
      toast(parts.join(". ") || "Nothing added");
      setHandles("");
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  }

  async function toggle(a: WatchAccount) {
    const { error } = await supabase.from("watch_accounts").update({ active: !a.active }).eq("id", a.id);
    if (error) toast(error.message);
  }

  async function remove(a: WatchAccount) {
    if (confirmId !== a.id) return setConfirmId(a.id);
    setConfirmId(null);
    const { error } = await supabase.from("watch_accounts").delete().eq("id", a.id);
    toast(error ? error.message : `Removed @${a.username}`);
  }

  const active = accounts.filter((a) => a.active).length;

  // How useful each account has been over the last 7 days.
  const stats = useMemo(() => {
    const m = new Map<string, { seen: number; worth: number; replied: number }>();
    for (const t of targets) {
      if (!t.account_id) continue;
      const s = m.get(t.account_id) ?? { seen: 0, worth: 0, replied: 0 };
      s.seen++;
      if (t.status === "ready" || t.status === "replied" || (t.status === "dismissed" && t.drafts)) s.worth++;
      if (t.status === "replied") s.replied++;
      m.set(t.account_id, s);
    }
    return m;
  }, [targets]);

  return (
    <div className="wl">
      <form className="wl__add" onSubmit={add}>
        <label className="field">
          <span className="field__label">Add accounts</span>
          <input
            className="input"
            placeholder="@handle, @another or paste x.com links"
            value={handles}
            onChange={(e) => setHandles(e.target.value)}
          />
          <span className="field__help">
            Each active account costs about $0.005 per post it makes. {active} active, roughly ${(active * 4 * 30 * 0.005).toFixed(0)}
            /month at 4 posts a day each.
          </span>
        </label>
        <button className="btn btn--primary" disabled={busy || !handles.trim()}>
          {busy ? "Looking up…" : "Add"}
        </button>
      </form>

      <ul className="wl__list">
        {accounts.map((a) => (
          <li key={a.id} className={`wl__row${a.active ? "" : " is-off"}`}>
            <span className="avatar" aria-hidden>
              {(a.name ?? a.username).charAt(0).toUpperCase()}
            </span>
            <div className="wl__who">
              <a href={`https://x.com/${a.username}`} target="_blank" rel="noreferrer" className="rc__name">
                {a.name ?? a.username}
              </a>
              <span className="rc__meta">
                @{a.username} · {compact(a.followers)} followers{a.category ? ` · ${a.category}` : ""}
              </span>
              {(() => {
                const st = stats.get(a.id);
                if (!st) return <span className="rc__meta">No posts in the last 7 days</span>;
                return (
                  <span className={`wl__stat${st.seen >= 5 && st.worth === 0 ? " is-weak" : ""}`}>
                    7 days: {st.seen} posts · {st.worth} worth replying · {st.replied} replied
                    {st.seen >= 5 && st.worth === 0 ? " · consider swapping" : ""}
                  </span>
                );
              })()}
              {a.last_error ? (
                <span className="wl__err">{a.last_error}</span>
              ) : (
                <span className="rc__meta">{a.last_checked_at ? `Checked ${relative(a.last_checked_at, now)}` : "Waiting for first check"}</span>
              )}
            </div>
            <label className="switch" title={a.active ? "Watching" : "Paused"}>
              <input type="checkbox" role="switch" checked={a.active} onChange={() => toggle(a)} aria-label={`Watch @${a.username}`} />
              <span className="switch__track" aria-hidden />
            </label>
            <button
              className={`act${confirmId === a.id ? " act--confirm" : ""}`}
              onClick={() => remove(a)}
              aria-label={confirmId === a.id ? "Click again to remove" : `Remove @${a.username}`}
              title={confirmId === a.id ? "Click again to remove" : "Remove"}
            >
              <Trash2 size={14} strokeWidth={2} aria-hidden />
              {confirmId === a.id && <span className="act__label">Remove?</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
