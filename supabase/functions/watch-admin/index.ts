// Owner actions for the reply assistant: watchlist, Claude key, model, redraft.

import { admin, corsHeaders, json, requestIsOwner } from "../_shared/supabase.ts";
import { type XCreds } from "../_shared/x.ts";
import { checkClaudeKey, draftOne, lookupUsers, notifyReady, telegram } from "../_shared/watch.ts";

const MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];

function cleanHandle(s: string): string {
  return s.trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await requestIsOwner(req))) return json({ error: "Unauthorized" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  try {
    switch (body.action) {
      case "add_accounts": {
        const handles = [...new Set(
          (Array.isArray(body.usernames) ? body.usernames : String(body.usernames ?? "").split(/[\s,]+/))
            .map(cleanHandle)
            .filter((h: string) => /^[A-Za-z0-9_]{1,15}$/.test(h)),
        )] as string[];
        if (!handles.length) return json({ error: "Enter at least one valid @handle." }, 400);
        const { data: creds } = await admin.from("x_credentials").select("*").eq("id", true).maybeSingle();
        if (!creds) return json({ error: "Connect X in Settings first." }, 400);
        const { found, missing } = await lookupUsers(handles, creds as XCreds);
        for (const u of found) {
          const row = { username: u.username, x_user_id: u.id, name: u.name, followers: u.followers, active: true, last_error: null };
          const { data: existing } = await admin.from("watch_accounts").select("id")
            .or(`x_user_id.eq.${u.id},username.ilike.${u.username}`).limit(1).maybeSingle();
          const { error } = existing
            ? await admin.from("watch_accounts").update(row).eq("id", existing.id)
            : await admin.from("watch_accounts").insert({ ...row, category: body.category ?? null });
          if (error) return json({ error: error.message }, 500);
        }
        return json({ ok: true, added: found.map((u) => u.username), missing });
      }

      case "remove_account": {
        await admin.from("watch_accounts").delete().eq("id", body.id);
        return json({ ok: true });
      }

      case "save_ai_key": {
        const key = String(body.key ?? "").trim();
        if (!key.startsWith("sk-ant-")) return json({ error: "That doesn't look like an Anthropic API key (it starts with sk-ant-)." }, 400);
        await checkClaudeKey(key); // throws a clear error if the key is bad
        await admin.from("ai_credentials").upsert({ id: true, anthropic_key: key });
        await admin.from("app_settings").update({ ai_connected: true }).eq("id", true);
        return json({ ok: true });
      }

      case "remove_ai_key": {
        await admin.from("ai_credentials").delete().eq("id", true);
        await admin.from("app_settings").update({ ai_connected: false }).eq("id", true);
        return json({ ok: true });
      }

      case "set_model": {
        if (!MODELS.includes(body.model)) return json({ error: "Unknown model" }, 400);
        await admin.from("app_settings").update({ ai_model: body.model }).eq("id", true);
        return json({ ok: true });
      }

      case "save_telegram": {
        const token = String(body.token ?? "").trim();
        if (!/^\d+:[\w-]{30,}$/.test(token)) return json({ error: "That doesn't look like a bot token from @BotFather (like 123456:ABC...)." }, 400);
        const me = await telegram(token, "getMe", {});
        const updates = await telegram(token, "getUpdates", { limit: 50, timeout: 0 });
        const chat = [...(updates ?? [])].reverse().map((u: any) => u.message?.chat ?? u.my_chat_member?.chat).find((c: any) => c?.type === "private");
        if (!chat) return json({ error: `Open Telegram, find @${me.username}, press Start (or send any message), then click Connect again.` }, 400);
        const { data: old } = await admin.from("notify_credentials").select("link_secret").eq("id", true).maybeSingle();
        await admin.from("notify_credentials").upsert({
          id: true,
          telegram_token: token,
          telegram_chat_id: String(chat.id),
          bot_username: me.username,
          ...(old ? { link_secret: old.link_secret } : {}),
        });
        await admin.from("app_settings").update({ telegram_connected: true, telegram_bot: me.username }).eq("id", true);
        await telegram(token, "sendMessage", {
          chat_id: chat.id,
          text: "Connected. I'll message you here when someone on your watchlist posts something worth replying to, with the replies ready to tap.",
        });
        return json({ ok: true, bot: me.username });
      }

      case "test_telegram": {
        const { data: n } = await admin.from("notify_credentials").select("*").eq("id", true).maybeSingle();
        if (!n) return json({ error: "Connect Telegram first." }, 400);
        const { data: t } = await admin.from("reply_targets").select("*").eq("status", "ready")
          .order("posted_at", { ascending: false }).limit(1).maybeSingle();
        if (t) await notifyReady(t, n);
        else await telegram(n.telegram_token, "sendMessage", { chat_id: n.telegram_chat_id, text: "Test message. Alerts are working." });
        return json({ ok: true, sample: !!t });
      }

      case "remove_telegram": {
        await admin.from("notify_credentials").delete().eq("id", true);
        await admin.from("app_settings").update({ telegram_connected: false, telegram_bot: null }).eq("id", true);
        return json({ ok: true });
      }

      case "redraft": {
        const { data: ai } = await admin.from("ai_credentials").select("anthropic_key").eq("id", true).maybeSingle();
        if (!ai) return json({ error: "Add a Claude API key in Settings first." }, 400);
        const { data: s } = await admin.from("app_settings").select("ai_model").eq("id", true).maybeSingle();
        const { data: t } = await admin.from("reply_targets").select("*").eq("id", body.id).maybeSingle();
        if (!t) return json({ error: "Post not found" }, 404);
        const r = await draftOne({ ...t, attempts: 0 }, ai.anthropic_key, s?.ai_model ?? MODELS[0], !!body.force);
        if (r === "error") {
          const { data: after } = await admin.from("reply_targets").select("error").eq("id", body.id).single();
          return json({ error: after?.error ?? "Drafting failed" }, 500);
        }
        return json({ ok: true, status: r });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
