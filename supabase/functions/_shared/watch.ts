// Reply assistant: reads new posts from watched accounts, has Haiku pick the ones worth
// replying to, has Sonnet write the replies, and pings Telegram.
// Posting stays manual: since Feb 2026 X's self-serve API refuses replies to posts
// that didn't mention you, so replies open X with the text pre-filled.

import { admin } from "./supabase.ts";
import { oauthHeader, XError, type XCreds } from "./x.ts";

const API = "https://api.x.com/2";
const FIRST_LOOKBACK_HOURS = 6; // first check of a new account only looks this far back
const MAX_AGE_HOURS = 12; // older posts aren't worth a reply
const DRAFTS_PER_RUN = 12;
const TRIAGE_MODEL = "claude-haiku-5-5";
const FN_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

// ---------- X reads ----------

async function xGet(path: string, query: Record<string, string>, creds: XCreds): Promise<any> {
  const url = `${API}${path}`;
  const qs = new URLSearchParams(query).toString();
  let res: Response;
  try {
    res = await fetch(qs ? `${url}?${qs}` : url, {
      headers: { Authorization: await oauthHeader("GET", url, creds, query) },
    });
  } catch (e) {
    throw new XError(`Couldn't reach X: ${(e as Error).message}`, 0, true);
  }
  const text = await res.text();
  let payload: any = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch { /* keep text */ }
  if (!res.ok) {
    const msg = payload?.detail || payload?.title || payload?.errors?.[0]?.message || String(text).slice(0, 200);
    if (res.status === 402) throw new XError("X API credits are empty. Top up in the X developer console.", 402, false);
    if (res.status === 429) throw new XError("X rate limit hit, will retry next run.", 429, true);
    throw new XError(`X error ${res.status}: ${msg}`, res.status, res.status >= 500);
  }
  return payload;
}

export type XUser = { id: string; username: string; name: string; followers: number };

export async function lookupUsers(usernames: string[], creds: XCreds): Promise<{ found: XUser[]; missing: string[] }> {
  const found: XUser[] = [];
  const missing: string[] = [];
  for (let i = 0; i < usernames.length; i += 100) {
    const chunk = usernames.slice(i, i + 100);
    const out = await xGet("/users/by", { usernames: chunk.join(","), "user.fields": "public_metrics" }, creds);
    for (const u of out.data ?? []) {
      found.push({ id: u.id, username: u.username, name: u.name, followers: u.public_metrics?.followers_count ?? 0 });
    }
    for (const e of out.errors ?? []) if (e.value) missing.push(e.value);
  }
  return { found, missing };
}

