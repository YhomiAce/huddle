import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { AVATAR_COLORS, type SelfUser } from "../types.ts";
import { Avatar } from "./Avatar.tsx";
import { Dialog } from "./Dialog.tsx";

interface Props {
  me: SelfUser;
  onClose: () => void;
  onSaved: (user: SelfUser) => void;
  onSignOut: () => Promise<void>;
}

/** Edit display name and avatar colour, or sign out. */
export function ProfileDialog({ me, onClose, onSaved, onSignOut }: Props) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [avatarColor, setAvatarColor] = useState(me.avatarColor);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      onSaved((await api.updateProfile({ displayName, avatarColor })).user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your profile.");
    }
  }

  return (
    <Dialog title="Your profile" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <div className="profile-preview">
          <Avatar name={displayName || "?"} color={avatarColor} size={56} />
          <div>
            <strong>{displayName || "…"}</strong>
            <div className="muted">{me.email}</div>
          </div>
        </div>
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} required />
        </label>
        <fieldset className="colors">
          <legend>Avatar colour</legend>
          {AVATAR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch${color === avatarColor ? " selected" : ""}`}
              style={{ background: color }}
              onClick={() => setAvatarColor(color)}
              aria-label={`Colour ${color}`}
              aria-pressed={color === avatarColor}
            />
          ))}
        </fieldset>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="danger" onClick={() => void onSignOut()}>
            Sign out
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
