import { describe, it, expect } from "vitest";
import { ChannelType } from "discord.js";
import { channelTypeFor, planChannels } from "../src/guildStructure.js";

describe("channelTypeFor", () => {
  it("maps text/voice regardless of community mode", () => {
    expect(channelTypeFor("text", false)).toBe(ChannelType.GuildText);
    expect(channelTypeFor("voice", false)).toBe(ChannelType.GuildVoice);
  });

  it("maps forum and announcement to their real types when community is on", () => {
    expect(channelTypeFor("forum", true)).toBe(ChannelType.GuildForum);
    expect(channelTypeFor("announcement", true)).toBe(ChannelType.GuildAnnouncement);
  });

  it("falls back to text when community is off", () => {
    expect(channelTypeFor("forum", false)).toBe(ChannelType.GuildText);
    expect(channelTypeFor("announcement", false)).toBe(ChannelType.GuildText);
  });
});

describe("planChannels", () => {
  it("skips channels that already exist", () => {
    const actions = planChannels(["general", "rules"]);
    expect(actions.find((a) => a.name === "general")?.op).toBe("skip");
    expect(actions.find((a) => a.name === "rules")?.op).toBe("skip");
    expect(actions.find((a) => a.name === "showcase")?.op).toBe("create");
  });
});
