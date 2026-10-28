import { useEffect, useState } from "react";
import { api, ApiError } from "./api.ts";
import type { AppConfig, SelfUser } from "./types.ts";
import { AuthPage } from "./components/AuthPage.tsx";
import { ChatApp } from "./components/ChatApp.tsx";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; config: AppConfig; user: SelfUser | null };

/** Root component: loads config and the current session, then shows login or chat. */
export function App() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await api.config();
        const user = await api
          .me()
          .then((r) => r.user)
          .catch((err: unknown) => {
            if (err instanceof ApiError && err.status === 401) return null;
            throw err;
          });
        if (!cancelled) setState({ phase: "ready", config, user });
      } catch (err) {
        if (!cancelled) setState({ phase: "error", message: err instanceof Error ? err.message : "Can't reach the server." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "loading") return <div className="splash">Loading Huddle…</div>;
  if (state.phase === "error") return <div className="splash">Huddle is unavailable: {state.message}</div>;
  if (!state.user) {
    return <AuthPage config={state.config} onSignedIn={(user) => setState({ ...state, user })} />;
  }
  return (
    <ChatApp
      me={state.user}
      onMeChange={(user) => setState({ ...state, user })}
      onSignedOut={() => setState({ ...state, user: null })}
    />
  );
}
