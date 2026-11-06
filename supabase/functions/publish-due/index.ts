// Publishes every post whose time has come.
// Called every minute by pg_cron (with x-cron-secret), or by the dashboard's
// "Post now" button (with the owner's session).

import { admin, corsHeaders, json, requestIsOwner } from "../_shared/supabase.ts";
import { createPost, XError, type XCreds } from "../_shared/x.ts";

const MAX_ATTEMPTS = 4;

async function authorized(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const { data } = await admin.rpc("verify_cron_secret", { secret });
    if (data === true) return true;
  }
  return await requestIsOwner(req);
}

async function heartbeat(result: string) {
  await admin
    .from("app_settings")
    .update({ publisher_last_run: new Date().toISOString(), publisher_last_result: result })
    .eq("id", true);
}

async function publishOne(post: any, creds: XCreds): Promise<"posted" | "retry" | "failed"> {
  const done: string[] = [...(post.x_post_ids ?? [])];
  try {
    for (let i = done.length; i < post.parts.length; i++) {
      const replyTo = done.length ? done[done.length - 1] : undefined;
      const id = await createPost(creds, post.parts[i], replyTo);
      done.push(id);
      // Save progress after every part so a failed thread resumes, never repeats.
      await admin.from("posts").update({ x_post_ids: done }).eq("id", post.id);
    }
    await admin
      .from("posts")
      .update({ status: "posted", posted_at: new Date().toISOString(), error: null, x_post_ids: done })
      .eq("id", post.id);
    return "posted";
  } catch (e) {
    const err = e instanceof XError ? e : new XError((e as Error).message, 0, false);
    const progress =
      done.length > 0 && post.parts.length > 1 ? `Posted ${done.length} of ${post.parts.length} parts. ` : "";

    if (err.transient && post.attempts < MAX_ATTEMPTS) {
      const retryAt = new Date(Date.now() + post.attempts * 5 * 60_000).toISOString();
      await admin
        .from("posts")
        .update({ status: "scheduled", scheduled_at: retryAt, error: progress + err.message, x_post_ids: done })
        .eq("id", post.id);
      return "retry";
    }
    await admin
      .from("posts")
      .update({ status: "failed", error: progress + err.message, x_post_ids: done })
      .eq("id", post.id);
    return "failed";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await authorized(req))) return json({ error: "Unauthorized" }, 401);

  const { data: creds } = await admin.from("x_credentials").select("*").eq("id", true).maybeSingle();

  if (!creds) {
    const { count } = await admin
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString());
    const msg = count ? `X not connected. ${count} due post(s) waiting.` : "Idle. X not connected yet.";
    await heartbeat(msg);
    return json({ ok: true, message: msg });
  }

  const { data: posts, error } = await admin.rpc("claim_due_posts", { max_posts: 5 });
  if (error) {
    await heartbeat(`Error: ${error.message}`);
    return json({ error: error.message }, 500);
  }

  const tally = { posted: 0, retry: 0, failed: 0 };
  for (const post of posts ?? []) tally[await publishOne(post, creds as XCreds)]++;

  const total = (posts ?? []).length;
  const msg = total === 0
    ? "Idle. Nothing due."
    : [
      tally.posted && `${tally.posted} posted`,
      tally.retry && `${tally.retry} will retry`,
      tally.failed && `${tally.failed} failed`,
    ].filter(Boolean).join(", ") + ".";
  await heartbeat(msg.charAt(0).toUpperCase() + msg.slice(1));
  return json({ ok: true, ...tally });
});
