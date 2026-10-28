import { sql } from "drizzle-orm";
import argon2 from "argon2";
import type { Db } from "./client.js";
import { channelMembers, channels, messages, reactions, users, workspaces } from "./schema.js";

type Who = "ada" | "linus" | "grace";
type Where = "general" | "random" | "engineering" | "dm";

const DEMO_PASSWORD = "huddle-demo-123";

const PEOPLE: Record<Who, { email: string; displayName: string; avatarColor: string }> = {
  ada: { email: "ada@huddle.dev", displayName: "Ada Lovelace", avatarColor: "#9333ea" },
  linus: { email: "linus@huddle.dev", displayName: "Linus Torvalds", avatarColor: "#0284c7" },
  grace: { email: "grace@huddle.dev", displayName: "Grace Hopper", avatarColor: "#16a34a" },
};

const CHANNELS: Record<Exclude<Where, "dm">, string> = {
  general: "Company-wide announcements and work-based matters",
  random: "Non-work banter and water cooler conversation",
  engineering: "Builds, deploys, incidents and code review",
};

/** [channel, author, minutes ago, text, reactions?] */
const SCRIPT: Array<[Where, Who, number, string, Array<[string, Who[]]>?]> = [
  ["general", "ada", 4320, "Welcome to **Huddle**, everyone! This is our new home for team chat. 🎉", [["🎉", ["linus", "grace"]]]],
  ["general", "grace", 4310, "Finally, a chat app we host ourselves. No more 90-day history limit."],
  ["general", "linus", 4300, "As long as it doesn't need 4 GB of RAM to show a text box, I'm in."],
  ["general", "ada", 4290, "It's a single Node process plus Postgres and Redis. You can run two of them behind a proxy too."],
  ["general", "grace", 4200, "Reminder: all-hands is Thursday at 15:00. Agenda is in the shared drive."],
  ["general", "ada", 4100, "Could everyone set a display name and avatar colour? Click your name at the bottom left."],
  ["general", "linus", 4090, "Done. Blue, obviously."],
  ["random", "grace", 4000, "Fun fact: the first actual computer *bug* was a moth, found in the Mark II in 1947. 🦋", [["😂", ["ada", "linus"]]]],
  ["random", "linus", 3990, "And people still blame the hardware first."],
  ["random", "ada", 3980, "Who's up for lunch at the ramen place on Friday?"],
  ["random", "grace", 3975, "Me! 🍜"],
  ["random", "linus", 3970, "Only if they've fixed the wifi."],
  ["engineering", "linus", 3900, "Heads up: I'm bumping the base image to `node:22-alpine` today."],
  ["engineering", "ada", 3890, "Sounds good. Remember the native modules need the musl prebuilds."],
  ["engineering", "linus", 3880, "argon2 ships them, so we're fine. Checked the lockfile."],
  ["engineering", "grace", 3700, "PR for cursor pagination is up: messages now load 30 at a time as you scroll up."],
  ["engineering", "ada", 3690, "Nice. Are we paginating by id or by timestamp?"],
  ["engineering", "grace", 3685, "By id. Timestamps can collide; ids can't. The cursor is opaque so we can change it later."],
  ["engineering", "linus", 3680, "👍 ship it", [["🚀", ["grace"]]]],
  ["general", "grace", 3000, "Office will be closed Monday for the public holiday."],
  ["random", "ada", 2900, "Reading recommendation: *The Soul of a New Machine*. Still holds up."],
  ["random", "linus", 2890, "Seconded. Required reading for anyone who thinks deadlines are new."],
  ["engineering", "ada", 2800, "We had a short blip on staging around 10:40. Redis restarted after a config push."],
  ["engineering", "grace", 2795, "Did presence recover on its own?"],
  ["engineering", "ada", 2790, "Yes. Keys have a TTL and clients heartbeat every 25 seconds, so everyone came back online within a minute."],
  ["engineering", "linus", 2785, "Good. Let's write that down in the runbook."],
  ["engineering", "ada", 2780, "Runbook updated: https://example.com/runbooks/redis"],
  ["general", "ada", 2000, "Q3 planning doc is ready for comments. Please add your team's top three priorities by Wednesday."],
  ["general", "linus", 1990, "Kernel team priorities: 1. stability 2. stability 3. ~~features~~ stability."],
  ["general", "grace", 1985, "Very helpful, thank you Linus. 😄", [["😂", ["ada"]]]],
  ["random", "grace", 1900, "Anyone else's plants dying since we moved desks?"],
  ["random", "ada", 1895, "Mine is thriving. I think it likes the radiator."],
  ["random", "linus", 1890, "I replaced mine with a plastic one. Zero downtime."],
  ["engineering", "grace", 1800, "Search is live! It uses Postgres full-text search, so try `pagination` or \"redis adapter\"."],
  ["engineering", "linus", 1795, "Tried it. Fast enough that I didn't notice it was a query."],
  ["engineering", "ada", 1790, "It only searches channels you're a member of, right?"],
  ["engineering", "grace", 1785, "Correct, membership is part of the query."],
  ["engineering", "linus", 1500, "Deploy checklist for tonight: migrations run on start, health check is `/health`, two instances behind Traefik."],
  ["engineering", "ada", 1495, "Make sure Traefik passes WebSocket upgrades through. It does by default, but our old nginx config didn't."],
  ["engineering", "grace", 1490, "And `TRUST_PROXY` stays on so the session cookie gets `Secure` behind TLS."],
  ["engineering", "linus", 1200, "Deploy done. Both instances healthy, messages fan out through the Redis adapter. ✅", [["🎉", ["ada", "grace"]], ["🚀", ["ada"]]]],
  ["general", "ada", 900, "Thanks everyone for a smooth launch week. Drinks are on me on Friday!", [["❤️", ["grace", "linus"]]]],
  ["general", "grace", 890, "I'll hold you to that."],
  ["random", "linus", 800, "Unpopular opinion: tabs are fine."],
  ["random", "grace", 795, "Strong opinion: spaces, two of them."],
  ["random", "ada", 790, "I'm staying out of this one."],
  ["engineering", "grace", 600, "Typing indicators now debounce, so we're not sending an event on every keystroke."],
  ["engineering", "ada", 595, "How long until it says someone stopped typing?"],
  ["engineering", "grace", 590, "Three seconds after the last keystroke, or immediately when they send."],
  ["engineering", "linus", 300, "Reminder: code freeze starts Thursday at noon. Get your reviews in."],
  ["engineering", "ada", 240, "I'll review the reactions PR this afternoon."],
  ["general", "grace", 180, "New joiner next week! Please say hi in #general when they arrive. 👋"],
  ["random", "ada", 120, "The coffee machine is fixed. Repeat: the coffee machine is fixed. ☕", [["☕", ["linus", "grace"]]]],
  ["random", "linus", 115, "Best news all week."],
  ["dm", "ada", 100, "Hey Linus, have you got 10 minutes to look at the adapter config?"],
  ["dm", "linus", 95, "Sure. Is it the reconnect thing?"],
  ["dm", "ada", 92, "Yes. Clients reconnect fine, but I want to double-check the subscriber connection is separate."],
  ["dm", "linus", 90, "It has to be. A subscribed ioredis connection can't run normal commands."],
  ["dm", "ada", 88, "That's what I thought. Thanks!"],
  ["engineering", "grace", 30, "Anyone seen flaky tests on CI today? Two failures, both timeouts."],
  ["engineering", "linus", 20, "Probably the shared runner again. Re-run and I'll look if it fails twice."],
];

