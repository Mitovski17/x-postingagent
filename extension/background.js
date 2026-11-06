// Talks to the X Queue backend. The key lives in config.js on this computer only.
importScripts("config.js");

const ENDPOINT = "https://xssvfmbkgpchmfimjhdf.supabase.co/functions/v1/ext-draft";

async function call(body) {
  const cfg = self.XQ_CONFIG || {};
  if (!cfg.key) return { error: "Extension key missing. Ask Claude to set up config.js." };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ext-key": cfg.key },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `Server error ${res.status}` };
    return data;
  } catch (e) {
    return { error: "Couldn't reach the server. Check your connection." };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "xq") {
    call(msg.body).then(reply);
    return true; // keep the channel open for the async reply
  }
});
