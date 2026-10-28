import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import type { DirectoryUser, SearchHit, SelfUser } from "../types.ts";
import { Avatar } from "./Avatar.tsx";

interface Props {
  me: SelfUser;
  users: Record<string, DirectoryUser>;
  onClose: () => void;
  onOpen: (channelId: string) => void;
}

/** Full-text search across the channels you're in. */
export function SearchPanel({ me, users, onClose, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResults((await api.search(query)).results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  function where(hit: SearchHit): string {
    if (hit.channelKind === "public") return `#${hit.channelName ?? ""}`;
    return hit.author.id === me.id ? "Direct message" : `DM with ${hit.author.displayName}`;
  }

  return (
    <aside className="search-panel" aria-label="Search">
      <header>
        <form onSubmit={submit}>
          <input autoFocus type="search" placeholder="Search messages" value={query} onChange={(e) => setQuery(e.target.value)} />
        </form>
        <button className="icon" onClick={onClose} aria-label="Close search">
          ×
        </button>
      </header>
      <div className="search-results">
        {busy && <p className="muted">Searching…</p>}
        {error && <p className="form-error">{error}</p>}
        {results && results.length === 0 && <p className="muted">No messages match “{query}”.</p>}
        {results?.map((hit) => {
          const author = users[hit.author.id] ?? hit.author;
          return (
            <button key={hit.id} className="search-hit" onClick={() => onOpen(hit.channelId)}>
              <div className="search-where">
                {where(hit)} · {new Date(hit.createdAt).toLocaleString()}
              </div>
              <div className="search-body">
                <Avatar name={author.displayName} color={author.avatarColor} size={24} />
                <div>
                  <strong>{author.displayName}</strong>
                  <div dangerouslySetInnerHTML={{ __html: hit.html }} />
                </div>
              </div>
            </button>
          );
        })}
        {!results && !busy && (
          <p className="muted">
            Try <code>deploy</code>, <code>"redis adapter"</code> or <code>pagination -cursor</code>.
          </p>
        )}
      </div>
    </aside>
  );
}
