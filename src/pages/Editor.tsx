import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, Plus, Send, Trash2, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Post, Settings } from "../lib/types";
import { StatusPill } from "../components/StatusPill";
import { useToast } from "../components/Toast";
import { invoke } from "../lib/data";
import { go } from "../lib/router";
import { dayLabel, fromInputs, fullDate, inMinutes, nextAt, timeHM, TIMEZONE, toInputs } from "../lib/time";
import { feedCut, hasLink, LIMIT_LONG, LIMIT_STANDARD, weightedLength } from "../lib/xtext";

const nyFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", weekday: "short" });

function defaultSlot(): Date {
  const d = inMinutes(60);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}

export function Editor({ id, settings }: { id?: string; settings: Settings | null }) {
  const toast = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [parts, setParts] = useState<string[]>([""]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "now" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load existing post, or start a new one (optionally from a duplicate).
  useEffect(() => {
    if (!id) {
      let start = [""];
      try {
        const dup = sessionStorage.getItem("duplicate-parts");
        if (dup) {
          start = JSON.parse(dup);
          sessionStorage.removeItem("duplicate-parts");
        }
      } catch { /* ignore */ }
      setParts(start);
      const s = toInputs(defaultSlot());
      setDate(s.date);
      setTime(s.time);
      return;
    }
    supabase
      .from("posts")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        const p = data as Post | null;
        setPost(p);
        if (p) {
          setParts(p.parts.length ? p.parts : [""]);
          const s = toInputs(p.scheduled_at ? new Date(p.scheduled_at) : defaultSlot());
          setDate(s.date);
          setTime(s.time);
        }
        setLoaded(true);
      });
  }, [id]);

  const limit = settings?.long_posts ? LIMIT_LONG : LIMIT_STANDARD;
  const readOnly = post?.status === "posted" || post?.status === "publishing";
  const liveCount = post?.x_post_ids.length ?? 0;
  const when = fromInputs(date, time);
  const lengths = useMemo(() => parts.map(weightedLength), [parts]);
  const over = lengths.findIndex((l) => l > limit);
  const anyLink = parts.some(hasLink);

  function validate(): string | null {
    const empty = parts.findIndex((p) => !p.trim());
    if (empty !== -1) return parts.length > 1 ? `Part ${empty + 1} is empty. Write it or remove it.` : "Write something first.";
    if (over !== -1) {
      return settings?.long_posts
        ? `Part ${over + 1} is over ${LIMIT_LONG.toLocaleString()} characters.`
        : `Part ${over + 1} is over 280. Turn on long posts in Settings (needs X Plus) or split it into a thread.`;
    }
    return null;
  }

  async function save(status: "draft" | "scheduled", at: Date | null): Promise<boolean> {
    const v = validate();
    if (v) {
      setError(v);
      return false;
    }
    setBusy(true);
    setError(null);
    const payload: Partial<Post> = {
      parts: parts.map((p) => p.replace(/\s+$/, "")),
      status,
      scheduled_at: at ? at.toISOString() : null,
      ...(status === "scheduled" ? { error: null, attempts: 0 } : {}),
    };
    const res = post
      ? await supabase.from("posts").update(payload).eq("id", post.id).select().single()
      : await supabase.from("posts").insert(payload).select().single();
    setBusy(false);
    if (res.error) {
      setError(res.error.message);
      return false;
    }
    setPost(res.data as Post);
    return true;
  }

  async function onSchedule() {
    if (!when) return setError("Pick a date and a time.");
    if (when.getTime() < Date.now() - 30_000) return setError("That time has already passed. Pick a later time, or use Post now.");
    if (await save("scheduled", when)) {
      toast(`Scheduled for ${dayLabel(when).label.toLowerCase()} at ${timeHM(when)}`);
      go("/");
    }
  }

  async function onDraft() {
    if (await save("draft", when)) {
      toast("Draft saved");
      go("/");
    }
  }

  async function onPostNow() {
    if (confirm !== "now") return setConfirm("now");
    setConfirm(null);
    if (!(await save("scheduled", new Date()))) return;
    setBusy(true);
    try {
      const r = await invoke<{ posted?: number; failed?: number; message?: string }>("publish-due", { source: "dashboard" });
      if (r.message) toast(r.message);
      else if (r.failed) toast("X rejected the post. Open it to see why.");
      else toast("Posted to X");
    } catch {
      toast("Queued. The publisher will send it within a minute.");
    }
    setBusy(false);
    go("/");
  }

  async function onDelete() {
    if (!post) return go("/");
    if (confirm !== "delete") return setConfirm("delete");
    setBusy(true);
    const { error: e } = await supabase.from("posts").delete().eq("id", post.id);
    setBusy(false);
    if (e) return setError(e.message);
    toast("Post deleted");
    go("/");
  }

  function onDuplicate() {
    try {
      sessionStorage.setItem("duplicate-parts", JSON.stringify(parts));
    } catch { /* ignore */ }
    go("/new");
  }

  // Ctrl/Cmd + Enter schedules
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !readOnly && !busy) {
        e.preventDefault();
        onSchedule();
      }
      if (e.key === "Escape") setConfirm(null);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  if (!loaded) return <div className="page"><div className="row row--skeleton" /></div>;
  if (id && !post) {
    return (
      <div className="page">
        <div className="empty">
          <h2 className="empty__title">Post not found</h2>
          <p className="muted">It may have been deleted.</p>
          <a className="btn" href="#/">Back to queue</a>
        </div>
      </div>
    );
  }

  const handle = settings?.x_username ?? "you";
  const name = settings?.x_name ?? "Your account";
  const preview = feedCut(parts[0] ?? "");
  const xUrl = post?.x_post_ids[0] && settings?.x_username ? `https://x.com/${settings.x_username}/status/${post.x_post_ids[0]}` : null;
  const quick = [inMinutes(60), nextAt(9), nextAt(13), nextAt(18)];

  return (
    <div className="page page--editor">
      <a href="#/" className="back">
        <ArrowLeft size={15} strokeWidth={1.75} aria-hidden />
        Queue
      </a>

      <header className="page__head">
        <div>
          <h1 className="page__title">{post ? (readOnly ? "Post" : "Edit post") : "New post"}</h1>
          {post && (
            <p className="page__sub">
              Created {fullDate(post.created_at)}
              {post.source === "claude" ? " by Claude" : ""}
            </p>
          )}
        </div>
        {post && <StatusPill status={post.status} />}
      </header>

      {post?.status === "failed" && post.error && (
        <div className="notice notice--error" role="alert">
          <strong>X didn't take this post.</strong> {post.error}
          {liveCount > 0 && " Retrying continues from the next part, nothing already live is posted twice."}
        </div>
      )}

      <div className="editor">
        <section className="composer" aria-label="Post text">
          {parts.map((text, i) => {
            const locked = readOnly || i < liveCount;
            const len = lengths[i];
            const isOver = len > limit;
            const pct = Math.min(1, len / (settings?.long_posts ? LIMIT_STANDARD : limit));
            return (
              <div key={i} className={`part${locked ? " part--locked" : ""}`}>
                <div className="part__rail" aria-hidden>
                  <span className="avatar">{name.charAt(0).toUpperCase()}</span>
                  {i < parts.length - 1 && <span className="part__line" />}
                </div>
                <div className="part__main">
                  <div className="part__head">
                    <span className="part__name">{i === 0 ? name : `Reply ${i}`}</span>
                    <span className="muted">@{handle}</span>
                    {i < liveCount && <span className="tag">Live</span>}
                    {!locked && parts.length > 1 && (
                      <button
                        className="icon-btn part__remove"
                        aria-label={`Remove part ${i + 1}`}
                        onClick={() => setParts(parts.filter((_, j) => j !== i))}
                      >
                        <X size={14} strokeWidth={2} aria-hidden />
                      </button>
                    )}
                  </div>
                  <AutoTextarea
                    value={text}
                    readOnly={locked}
                    autoFocus={!post && i === 0}
                    placeholder={i === 0 ? "What do you want to say?" : "Continue the thread"}
                    aria-label={i === 0 ? "Post text" : `Thread part ${i + 1}`}
                    onChange={(v) => {
                      const next = [...parts];
                      next[i] = v;
                      setParts(next);
                      setError(null);
                    }}
                  />
                  {!locked && (
                    <div className="part__foot">
                      <span className={`counter${isOver ? " is-over" : ""}`}>
                        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
                          <circle cx="10" cy="10" r="8" className="counter__track" />
                          <circle
                            cx="10"
                            cy="10"
                            r="8"
                            className="counter__fill"
                            strokeDasharray={`${pct * 50.27} 50.27`}
                          />
                        </svg>
                        {len.toLocaleString()} / {limit.toLocaleString()}
                      </span>
                      {settings?.long_posts && len > LIMIT_STANDARD && (
                        <span className="muted small">First 280 show in the feed</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {!readOnly && (
            <button className="add-part" onClick={() => setParts([...parts, ""])}>
              <Plus size={15} strokeWidth={2} aria-hidden />
              Add to thread
            </button>
          )}

          {anyLink && !readOnly && (
            <p className="notice small">
              This post has a link. X's API charges about $0.20 for a post with a link, and about $0.015 without one.
            </p>
          )}
        </section>

        <aside className="panel" aria-label="Scheduling">
          {readOnly ? (
            <div className="panel__block">
              <span className="panel__label">{post?.status === "posted" ? "Posted" : "Publishing"}</span>
              <p className="panel__big">{post?.posted_at ? fullDate(post.posted_at) : "Right now"}</p>
              <div className="panel__actions">
                {xUrl && (
                  <a className="btn btn--primary btn--block" href={xUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} strokeWidth={2} aria-hidden />
                    Open on X
                  </a>
                )}
                <button className="btn btn--block" onClick={onDuplicate}>
                  <Copy size={15} strokeWidth={2} aria-hidden />
                  Duplicate as new
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="panel__block">
                <span className="panel__label">Schedule</span>
                <div className="when">
                  <label className="field">
                    <span className="sr-only">Date</span>
                    <input className="input mono" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </label>
                  <label className="field">
                    <span className="sr-only">Time</span>
                    <input className="input mono" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </label>
                </div>
                <div className="chips">
                  {quick.map((d, i) => {
                    const s = toInputs(d);
                    const active = s.date === date && s.time === time;
                    return (
                      <button
                        key={i}
                        className={`chip${active ? " is-active" : ""}`}
                        onClick={() => {
                          setDate(s.date);
                          setTime(s.time);
                        }}
                      >
                        {i === 0 ? "In 1 hour" : `${dayLabel(d).label} ${timeHM(d)}`}
                      </button>
                    );
                  })}
                </div>
                <p className="muted small">
                  {TIMEZONE.replace("_", " ")}
                  {when && <> · {nyFmt.format(when)} in New York</>}
                </p>
              </div>

              {error && (
                <p className="notice notice--error small" role="alert">
                  {error}
                </p>
              )}

              <div className="panel__actions">
                <button className="btn btn--primary btn--block" disabled={busy} onClick={onSchedule}>
                  {post?.status === "scheduled" ? "Update schedule" : post?.status === "failed" ? "Reschedule" : "Schedule"}
                  <kbd className="kbd kbd--inv">Ctrl ↵</kbd>
                </button>
                <div className="split">
                  <button className="btn" disabled={busy} onClick={onDraft}>
                    Save draft
                  </button>
                  <button className={`btn${confirm === "now" ? " btn--confirm" : ""}`} disabled={busy} onClick={onPostNow}>
                    <Send size={14} strokeWidth={2} aria-hidden />
                    {confirm === "now" ? "Confirm" : "Post now"}
                  </button>
                </div>
                {!settings?.x_username && (
                  <p className="muted small">
                    X isn't connected yet. Posts wait in the queue until you <a href="#/settings">connect it</a>.
                  </p>
                )}
              </div>
            </>
          )}

          <div className="panel__block">
            <span className="panel__label">In the feed</span>
            <div className="preview">
              <span className="avatar">{name.charAt(0).toUpperCase()}</span>
              <div className="preview__body">
                <div className="preview__head">
                  <strong>{name}</strong>
                  <span className="muted">@{handle}</span>
                </div>
                <p className="preview__text">
                  {preview.visible || <span className="muted">Your post shows here.</span>}
                  {preview.truncated && <span className="preview__more"> Show more</span>}
                </p>
                {parts.length > 1 && <span className="muted small">Show this thread · {parts.length} posts</span>}
              </div>
            </div>
          </div>

          {post && (
            <button
              className={`btn btn--ghost btn--block${confirm === "delete" ? " btn--confirm" : ""}`}
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 size={14} strokeWidth={2} aria-hidden />
              {confirm === "delete" ? "Click again to delete" : readOnly ? "Remove from dashboard" : "Delete post"}
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

function AutoTextarea({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="part__input"
      rows={3}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
}
