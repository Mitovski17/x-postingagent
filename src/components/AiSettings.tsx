import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Settings } from "../lib/types";
import { invoke } from "../lib/data";
import { useToast } from "./Toast";

const MODELS = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Best balance of quality and cost (recommended)" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Cheapest, simpler replies" },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Sharpest replies, several times the cost" },
];

// Claude API key and model for reply drafts. The key is stored server-side only.
export function AiSettings({ settings, refresh }: { settings: Settings | null; refresh: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const connected = !!settings?.ai_connected && !editing;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await invoke("watch-admin", { action: "save_ai_key", key });
      setKey("");
      setEditing(false);
      toast("Claude connected. Drafts start on the next check.");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirmRemove) return setConfirmRemove(true);
    setConfirmRemove(false);
    try {
      await invoke("watch-admin", { action: "remove_ai_key" });
      toast("Claude key deleted");
      refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function setModel(model: string) {
    try {
      await invoke("watch-admin", { action: "set_model", model });
      toast(`Drafts now use ${MODELS.find((m) => m.id === model)?.label}`);
      refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function togglePause(on: boolean) {
    const { error: e } = await supabase.from("app_settings").update({ watcher_enabled: on }).eq("id", true);
    if (e) toast(e.message);
    else {
      toast(on ? "Reply tracker on" : "Reply tracker paused. No X reads, no cost.");
      refresh();
    }
  }

  return (
    <>
      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Claude for reply drafts</h2>
            <p className="muted small">
              Haiku reads every new post and picks the ones worth replying to. The model you choose below writes the
              replies for those. Get a key at{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                console.anthropic.com
              </a>
              . It's checked with Claude, stored in your database and never shown again.
            </p>
          </div>
          {connected && <span className="pill pill--posted">Connected</span>}
        </div>

        {connected ? (
          <div className="ai-row">
            <span className="field__label">Writes replies</span>
            <div className="chips" role="radiogroup" aria-label="Model">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={settings?.ai_model === m.id}
                  className={`chip${settings?.ai_model === m.id ? " is-active" : ""}`}
                  onClick={() => setModel(m.id)}
                  title={m.hint}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span className="muted small">{MODELS.find((m) => m.id === settings?.ai_model)?.hint}</span>
            <div className="connected__actions">
              <button className="btn" onClick={() => setEditing(true)}>
                Replace key
              </button>
              <button className={`btn btn--ghost${confirmRemove ? " btn--confirm" : ""}`} onClick={remove}>
                {confirmRemove ? "Click again to delete" : "Delete key"}
              </button>
            </div>
          </div>
        ) : (
          <form className="keys" onSubmit={save}>
            <label className="field">
              <span className="field__label">Anthropic API key</span>
              <input
                className="input mono"
                type={reveal ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            {error && (
              <p className="notice notice--error small" role="alert">
                {error}
              </p>
            )}
            <div className="keys__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setReveal(!reveal)}>
                {reveal ? <EyeOff size={15} strokeWidth={1.75} aria-hidden /> : <Eye size={15} strokeWidth={1.75} aria-hidden />}
                {reveal ? "Hide" : "Show"} key
              </button>
              <div className="split split--auto">
                {editing && (
                  <button type="button" className="btn" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                )}
                <button className="btn btn--primary" disabled={busy}>
                  {busy ? "Checking with Claude…" : "Connect"}
                </button>
              </div>
            </div>
          </form>
        )}
      </section>


      <TelegramCard settings={settings} refresh={refresh} />

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Reply tracker</h2>
            <p className="muted small">
              Checks your watchlist every 2 minutes inside Supabase. Checks that find nothing new cost nothing. Pause it to
              stop all X reads.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={settings?.watcher_enabled !== false}
              onChange={(e) => togglePause(e.target.checked)}
              aria-label="Reply tracker on"
            />
            <span className="switch__track" aria-hidden />
          </label>
        </div>
      </section>
    </>
  );
}

function TelegramCard({ settings, refresh }: { settings: Settings | null; refresh: () => void }) {
  const toast = useToast();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const connected = !!settings?.telegram_connected;

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await invoke<{ bot: string }>("watch-admin", { action: "save_telegram", token });
      setToken("");
      toast(`Connected to @${r.bot}. Check Telegram.`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    try {
      const r = await invoke<{ sample: boolean }>("watch-admin", { action: "test_telegram" });
      toast(r.sample ? "Sent your latest ready post to Telegram" : "Test message sent");
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirmRemove) return setConfirmRemove(true);
    setConfirmRemove(false);
    try {
      await invoke("watch-admin", { action: "remove_telegram" });
      toast("Telegram alerts off");
      refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Telegram alerts</h2>
          <p className="muted small">
            Get a message the moment a watched account posts something worth replying to, with the replies as buttons.
            Tap one and X opens with it filled in.
          </p>
        </div>
        {connected && <span className="pill pill--posted">Connected</span>}
      </div>
      {connected ? (
        <div className="ai-row">
          <span className="muted small">Sending to @{settings?.telegram_bot}</span>
          <div className="connected__actions">
            <button className="btn" onClick={test} disabled={busy}>
              Send test
            </button>
            <button className={`btn btn--ghost${confirmRemove ? " btn--confirm" : ""}`} onClick={remove}>
              {confirmRemove ? "Click again to turn off" : "Turn off"}
            </button>
          </div>
        </div>
      ) : (
        <form className="keys" onSubmit={connect}>
          <ol className="steps">
            <li>
              <span>
                In Telegram, open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, send{" "}
                <code>/newbot</code>, pick any name, and copy the token it gives you.
              </span>
            </li>
            <li>
              <span>Open your new bot from BotFather's message and press <strong>Start</strong>.</span>
            </li>
            <li>
              <span>Paste the token here and click Connect.</span>
            </li>
          </ol>
          <label className="field">
            <span className="field__label">Bot token</span>
            <input
              className="input mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="123456789:AA…"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          {error && (
            <p className="notice notice--error small" role="alert">
              {error}
            </p>
          )}
          <div className="keys__actions">
            <span />
            <button className="btn btn--primary" disabled={busy}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
