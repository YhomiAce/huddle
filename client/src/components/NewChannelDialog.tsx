import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { Dialog } from "./Dialog.tsx";

interface Props {
  onClose: () => void;
  onCreated: (channelId: string) => Promise<void>;
}

/** Create a public channel. */
export function NewChannelDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const { channel } = await api.createChannel(name, topic);
      await onCreated(channel.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the channel.");
    }
  }

  return (
    <Dialog title="Create a channel" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label>
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. design-reviews" required />
        </label>
        <label>
          Topic <span className="muted">(optional)</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={250} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}
