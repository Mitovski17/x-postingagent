import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Clock3, ExternalLink, Pencil, Send, Sparkles } from "lucide-react";
import type { Post, Settings } from "../lib/types";
import { StatusPill } from "./StatusPill";
import { useToast } from "./Toast";
import { dayLabel, relative, timeHM } from "../lib/time";
import { slotAt } from "../lib/slots";
import { postNow, setPicked } from "../lib/actions";

export function PostCard({
  post,
  settings,
  now,
  onSchedule,
}: {
  post: Post;
  settings: Settings | null;
  now: number;
  onSchedule: (p: Post) => void;
}) {
  const toast = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [confirmNow, setConfirmNow] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-check on width changes too (side menu, window resize, fonts loading).
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || expanded) return;
    // Show posts up to 10 lines in full; fold longer ones to 7 lines.
    const check = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
      setOverflows(el.scrollHeight > lh * 10 + 2);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [post.parts, expanded]);

  // Clear the "confirm post now" state after a few seconds.
  useLayoutEffect(() => {
    if (!confirmNow) return;
    const t = setTimeout(() => setConfirmNow(false), 4000);
    return () => clearTimeout(t);
  }, [confirmNow]);

  const canPick = post.status === "draft" || post.status === "scheduled";
  const canSchedule = post.status === "draft" || post.status === "scheduled" || post.status === "failed";
  const canPostNow = post.status === "draft" || post.status === "scheduled" || post.status === "failed";
  const isPicked = post.picked || post.status === "scheduled";

  const when = post.status === "posted" ? post.posted_at : post.scheduled_at;
  const suggested =
    post.status === "draft" && post.batch_date && post.slot && settings ? slotAt(settings, post.batch_date, post.slot) : null;

  const xUrl =
    post.status === "posted" && post.x_post_ids[0] && settings?.x_username
      ? `https://x.com/${settings.x_username}/status/${post.x_post_ids[0]}`
      : null;

  async function togglePick() {
    setBusy(true);
    const err = await setPicked(post, !isPicked);
    setBusy(false);
    if (err) toast(err);
  }

  async function onPostNow() {
    if (!confirmNow) return setConfirmNow(true);
    setConfirmNow(false);
    setBusy(true);
    toast(await postNow(post));
    setBusy(false);
  }

  return (
    <article
      className={`pc pc--${post.status}${isPicked ? " is-picked" : ""}${expanded ? " is-expanded" : ""}`}
      aria-busy={busy || undefined}
    >
      <header className="pc__head">
        <div className="pc__meta">
          {post.recommended && post.status === "draft" && (
            <span className="tag tag--pick" title="Claude's pick for today">
              <Sparkles size={11} strokeWidth={2} aria-hidden />
              Top pick
            </span>
          )}
          {post.score != null && <span className="tag" title="Claude's score">{post.score}</span>}
          {suggested && <span className="tag" title="Suggested slot">{timeHM(suggested)}</span>}
          {post.parts.length > 1 && <span className="tag">Thread · {post.parts.length}</span>}
          {post.angle && <span className="pc__angle">{post.angle}</span>}
        </div>
        <div className="pc__actions">
          {canPick && (
            <button
              className={`act${isPicked ? " act--on" : ""}`}
              onClick={togglePick}
              disabled={busy}
              aria-pressed={isPicked}
              aria-label={isPicked ? "Remove from chosen" : "Choose this post"}
              title={isPicked ? "Chosen. Click to remove" : "Choose. I'll schedule it if you don't"}
            >
              <Check size={15} strokeWidth={2.25} aria-hidden />
            </button>
          )}
          {canSchedule && (
            <button className="act" onClick={() => onSchedule(post)} disabled={busy} aria-label="Schedule" title="Schedule">
              <Clock3 size={15} strokeWidth={2} aria-hidden />
            </button>
          )}
          {canPostNow && (
            <button
              className={`act${confirmNow ? " act--confirm" : ""}`}
              onClick={onPostNow}
              disabled={busy}
              aria-label={confirmNow ? "Click again to post now" : "Post now"}
              title={confirmNow ? "Click again to post now" : "Post now"}
            >
              <Send size={15} strokeWidth={2} aria-hidden />
              {confirmNow && <span className="act__label">Post?</span>}
            </button>
          )}
          <a className="act" href={`#/post/${post.id}`} aria-label="Edit" title="Edit">
            <Pencil size={14} strokeWidth={2} aria-hidden />
          </a>
        </div>
      </header>

      <div ref={bodyRef} className={`pc__body${overflows && !expanded ? " is-clamped has-fade" : ""}`}>
        {post.parts.map((part, i) => (
          <div key={i} className="pc__part">
            {post.parts.length > 1 && <span className="pc__idx">{i + 1}/{post.parts.length}</span>}
            <p>{part || <em className="muted">Empty</em>}</p>
          </div>
        ))}
      </div>

      {(overflows || expanded) && (
        <button className="pc__more" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? "Show less" : "Show more"}
          {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
      )}

      {post.review && post.status === "draft" && <p className="pc__review">{post.review}</p>}

      <footer className="pc__foot">
        <StatusPill status={post.status} />
        {when && post.status !== "draft" && (
          <span className="pc__when">
            {dayLabel(when, new Date(now)).label} {timeHM(when)}
            {post.status === "scheduled" && <span className="muted"> · {relative(when, now)}</span>}
          </span>
        )}
        {post.error && <span className="pc__error">{post.error}</span>}
        {xUrl && (
          <a className="icon-btn pc__x" href={xUrl} target="_blank" rel="noreferrer" aria-label="Open on X">
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
          </a>
        )}
      </footer>
    </article>
  );
}