async function newPostsFor(acc: any, creds: XCreds): Promise<any[]> {
  const q: Record<string, string> = {
    max_results: "20",
    exclude: "retweets,replies",
    "tweet.fields": "created_at,public_metrics,lang",
  };
  if (acc.since_id) q.since_id = acc.since_id;
  else q.start_time = new Date(Date.now() - FIRST_LOOKBACK_HOURS * 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const out = await xGet(`/users/${acc.x_user_id}/tweets`, q, creds);
  return out.data ?? [];
}

// ---------- Claude ----------

const ABOUT = `Martin (@coach_mitovski) is a fitness and nutrition coach with 6+ years of experience who also builds software. His audience is founders, developers and people whose work happens in their head. His topics: eating and daily habits for steady energy and focus (blood sugar and the afternoon crash, protein, caffeine timing, hydration, sleep), training and strength around a desk job, body composition, and health science explained simply. The point of replying is to be noticed by the post's audience so they visit his profile.`;

const TRIAGE_SYSTEM = `${ABOUT}

Decide if Martin should reply to the post you are given. Say yes only when he can add something credible from his topics, so the reply shows his expertise:
- Health science, nutrition, training, fitness, sleep, supplements, longevity posts: usually yes, unless it is a pure promo or a link with no content.
- Founder, creator and productivity posts: yes only if the post touches energy, focus, burnout, long hours, sleep, stress, routines, discipline, health or the body. Say no to product launches, app updates, revenue numbers, marketing or sales tactics, AI and tech news, hiring, and investing.
- Always no: politics, culture war, tragedy or sensitive news, giveaways, personal life updates, posts that are only a link, and anything where a reply would look like self-promotion.

Always answer by calling the decide tool, never in plain text.`;

const DRAFT_SYSTEM = `You write X (Twitter) replies for Martin. ${ABOUT}

The goal is a reply that reads like a sharp person who knows this subject, so readers click his profile out of curiosity. A reply that drifts away from the post reads like a bot, so relevance comes first.

Write 3 to 5 reply options, each a different approach:
1. "challenge": a contrarian take or a challenge to a claim in the post, backed by a true, well established fact (a mechanism, a known study result, a common exception). Write it only when the post has a claim that is wrong, overstated or missing an important caveat. Disagree with the idea, stay respectful to the person. Skip this one when there is nothing honest to challenge; never disagree for the sake of it.
2. "expert": agrees with the post and adds one niche, specific detail an expert would know (the mechanism behind it, a number, a nuance, who it applies to most). It should teach the reader something the post left out.
3 to 5. Your choice, picked to suit this post. For example: "question" (a specific question about the post's claim or data that the author would want to answer), "practical" (how to apply it), "nuance" (where it holds and where it doesn't), "story" (a brief first-person moment, only when it is about the exact topic of the post), or "wit" (a dry, clever line on the topic).

Relevance rules:
- Every sentence must be about the subject of this post. Build on its specific claim, study, number or example.
- Don't steer the reply toward Martin, his clients, coaching, founders, desk work, focus or productivity unless the post itself is about that. Drop phrases like "people I coach" or "my clients".
- Read it as the author would: if a sentence would make them wonder why it's there, delete it.

Rules for every reply:
- 1 to 3 short sentences, at most 260 characters. Plain, direct, friendly, simple words.
- Never generic praise like "Great post" or "So true".
- No links, hashtags or emojis. Never mention his product or "DM me".
- No em dashes or en dashes; use commas, full stops or a normal hyphen.
- No forced negation or contrast ("it's not X, it's Y", "instead of X, Y", "not this but that").
- No staccato fragments ("No this. No that. Just this."), no stacked one-word sentences.
- No filler adverbs (truly, simply, really, basically, actually, quietly, completely).
- No AI phrases (game-changer, unlock, dive in, here's why, level up, supercharge).
- Facts must be true and conservative. Use a number only when you are sure it is well established. Never invent studies, names or statistics. No medical advice to individuals.
- Match the post's language if it isn't English.

Always answer by calling the submit_replies tool, never in plain text.`;

export async function callClaude(
  key: string,
  model: string,
  system: string,
  user: string,
  maxTokens = 700,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    }),
  });
  const text = await res.text();
  let payload: any = {};
  try {
    payload = JSON.parse(text);
  } catch { /* keep empty */ }
  if (!res.ok) {
    const msg = payload?.error?.message ?? text.slice(0, 200);
    if (res.status === 401) throw new Error("Claude rejected the API key. Paste a new one in Settings.");
    if (res.status === 404) throw new Error(`Claude model "${model}" not found. Pick another model in Settings.`);
    if (res.status === 400 && /credit|balance/i.test(msg)) throw new Error("Your Anthropic credit balance is empty.");
    throw new Error(`Claude error ${res.status}: ${msg}`);
  }
  return (payload.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

// Structured output: Claude must answer by "calling" this tool, so the result is always valid JSON.
async function callClaudeTool(
  key: string,
  model: string,
  system: string,
  user: string,
  tool: { name: string; description: string; input_schema: Record<string, unknown> },
  maxTokens = 800,
): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: [tool],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: user }],
    }),
  });
  const text = await res.text();
  let payload: any = {};
  try {
    payload = JSON.parse(text);
  } catch { /* keep empty */ }
  if (!res.ok) {
    const msg = payload?.error?.message ?? text.slice(0, 200);
    if (res.status === 401) throw new Error("Claude rejected the API key. Paste a new one in Settings.");
    if (res.status === 404) throw new Error(`Claude model "${model}" not found. Pick another model in Settings.`);
    if (res.status === 400 && /credit|balance/i.test(msg)) throw new Error("Your Anthropic credit balance is empty.");
    throw new Error(`Claude error ${res.status}: ${msg}`);
  }
  const block = (payload.content ?? []).find((c: any) => c.type === "tool_use");
  if (block) return block.input;
  // Fallback: the model answered in text. Pull out the first JSON object.
  const raw = (payload.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Claude didn't return a result");
  return JSON.parse(m[0]);
}