/**
 * Inserts the demo workspace, users, channels and conversation when the database has no
 * users. Running it again does nothing, so it is safe on every start.
 *
 * @returns Whether anything was inserted.
 */
export async function seedIfEmpty(db: Db): Promise<boolean> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if ((row?.count ?? 0) > 0) return false;

  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  await db.transaction(async (tx) => {
    const [workspace] = await tx.insert(workspaces).values({ name: "Huddle Demo" }).returning();
    if (!workspace) throw new Error("Workspace insert failed");

    const userIds = {} as Record<Who, string>;
    for (const [key, person] of Object.entries(PEOPLE) as Array<[Who, (typeof PEOPLE)[Who]]>) {
      const [user] = await tx.insert(users).values({ ...person, passwordHash }).returning({ id: users.id });
      if (!user) throw new Error("User insert failed");
      userIds[key] = user.id;
    }

    const channelIds = {} as Record<Where, string>;
    for (const [name, topic] of Object.entries(CHANNELS) as Array<[Exclude<Where, "dm">, string]>) {
      const [channel] = await tx
        .insert(channels)
        .values({ workspaceId: workspace.id, kind: "public", name, topic, createdBy: userIds.ada })
        .returning({ id: channels.id });
      if (!channel) throw new Error("Channel insert failed");
      channelIds[name] = channel.id;
    }
    const [dm] = await tx
      .insert(channels)
      .values({
        workspaceId: workspace.id,
        kind: "dm",
        dmKey: [userIds.ada, userIds.linus].sort().join(":"),
        createdBy: userIds.ada,
      })
      .returning({ id: channels.id });
    if (!dm) throw new Error("DM insert failed");
    channelIds.dm = dm.id;

    const now = Date.now();
    let lastId = 0;
    for (const [where, who, minutesAgo, body, reacts] of SCRIPT) {
      const [message] = await tx
        .insert(messages)
        .values({
          channelId: channelIds[where],
          userId: userIds[who],
          body,
          createdAt: new Date(now - minutesAgo * 60_000),
        })
        .returning({ id: messages.id });
      if (!message) throw new Error("Message insert failed");
      lastId = message.id;
      for (const [emoji, people] of reacts ?? []) {
        await tx.insert(reactions).values(people.map((p) => ({ messageId: message.id, userId: userIds[p], emoji })));
      }
    }

    // Everyone is in every public channel; Grace has a few unread messages to show badges.
    const memberships = (["general", "random", "engineering"] as const).flatMap((name) =>
      (Object.keys(PEOPLE) as Who[]).map((who) => ({
        channelId: channelIds[name],
        userId: userIds[who],
        lastReadMessageId: who === "grace" ? Math.max(0, lastId - 6) : lastId,
      })),
    );
    memberships.push(
      { channelId: channelIds.dm, userId: userIds.ada, lastReadMessageId: lastId },
      { channelId: channelIds.dm, userId: userIds.linus, lastReadMessageId: lastId },
    );
    await tx.insert(channelMembers).values(memberships);
  });
  return true;
}
