import { supabase } from "./supabase";
import { invoke } from "./data";
import type { Post } from "./types";

export async function setPicked(post: Post, picked: boolean): Promise<string | null> {
  // Unpicking a scheduled post sends it back to the drafts.
  const patch: Partial<Post> =
    !picked && post.status === "scheduled"
      ? { picked: false, status: "draft", scheduled_at: null }
      : { picked };
  const { error } = await supabase.from("posts").update(patch).eq("id", post.id);
  if (error) return error.message;
  // Picks in a locked batch, or outside any batch, get a slot straight away.
  if (picked) await supabase.rpc("place_picks");
  return null;
}

export async function schedulePost(
  post: Post,
  when: Date,
  slot: { date: string; slot: number } | null,
): Promise<string | null> {
  const patch: Record<string, unknown> = {
    status: "scheduled",
    scheduled_at: when.toISOString(),
    picked: true,
    error: null,
  };
  if (slot) {
    patch.batch_date = slot.date;
    patch.slot = slot.slot;
  } else if (post.batch_date) {
    patch.slot = null; // custom time: keep it in the batch but free its slot
  }
  const { error } = await supabase.from("posts").update(patch).eq("id", post.id);
  return error ? error.message : null;
}

export async function unschedule(post: Post): Promise<string | null> {
  const { error } = await supabase
    .from("posts")
    .update({ status: "draft", scheduled_at: null, picked: false })
    .eq("id", post.id);
  return error ? error.message : null;
}

export async function postNow(post: Post): Promise<string> {
  const { error } = await supabase
    .from("posts")
    .update({ status: "scheduled", scheduled_at: new Date().toISOString(), picked: true, error: null })
    .eq("id", post.id);
  if (error) return error.message;
  try {
    const r = await invoke<{ posted?: number; failed?: number; message?: string }>("publish-due", { source: "dashboard" });
    if (r.message) return r.message;
    if (r.failed) return "X rejected the post. Check the Failed tab.";
    return "Posted to X";
  } catch {
    return "Queued. The publisher sends it within a minute.";
  }
}

export async function pickRecommended(posts: Post[]): Promise<string | null> {
  const ids = posts.filter((p) => p.recommended && p.status === "draft" && !p.picked).map((p) => p.id);
  if (!ids.length) return null;
  const { error } = await supabase.from("posts").update({ picked: true }).in("id", ids);
  if (error) return error.message;
  await supabase.rpc("place_picks");
  return null;
}

export async function clearPicks(posts: Post[]): Promise<string | null> {
  const ids = posts.filter((p) => p.picked && p.status === "draft").map((p) => p.id);
  if (!ids.length) return null;
  const { error } = await supabase.from("posts").update({ picked: false }).in("id", ids);
  return error ? error.message : null;
}

export async function lockDay(date: string): Promise<string> {
  const { data, error } = await supabase.rpc("lock_batch", { d: date });
  if (error) return error.message;
  return `Day locked. ${data} post${data === 1 ? "" : "s"} scheduled.`;
}
