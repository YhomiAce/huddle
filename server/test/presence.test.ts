import { describe, expect, it } from "vitest";
import { summarize } from "../src/realtime/presence.js";

describe("presence summarize", () => {
  const now = 1_000_000;
  it("is online if any live socket is online", () => {
    expect(summarize([`away:${now + 1}`, `online:${now + 1}`], now)).toBe("online");
  });
  it("is away when every live socket is away", () => {
    expect(summarize([`away:${now + 1}`, `online:${now - 1}`], now)).toBe("away");
  });
  it("is offline when entries expired", () => {
    expect(summarize([`online:${now - 1}`], now)).toBe("offline");
    expect(summarize([], now)).toBe("offline");
  });
});