const TRIAGE_TOOL = {
  name: "decide",
  description: "Record whether Martin should reply to this post.",
  input_schema: {
    type: "object",
    properties: {
      worth_replying: { type: "boolean" },
      note: { type: "string", description: "One short sentence on why" },
    },
    required: ["worth_replying", "note"],
  },
};

const DRAFT_TOOL = {
  name: "submit_replies",
  description: "Submit 3 to 5 reply options.",
  input_schema: {
    type: "object",
    properties: {
      replies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            angle: {
              type: "string",
              description: 'One lowercase word naming the approach: "challenge", "expert", "question", "practical", "nuance", "story", "wit" or similar',
            },
            text: { type: "string" },
          },
          required: ["angle", "text"],
        },
      },
    },
    required: ["replies"],
  },
};

export async function checkClaudeKey(key: string): Promise<void> {
  await callClaude(key, TRIAGE_MODEL, "Reply with the word ok.", "ok", 5);
}

const BANNED = /[–—]/g;

function postPrompt(t: any): string {
  const ageMin = t.posted_at ? Math.round((Date.now() - new Date(t.posted_at).getTime()) / 60000) : null;
  return (
    `Post by ${t.author_name ?? t.author_username} (@${t.author_username}, ` +
    `${t.author_followers ?? "unknown"} followers)${ageMin != null ? `, posted ${ageMin} minutes ago` : ""}:\n\n` +
    `"""${t.text}"""`
  );
}

export type Draft = { angle: string; text: string };

// Writes 3 to 5 replies for one post. steer is an optional note from Martin ("make it funnier").
export async function writeReplies(target: any, key: string, model: string, steer = ""): Promise<Draft[]> {
  const prompt = postPrompt(target) + (steer.trim() ? `\n\nMartin's note for these replies: ${steer.trim().slice(0, 300)}` : "");
  const out = await callClaudeTool(key, model, DRAFT_SYSTEM, prompt, DRAFT_TOOL, 1500);
  const replies: Draft[] = (Array.isArray(out.replies) ? out.replies : [])
    .map((r: any) => ({
      angle: String(r.angle ?? "").toLowerCase().replace(/[^a-z ]/g, "").trim().slice(0, 20),
      text: String(r.text ?? "").replace(BANNED, "-").trim(),
    }))
    .filter((r: Draft) => r.text)
    .slice(0, 5);
  if (!replies.length) throw new Error("Claude returned no replies");
  return replies;
}

// Haiku decides, Sonnet (or the chosen model) writes. force skips the Haiku check.
export async function draftOne(target: any, key: string, draftModel: string, force = false): Promise<"ready" | "skipped" | "error"> {
  try {
    let note = target.ai_note ?? "";
    if (!force) {
      const verdict = await callClaudeTool(key, TRIAGE_MODEL, TRIAGE_SYSTEM, postPrompt(target), TRIAGE_TOOL, 400);
      note = String(verdict.note ?? "");
      if (!verdict.worth_replying) {
        await admin.from("reply_targets").update({
          status: "skipped",
          drafts: null,
          ai_note: note,
          error: null,
          attempts: (target.attempts ?? 0) + 1,
        }).eq("id", target.id);
        return "skipped";
      }
    }
    const replies = await writeReplies(target, key, draftModel);
    await admin.from("reply_targets").update({
      status: "ready",
      drafts: replies,
      ai_note: force ? (note || "You chose to reply to this one.") : note,
      error: null,
      attempts: (target.attempts ?? 0) + 1,
    }).eq("id", target.id);
    return "ready";
  } catch (e) {
    const attempts = (target.attempts ?? 0) + 1;
    await admin.from("reply_targets").update({
      status: attempts >= 3 ? "failed" : "new",
      error: (e as Error).message,
      attempts,
    }).eq("id", target.id);
    if (/API key|credit balance|model/.test((e as Error).message)) throw e; // same for every post, stop the run
    return "error";
  }
}

