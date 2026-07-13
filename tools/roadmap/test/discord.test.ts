import { describe, expect, it } from "vitest";
import { collectDiscord, type MessageFetcher } from "../src/collectors/discord.js";
import type { DiscordWatermark } from "../src/types.js";

const WATERMARKS: DiscordWatermark[] = [
  { channel: "dev-talk", triagedUpTo: "2026-07-12T12:00:00Z" },
  { channel: "beta-channel", triagedUpTo: "2026-07-12T12:00:00Z" },
];

const fetcher: MessageFetcher = async (channel) =>
  channel === "dev-talk"
    ? [
        { author: "alex", timestamp: "2026-07-12T10:00:00Z", content: "old", url: "u1" },
        { author: "alex", timestamp: "2026-07-12T14:20:00Z", content: "new one", url: "u2" },
        { author: "alex", timestamp: "2026-07-12T16:42:00Z", content: "new two", url: "u3" },
      ]
    : [];

describe("collectDiscord", () => {
  it("returns only messages newer than the channel's watermark", async () => {
    const result = await collectDiscord(WATERMARKS, fetcher);
    if (!result.ok) throw new Error(result.reason);

    expect(result.data.untriaged).toHaveLength(2);
    expect(result.data.untriaged.map((m) => m.content)).toEqual(["new one", "new two"]);
  });

  it("tags each message with its channel, because watermarks are per channel", async () => {
    const result = await collectDiscord(WATERMARKS, fetcher);
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.untriaged.every((m) => m.channel === "dev-talk")).toBe(true);
  });

  it("sorts untriaged messages oldest first", async () => {
    const result = await collectDiscord(WATERMARKS, fetcher);
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.untriaged[0].timestamp < result.data.untriaged[1].timestamp).toBe(true);
  });

  it("reports a failure when the bot cannot connect", async () => {
    const result = await collectDiscord(WATERMARKS, async () => {
      throw new Error("DISCORD_BOT_TOKEN is missing");
    });
    expect(result.ok).toBe(false);
  });
});
