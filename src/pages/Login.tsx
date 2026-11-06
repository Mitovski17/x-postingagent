import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export function Login({ deniedEmail }: { deniedEmail?: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  if (deniedEmail) {
    return (
      <div className="auth">
        <div className="auth__card">
          <h1 className="auth__title">No access</h1>
          <p className="muted">
            You're signed in as <strong>{deniedEmail}</strong>, but this dashboard only opens for the owner account.
            If that's you, confirm your email first using the link Supabase sent.
          </p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ kind: "error", text: error.message });
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) setMsg({ kind: "error", text: error.message });
      else if (!data.session) {
        setMsg({ kind: "info", text: "Check your inbox and click the confirmation link, then sign in here." });
        setMode("signin");
      }
    }
    setBusy(false);
  }

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit}>
        <div className="auth__brand">
          <span className="brand__mark" aria-hidden>
            <svg viewBox="0 0 16 16" width="12" height="12">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
          X Queue
        </div>
        <h1 className="auth__title">{mode === "signin" ? "Sign in" : "Create the owner account"}</h1>

        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "signup" && <span className="field__help">At least 8 characters.</span>}
        </label>

        {msg && (
          <p className={msg.kind === "error" ? "notice notice--error" : "notice"} role="alert">
            {msg.text}
          </p>
        )}

        <button className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setMsg(null);
          }}
        >
          {mode === "signin" ? "First time here? Create the owner account" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
