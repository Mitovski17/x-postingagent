// Browser extension endpoint: drafts replies for a post Martin picked while scrolling X,
// and records which reply he used. Authenticated with the extension key (x-ext-key).

import { admin, json } from "../_shared/supabase.ts";
import { writeReplies } from "../_shared/watch.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-ext-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function out(body: unknown, status = 200): Response {
  const r = json(body, status);
  for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = req.headers.get("x-ext-key") ?? "";
  if (key.length < 32) return out({ error: "Extension key missing. Check the extension's config." }, 401);
  const { data: k } = await admin.from("ext_keys").select("id").eq("key_hash", await sha256(key)).maybeSingle();
  if (!k) return out({ error: "Extension key not recognised." }, 401);
  admin.from("ext_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id).then(() => {});

  let body: any;
  try {
    body = await req.json();
  } catch {
    return out({ error: "Invalid request" }, 400);
  }

  try {
    if (body.action === "draft") {
      const p = body.post ?? {};
      const tweetId = String(p.tweet_id ?? "");
      const text = String(p.text ?? "").trim();
      const username = String(p.author_username ?? "").replace(/^@/, "");
      if (!/^\d{5,25}$/.test(tweetId) || !text || !username) return out({ error: "Couldn't read that post." }, 400);

      const { data: ai } = await admin.from("ai_credentials").select("anthropic_key").eq("id", true).maybeSingle();
      if (!ai?.anthropic_key) return out({ error: "Add a Claude API key in the dashboard Settings first." }, 400);
      const { data: s } = await admin.from("app_settings").select("ai_model").eq("id", true).maybeSingle();

      const target = { author_username: username, author_name: p.author_name || null, author_followers: null, text, posted_at: p.posted_at || null };
      const drafts = await writeReplies(target, ai.anthropic_key, s?.ai_model ?? "claude-sonnet-5-5", String(body.steer ?? ""));

      const { data: existing } = await admin.from("reply_targets").select("id").eq("tweet_id", tweetId).maybeSingle();
      let id = existing?.id as string | undefined;
      if (id) {
        await admin.from("reply_targets").update({ status: "ready", drafts, error: null }).eq("id", id);
      } else {
        const { data: row, error } = await admin.from("reply_targets").insert({
          tweet_id: tweetId,
          author_username: username,
          author_name: p.author_name || null,
          text,
          posted_at: p.posted_at || null,
          status: "ready",
          drafts,
          ai_note: "Picked from the browser extension.",
          source: "extension",
        }).select("id").single();
        if (error) throw new Error(error.message);
        id = row.id;
      }
      return out({ ok: true, id, drafts });
    }

    if (body.action === "replied") {
      const text = String(body.text ?? "").trim();
      if (!body.id || !text) return out({ error: "Missing reply" }, 400);
      await admin.from("reply_targets").update({ status: "replied", replied_text: text, replied_at: new Date().toISOString() }).eq("id", body.id);
      return out({ ok: true });
    }

    return out({ error: "Unknown action" }, 400);
  } catch (e) {
    return out({ error: (e as Error).message }, 500);
  }
});
