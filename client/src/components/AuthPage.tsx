import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import type { AppConfig, SelfUser } from "../types.ts";

interface Props {
  config: AppConfig;
  onSignedIn: (user: SelfUser) => void;
}

/** Sign-in / sign-up screen. Shows the demo accounts when the server runs in demo mode. */
export function AuthPage({ config, onSignedIn }: Props) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } =
        mode === "login" ? await api.login(email, password) : await api.signup(email, password, displayName);
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <span>Huddle</span>
        </div>
        <h1>{mode === "login" ? "Sign in to your workspace" : "Create your account"}</h1>
        {mode === "signup" && (
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={60} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "signup" ? 8 : 1}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Sign up"}
        </button>
        <p className="switch">
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button type="button" className="link" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
        {config.demoCredentials && (
          <div className="demo">
            <strong>Demo accounts</strong> (password <code>{config.demoCredentials.password}</code>)
            <div className="demo-buttons">
              {config.demoCredentials.emails.map((demoEmail) => (
                <button
                  key={demoEmail}
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setEmail(demoEmail);
                    setPassword(config.demoCredentials?.password ?? "");
                  }}
                >
                  {demoEmail}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </main>
  );
}
