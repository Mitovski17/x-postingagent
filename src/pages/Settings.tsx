import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LogOut } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Settings as S } from "../lib/types";
import { invoke, useNow } from "../lib/data";
import { fullDate, relative, TIMEZONE } from "../lib/time";
import { useToast } from "../components/Toast";
import { publisherHealthy } from "../components/Shell";
import { AiSettings } from "../components/AiSettings";

const FIELDS = [
  { key: "api_key", label: "API Key", help: "Also called Consumer Key" },
  { key: "api_secret", label: "API Key Secret", help: "Also called Consumer Secret" },
  { key: "access_token", label: "Access Token", help: "Starts with numbers and a dash" },
  { key: "access_token_secret", label: "Access Token Secret", help: "" },
] as const;

type Keys = Record<(typeof FIELDS)[number]["key"], string>;

export function Settings({ settings, session, refresh }: { settings: S | null; session: Session; refresh: () => void }) {
  const toast = useToast();
  const now = useNow(10_000);
  const [keys, setKeys] = useState<Keys>({ api_key: "", api_secret: "", access_token: "", access_token_secret: "" });
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [editing, setEditing] = useState(false);

  const connected = !!settings?.x_username && !editing;
  const healthy = publisherHealthy(settings, now);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await invoke<{ username: string }>("x-connect", { action: "save", ...keys });
      setKeys({ api_key: "", api_secret: "", access_token: "", access_token_secret: "" });
      setEditing(false);
      toast(`Connected as @${r.username}`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function disconnect() {
    if (!confirmDisconnect) return setConfirmDisconnect(true);
    setBusy(true);
    try {
      await invoke("x-connect", { action: "disconnect" });
      toast("X disconnected. Keys deleted.");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setConfirmDisconnect(false);
    setBusy(false);
  }

  async function toggleLong(v: boolean) {
    const { error: e } = await supabase.from("app_settings").update({ long_posts: v }).eq("id", true);
    if (e) toast(e.message);
    else {
      toast(v ? "Long posts on (up to 25,000 characters)" : "Long posts off (280 characters)");
      refresh();
    }
  }

  return (
    <div className="page page--narrow">
      <header className="page__head">
        <div>
          <h1 className="page__title">Settings</h1>
          <p className="page__sub">Your X connection, posting limits and publisher status</p>
        </div>
      </header>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">X account</h2>
            <p className="muted small">Keys go straight to your Supabase database and are never shown again.</p>
          </div>
          {connected && <span className="pill pill--posted">Connected</span>}
        </div>

        {connected ? (
          <div className="connected">
            <span className="avatar avatar--lg">{(settings?.x_name ?? "X").charAt(0).toUpperCase()}</span>
            <div className="connected__who">
              <strong>{settings?.x_name}</strong>
              <a className="muted" href={`https://x.com/${settings?.x_username}`} target="_blank" rel="noreferrer">
                @{settings?.x_username}
              </a>
              {settings?.x_connected_at && <span className="muted small">Since {fullDate(settings.x_connected_at)}</span>}
            </div>
            <div className="connected__actions">
              <button className="btn" onClick={() => setEditing(true)}>
                Replace keys
              </button>
              <button className={`btn btn--ghost${confirmDisconnect ? " btn--confirm" : ""}`} disabled={busy} onClick={disconnect}>
                {confirmDisconnect ? "Click again to disconnect" : "Disconnect"}
              </button>
            </div>
          </div>
        ) : (
          <form className="keys" onSubmit={connect}>
            <ol className="steps">
              <li>
                <span>In the <a href="https://console.x.com" target="_blank" rel="noreferrer">X developer console</a>, open
                your app's <strong>User authentication settings</strong> and set permissions to <strong>Read and write</strong>.</span>
              </li>
              <li>
                <span>Under <strong>Keys and tokens</strong>, generate the API Key and Secret, then the Access Token and
                Secret. Generate the access token <em>after</em> setting Read and write, or it stays read-only.</span>
              </li>
              <li><span>Add prepaid credits. Each post costs about $0.015 on X's pay-per-use API.</span></li>
            </ol>

            <div className="keys__grid">
              {FIELDS.map((f) => (
                <label key={f.key} className="field">
                  <span className="field__label">{f.label}</span>
                  <input
                    className="input mono"
                    type={reveal ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    required
                    value={keys[f.key]}
                    onChange={(e) => setKeys({ ...keys, [f.key]: e.target.value })}
                  />
                  {f.help && <span className="field__help">{f.help}</span>}
                </label>
              ))}
            </div>

            {error && (
              <p className="notice notice--error small" role="alert">
                {error}
              </p>
            )}

            <div className="keys__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setReveal(!reveal)}>
                {reveal ? <EyeOff size={15} strokeWidth={1.75} aria-hidden /> : <Eye size={15} strokeWidth={1.75} aria-hidden />}
                {reveal ? "Hide" : "Show"} keys
              </button>
              <div className="split split--auto">
                {editing && (
                  <button type="button" className="btn" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                )}
                <button className="btn btn--primary" disabled={busy}>
                  {busy ? "Checking with X…" : "Connect"}
                </button>
              </div>
            </div>
          </form>
        )}
      </section>

      <AiSettings settings={settings} refresh={refresh} />

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Long posts</h2>
            <p className="muted small">
              Lets a post run up to 25,000 characters. Only turn this on if the X account has Plus, or X rejects
              anything over 280.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={!!settings?.long_posts}
              onChange={(e) => toggleLong(e.target.checked)}
              aria-label="Allow long posts"
            />
            <span className="switch__track" aria-hidden />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Publisher</h2>
            <p className="muted small">
              Runs every minute inside Supabase and posts anything that's due. Your computer can be off.
            </p>
          </div>
          <span className={`pill ${healthy ? "pill--posted" : "pill--failed"}`}>{healthy ? "Running" : "Not running"}</span>
        </div>
        <dl className="facts">
          <div>
            <dt>Last run</dt>
            <dd className="mono">{settings?.publisher_last_run ? relative(settings.publisher_last_run, now) : "Never"}</dd>
          </div>
          <div>
            <dt>Result</dt>
            <dd>{settings?.publisher_last_result ?? "—"}</dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd>{TIMEZONE.replace("_", " ")}</dd>
          </div>
        </dl>
        {!healthy && settings?.publisher_last_run && (
          <p className="notice small">
            The publisher hasn't checked in for a few minutes. If your Supabase project was paused for inactivity,
            restore it from the Supabase dashboard.
          </p>
        )}
      </section>

      <section className="card card--row">
        <div>
          <h2 className="card__title">Signed in</h2>
          <p className="muted small">{session.user.email}</p>
        </div>
        <button className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>
          <LogOut size={15} strokeWidth={1.75} aria-hidden />
          Sign out
        </button>
      </section>
    </div>
  );
}
