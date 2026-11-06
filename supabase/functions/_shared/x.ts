// Minimal X API v2 client using OAuth 1.0a user context.
// OAuth 1.0a access tokens generated in the X developer console do not expire,
// so there is no refresh flow to break.

export type XCreds = {
  api_key: string;
  api_secret: string;
  access_token: string;
  access_token_secret: string;
};

const API = "https://api.x.com/2";
const enc = new TextEncoder();

// RFC 3986 percent-encoding, as OAuth 1.0a requires
export function pct(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

async function hmacSha1Base64(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function oauthHeader(
  method: string,
  url: string,
  creds: XCreds,
  query: Record<string, string> = {},
  fixed?: { nonce: string; timestamp: string }, // for tests only
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.api_key,
    oauth_nonce: fixed?.nonce ?? crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fixed?.timestamp ?? Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.access_token,
    oauth_version: "1.0",
  };
  const all: Record<string, string> = { ...query, ...oauth };
  const paramString = Object.keys(all)
    .map((k) => [pct(k), pct(all[k])] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join("&");
  const key = `${pct(creds.api_secret)}&${pct(creds.access_token_secret)}`;
  const signature = await hmacSha1Base64(key, base);
  return (
    "OAuth " +
    Object.entries({ ...oauth, oauth_signature: signature })
      .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
      .join(", ")
  );
}

export class XError extends Error {
  status: number;
  transient: boolean;
  constructor(message: string, status: number, transient: boolean) {
    super(message);
    this.status = status;
    this.transient = transient;
  }
}

// Turn X's error payloads into something a human can act on.
function explain(status: number, payload: any): XError {
  const raw = [
    payload?.detail,
    payload?.title,
    payload?.errors?.[0]?.message,
    payload?.reason,
    typeof payload === "string" ? payload : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const lower = raw.toLowerCase();

  if (status === 429) {
    return new XError("X rate limit hit. It will retry automatically.", status, true);
  }
  if (status >= 500) {
    return new XError(`X is having trouble (${status}). It will retry automatically.`, status, true);
  }
  if (status === 401) {
    return new XError("X rejected the keys. Re-enter all four values in Settings.", status, false);
  }
  if (status === 402 || lower.includes("credit")) {
    return new XError("Your X API credits are empty. Top up in the X developer console.", status, false);
  }
  if (lower.includes("oauth1") || lower.includes("permission") || lower.includes("not permitted")) {
    return new XError(
      "Your X app can't post. Set app permissions to Read and write, regenerate the access token, and reconnect.",
      status,
      false,
    );
  }
  if (lower.includes("duplicate")) {
    return new XError("X blocked this as duplicate content. Change the wording and retry.", status, false);
  }
  if (lower.includes("too long") || lower.includes("length")) {
    return new XError(
      "X says this is too long. Long posts need X Plus on the account, or split it into a thread.",
      status,
      false,
    );
  }
  return new XError(raw ? `X error ${status}: ${raw}` : `X error ${status}`, status, false);
}

async function xRequest(
  method: "GET" | "POST",
  path: string,
  creds: XCreds,
  body?: unknown,
): Promise<any> {
  const url = `${API}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: await oauthHeader(method, url, creds),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new XError(`Couldn't reach X: ${(e as Error).message}`, 0, true);
  }
  const text = await res.text();
  let payload: any = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch { /* keep text */ }
  if (!res.ok) throw explain(res.status, payload);
  if (payload?.errors?.length && !payload?.data) throw explain(res.status, payload);
  return payload;
}

export async function getMe(creds: XCreds): Promise<{ id: string; username: string; name: string }> {
  const out = await xRequest("GET", "/users/me", creds);
  return out.data;
}

export async function createPost(
  creds: XCreds,
  text: string,
  replyTo?: string,
): Promise<string> {
  const body: Record<string, unknown> = { text };
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
  const out = await xRequest("POST", "/tweets", creds, body);
  return out.data.id as string;
}
