import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Post, Settings } from "../lib/types";
import { addDays, dateIn, slotsFor, type SlotInfo } from "../lib/slots";
import { dayLabel, fromInputs, inMinutes, timeHM, toInputs } from "../lib/time";
import { schedulePost, unschedule } from "../lib/actions";
import { useToast } from "./Toast";

export function ScheduleDialog({
  post,
  posts,
  settings,
  onClose,
}: {
  post: Post;
  posts: Post[];
  settings: Settings | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosenSlot, setChosenSlot] = useState<{ date: string; slot: number } | null>(null);

  const initial = post.scheduled_at ? new Date(post.scheduled_at) : inMinutes(60);
  const [date, setDate] = useState(toInputs(initial).date);
  const [time, setTime] = useState(toInputs(initial).time);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Slot days: the post's batch day, or today and tomorrow (US Eastern dates).
  const days = useMemo(() => {
    if (!settings?.slot_times?.length) return [];
    const tz = settings.slot_timezone;
    const today = dateIn(tz);
    const list = post.batch_date && post.batch_date >= today ? [post.batch_date] : [today, addDays(today, 1)];
    return list.map((d) => ({ date: d, slots: slotsFor(settings, d, posts, post.id) }));
  }, [settings, posts, post]);

  function pickSlot(date: string, s: SlotInfo) {
    setChosenSlot({ date, slot: s.slot });
    const v = toInputs(s.at);
    setDate(v.date);
    setTime(v.time);
  }

  function quick(min: number) {
    setChosenSlot(null);
    const v = toInputs(inMinutes(min));
    setDate(v.date);
    setTime(v.time);
  }

  async function onSave() {
    const when = fromInputs(date, time);
    if (!when) return setError("Pick a date and a time.");
    if (when.getTime() < Date.now() - 30_000) return setError("That time has already passed.");
    setBusy(true);
    const err = await schedulePost(post, when, chosenSlot);
    setBusy(false);
    if (err) return setError(err);
    toast(`Scheduled for ${dayLabel(when).label.toLowerCase()} at ${timeHM(when)}`);
    onClose();
  }

  async function onUnschedule() {
    setBusy(true);
    const err = await unschedule(post);
    setBusy(false);
    if (err) return setError(err);
    toast("Moved back to drafts");
    onClose();
  }

  const first = (post.parts[0] ?? "").split("\n")[0];

  return (
    <dialog
      ref={ref}
      className="sched"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="sched__inner">
        <header className="sched__head">
          <div>
            <h2 className="sched__title">Schedule post</h2>
            <p className="sched__preview">{first}</p>
          </div>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </header>

        {days.map(({ date: d, slots }) => (
          <div key={d} className="field">
            <span className="field__label">
              Slots · {dayLabel(slots[0].at).label}
            </span>
            <div className="chips">
              {slots.map((s) => {
                const disabled = s.past || !!s.takenBy;
                const active = chosenSlot?.date === d && chosenSlot.slot === s.slot;
                return (
                  <button
                    key={s.slot}
                    className={`chip${active ? " is-active" : ""}`}
                    disabled={disabled}
                    title={s.takenBy ? `Taken: ${(s.takenBy.parts[0] ?? "").slice(0, 60)}` : s.past ? "Already passed" : undefined}
                    onClick={() => pickSlot(d, s)}
                  >
                    {timeHM(s.at)}
                    {s.at.getDate() !== slots[0].at.getDate() ? " +1" : ""}
                    {s.takenBy ? " · taken" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="field">
          <span className="field__label">Quick</span>
          <div className="chips">
            <button className="chip" onClick={() => quick(15)}>In 15 min</button>
            <button className="chip" onClick={() => quick(60)}>In 1 hour</button>
            <button className="chip" onClick={() => quick(180)}>In 3 hours</button>
          </div>
        </div>

        <div className="sched__row">
          <label className="field">
            <span className="field__label">Date</span>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => {
                setChosenSlot(null);
                setDate(e.target.value);
              }}
            />
          </label>
          <label className="field">
            <span className="field__label">Time</span>
            <input
              className="input"
              type="time"
              value={time}
              onChange={(e) => {
                setChosenSlot(null);
                setTime(e.target.value);
              }}
            />
          </label>
        </div>

        {error && <p className="notice">{error}</p>}

        <footer className="sched__foot">
          {post.status === "scheduled" && (
            <button className="btn btn--ghost" onClick={onUnschedule} disabled={busy}>
              Move to drafts
            </button>
          )}
          <span className="sched__spacer" />
          <button className="btn" onClick={() => ref.current?.close()} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={onSave} disabled={busy}>
            Schedule
          </button>
        </footer>
      </div>
    </dialog>
  );
}
