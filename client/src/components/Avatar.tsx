import type { PresenceStatus } from "../types.ts";

interface Props {
  name: string;
  color: string;
  size?: number;
  status?: PresenceStatus;
}

/** Coloured initials avatar with an optional presence dot. */
export function Avatar({ name, color, size = 36, status }: Props) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.4 }} aria-hidden="true">
      {initials || "?"}
      {status && <span className={`presence-dot ${status}`} />}
    </span>
  );
}

/** Small presence indicator used in lists. */
export function PresenceDot({ status }: { status: PresenceStatus }) {
  return <span className={`presence-dot inline ${status}`} title={status} aria-label={status} />;
}
