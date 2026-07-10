import { describe, it, expect } from "vitest";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { channelTypeFor, planChannels, withReadOnlyDeny } from "../src/guildStructure.js";

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

describe("withReadOnlyDeny", () => {
  it("merges SendMessages into an existing @everyone deny (single entry, both perms)", () => {
    const result = withReadOnlyDeny(
      [{ id: "everyone", deny: [PermissionFlagsBits.ViewChannel] }],
      "everyone",
    );
    const everyone = result.filter((o) => o.id === "everyone");
    expect(everyone).toHaveLength(1);
    expect(everyone[0].deny).toContain(PermissionFlagsBits.ViewChannel);
    expect(everyone[0].deny).toContain(PermissionFlagsBits.SendMessages);
  });

  it("adds a new @everyone deny when none exists", () => {
    const result = withReadOnlyDeny([], "everyone");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("everyone");
    expect(result[0].deny).toEqual([PermissionFlagsBits.SendMessages]);
  });

  it("does not mutate the input", () => {
    const input = [{ id: "everyone", deny: [PermissionFlagsBits.ViewChannel] }];
    withReadOnlyDeny(input, "everyone");
    expect(input).toHaveLength(1);
    expect(input[0].deny).toEqual([PermissionFlagsBits.ViewChannel]);
  });
});
