// Saves or removes the X API keys. Owner session required.
// Keys are checked against X before they are stored, and are never sent back.

import { admin, corsHeaders, json, requestIsOwner } from "../_shared/supabase.ts";
import { getMe, XError, type XCreds } from "../_shared/x.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await requestIsOwner(req))) return json({ error: "Unauthorized" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  if (body.action === "disconnect") {
    await admin.from("x_credentials").delete().eq("id", true);
    await admin
      .from("app_settings")
      .update({ x_username: null, x_name: null, x_connected_at: null })
      .eq("id", true);
    return json({ ok: true });
  }

  if (body.action === "save") {
    const creds: XCreds = {
      api_key: String(body.api_key ?? "").trim(),
      api_secret: String(body.api_secret ?? "").trim(),
      access_token: String(body.access_token ?? "").trim(),
      access_token_secret: String(body.access_token_secret ?? "").trim(),
    };
    if (Object.values(creds).some((v) => !v)) {
      return json({ error: "All four keys are required." }, 400);
    }

    let me;
    try {
      me = await getMe(creds);
    } catch (e) {
      const msg = e instanceof XError ? e.message : (e as Error).message;
      return json({ error: msg }, 400);
    }

    const { error } = await admin.from("x_credentials").upsert({ id: true, ...creds });
    if (error) return json({ error: error.message }, 500);

    await admin
      .from("app_settings")
      .update({ x_username: me.username, x_name: me.name, x_connected_at: new Date().toISOString() })
      .eq("id", true);

    return json({ ok: true, username: me.username, name: me.name });
  }

  return json({ error: "Unknown action" }, 400);
});