// ---------- Telegram ----------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function hmac(secret: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return Array.from(sig.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signLink(secret: string, targetId: string, draft: number): Promise<string> {
  return await hmac(secret, `${targetId}:${draft}`);
}

export async function telegram(token: string, method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!out.ok) throw new Error(`Telegram: ${out.description ?? res.status}`);
  return out.result;
}

function compact(n: number | null | undefined): string {
  if (n == null) return "?";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export async function notifyReady(t: any, notify: any): Promise<void> {
  const drafts: { angle: string; text: string }[] = t.drafts ?? [];
  const lines = [
    `<b>${esc(t.author_name ?? t.author_username)}</b> (@${esc(t.author_username)}, ${compact(t.author_followers)}) just posted:`,
    "",
    `<blockquote>${esc(t.text.length > 700 ? t.text.slice(0, 700) + "…" : t.text)}</blockquote>`,
    "",
    ...drafts.map((d, i) => `<b>${i + 1}. ${esc(d.angle || "reply")}</b>\n${esc(d.text)}`),
    "",
    "Tap a number to open X with that reply filled in.",
  ];
  const buttons = await Promise.all(
    drafts.map(async (_d, i) => ({
      text: `Reply ${i + 1}`,
      url: `${FN_BASE}/reply-go?t=${t.id}&d=${i}&s=${await signLink(notify.link_secret, t.id, i)}`,
    })),
  );
  await telegram(notify.telegram_token, "sendMessage", {
    chat_id: notify.telegram_chat_id,
    text: lines.join("\n"),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        ...[buttons.slice(0, 3), buttons.slice(3)].filter((row) => row.length),
        [{ text: "Open post", url: `https://x.com/${t.author_username}/status/${t.tweet_id}` }],
      ],
    },
  });
  await admin.from("reply_targets").update({ notified_at: new Date().toISOString() }).eq("id", t.id);
}

// ---------- one tracker run ----------

async function takeLock(): Promise<boolean> {
  const stale = new Date(Date.now() - 100_000).toISOString();
  const { data } = await admin.from("app_settings")
    .update({ watcher_lock: new Date().toISOString() })
    .eq("id", true)
    .or(`watcher_lock.is.null,watcher_lock.lt.${stale}`)
    .select("id");
  return !!data?.length;
}

async function releaseLock() {
  await admin.from("app_settings").update({ watcher_lock: null }).eq("id", true);
}

