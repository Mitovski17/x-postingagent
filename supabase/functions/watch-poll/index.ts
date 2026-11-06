// Checks watched accounts for new posts and drafts replies.
// Called every 10 minutes by pg_cron (x-cron-secret) or by "Check now" (owner session).

import { admin, corsHeaders, json, requestIsOwner } from "../_shared/supabase.ts";
import { runWatch } from "../_shared/watch.ts";

async function authorized(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const { data } = await admin.rpc("verify_cron_secret", { secret });
    if (data === true) return true;
  }
  return await requestIsOwner(req);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await authorized(req))) return json({ error: "Unauthorized" }, 401);
  try {
    return json({ ok: true, message: await runWatch() });
  } catch (e) {
    const msg = (e as Error).message;
    await admin.from("app_settings").update({
      watcher_last_run: new Date().toISOString(),
      watcher_last_result: `Error: ${msg}`,
    }).eq("id", true);
    return json({ error: msg }, 500);
  }
});
