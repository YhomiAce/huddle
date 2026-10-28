import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Socket } from "socket.io-client";
import { request } from "../socket.ts";

interface Props {
  socket: Socket | null;
  channelId: string;
  placeholder: string;
  onError: (message: string) => void;
}

const TYPING_IDLE_MS = 3_000;

/** Message input: Enter sends, Shift+Enter adds a line. Emits debounced typing events. */
export function Composer({ socket, channelId, placeholder, onError }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const typingRef = useRef(false);
  const idleTimer = useRef<number | undefined>(undefined);

  const stopTyping = () => {
    window.clearTimeout(idleTimer.current);
    if (typingRef.current) {
      typingRef.current = false;
      socket?.emit("typing", { channelId, isTyping: false });
    }
  };

  // Stop the indicator when switching channels or unmounting.
  useEffect(() => stopTyping, [channelId, socket]);

  function onChange(value: string) {
    setText(value);
    if (!socket) return;
    if (!value.trim()) {
      stopTyping();
      return;
    }
    if (!typingRef.current) {
      typingRef.current = true;
      socket.emit("typing", { channelId, isTyping: true });
    }
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  async function send() {
    const body = text.trim();
    if (!body || !socket || sending) return;
    setSending(true);
    stopTyping();
    try {
      await request(socket, "message:send", { channelId, body });
      setText("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Message not sent.");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        rows={1}
        maxLength={4000}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button className="primary" onClick={() => void send()} disabled={!text.trim() || !socket || sending}>
        Send
      </button>
      <div className="hint">
        <b>**bold**</b> <i>*italic*</i> <code>`code`</code> ~~strike~~ [link](https://…) · Shift+Enter for a new line
      </div>
    </div>
  );
}