export async function runWatch(): Promise<string> {
  const { data: creds } = await admin.from("x_credentials").select("*").eq("id", true).maybeSingle();
  const { data: settings } = await admin.from("app_settings").select("*").eq("id", true).maybeSingle();
  if (!creds) return "X not connected.";
  if (settings && settings.watcher_enabled === false) return "Paused.";
  if (!(await takeLock())) return "Previous check still running.";

  try {
    const { data: ai } = await admin.from("ai_credentials").select("anthropic_key").eq("id", true).maybeSingle();
    const { data: notify } = await admin.from("notify_credentials").select("*").eq("id", true).maybeSingle();
    const parts: string[] = [];

    // 0. Look up handles added without an X user id
    const { data: unresolved } = await admin.from("watch_accounts").select("id, username").is("x_user_id", null).eq("active", true);
    if (unresolved?.length) {
      try {
        const { found } = await lookupUsers(unresolved.map((u: any) => u.username), creds as XCreds);
        for (const row of unresolved) {
          const u = found.find((f) => f.username.toLowerCase() === row.username.toLowerCase());
          await admin.from("watch_accounts").update(
            u
              ? { x_user_id: u.id, username: u.username, name: u.name, followers: u.followers, last_error: null }
              : { active: false, last_error: "Handle not found on X" },
          ).eq("id", row.id);
        }
      } catch (e) {
        parts.push(`lookup failed: ${(e as Error).message}`);
      }
    }

    // 1. Fetch new posts from every account in parallel
    const { data: accounts } = await admin.from("watch_accounts").select("*").eq("active", true).not("x_user_id", "is", null);
    const cutoff = Date.now() - MAX_AGE_HOURS * 3600_000;
    const results = await Promise.all((accounts ?? []).map(async (acc: any) => {
      try {
        const posts = await newPostsFor(acc, creds as XCreds);
        const fresh = posts.filter((p: any) => new Date(p.created_at).getTime() > cutoff);
        if (fresh.length) {
          await admin.from("reply_targets").upsert(fresh.map((p: any) => ({
            account_id: acc.id,
            tweet_id: p.id,
            author_username: acc.username,
            author_name: acc.name,
            author_followers: acc.followers,
            text: p.text,
            posted_at: p.created_at,
            metrics: p.public_metrics ?? null,
          })), { onConflict: "tweet_id", ignoreDuplicates: true });
        }
        const newest = posts.reduce((m: string | null, p: any) => (!m || BigInt(p.id) > BigInt(m) ? p.id : m), acc.since_id);
        await admin.from("watch_accounts").update({
          since_id: newest,
          last_checked_at: new Date().toISOString(),
          last_error: null,
        }).eq("id", acc.id);
        return { fetched: fresh.length, error: null as string | null };
      } catch (e) {
        await admin.from("watch_accounts").update({
          last_checked_at: new Date().toISOString(),
          last_error: (e as Error).message,
        }).eq("id", acc.id);
        return { fetched: 0, error: (e as Error).message };
      }
    }));
    const fetched = results.reduce((s, r) => s + r.fetched, 0);
    const errors = results.filter((r) => r.error);
    parts.push(`${fetched} new post${fetched === 1 ? "" : "s"} from ${(accounts ?? []).length} accounts`);
    if (errors.length) parts.push(errors.find((e) => /credits/.test(e.error!))?.error ?? `${errors.length} account errors`);

    // 2. Haiku checks, Sonnet drafts, Telegram pings
    if (!ai?.anthropic_key) {
      parts.push("add a Claude API key to get drafts");
    } else {
      const { data: queue } = await admin.from("reply_targets").select("*")
        .eq("status", "new").gte("posted_at", new Date(cutoff).toISOString())
        .order("posted_at", { ascending: false }).limit(DRAFTS_PER_RUN);
      let ready = 0;
      let skipped = 0;
      try {
        for (const t of queue ?? []) {
          const r = await draftOne(t, ai.anthropic_key, settings?.ai_model ?? "claude-sonnet-5-5");
          if (r === "skipped") skipped++;
          if (r === "ready") {
            ready++;
            if (notify) {
              const { data: fresh } = await admin.from("reply_targets").select("*").eq("id", t.id).single();
              try {
                await notifyReady(fresh, notify);
              } catch (e) {
                parts.push((e as Error).message);
              }
            }
          }
        }
      } catch (e) {
        parts.push((e as Error).message);
      }
      if (ready || skipped) parts.push(`${ready} ready, ${skipped} skipped`);
    }

    // 3. Old unanswered posts drop out of the feed
    await admin.from("reply_targets").update({ status: "dismissed" })
      .in("status", ["new", "ready"]).lt("posted_at", new Date(Date.now() - 36 * 3600_000).toISOString());

    const msg = parts.join(", ");
    const result = msg.charAt(0).toUpperCase() + msg.slice(1) + ".";
    await admin.from("app_settings").update({
      watcher_last_run: new Date().toISOString(),
      watcher_last_result: result,
    }).eq("id", true);
    return result;
  } finally {
    await releaseLock();
  }
}
