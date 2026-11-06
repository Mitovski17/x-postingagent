// Opened from a Telegram "Reply N" button: marks the post as replied and
// redirects to X with that reply filled in. Links are signed, so only links
// the tracker sent work.

import { admin } from "../_shared/supabase.ts";
import { signLink } from "../_shared/watch.ts";

function page(msg: string, status = 400): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reply</title>` +
      `<body style="font:16px system-ui;padding:32px;background:#0b0b0b;color:#ededed">${msg}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const id = u.searchParams.get("t") ?? "";
  const d = Number(u.searchParams.get("d") ?? "-1");
  const s = u.searchParams.get("s") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(d >= 0 && d < 3)) return page("This link is broken.");

  const { data: notify } = await admin.from("notify_credentials").select("link_secret").eq("id", true).maybeSingle();
  if (!notify || (await signLink(notify.link_secret, id, d)) !== s) return page("This link is no longer valid.", 403);

  const { data: t } = await admin.from("reply_targets").select("*").eq("id", id).maybeSingle();
  const text = t?.drafts?.[d]?.text;
  if (!t || !text) return page("That post or draft isn't available anymore. Open the Replies page in your dashboard.", 404);

  await admin.from("reply_targets").update({
    status: "replied",
    replied_text: text,
    replied_at: new Date().toISOString(),
  }).eq("id", id);

  const intent = `https://x.com/intent/post?in_reply_to=${t.tweet_id}&text=${encodeURIComponent(text)}`;
  return new Response(null, { status: 302, headers: { Location: intent } });
});
