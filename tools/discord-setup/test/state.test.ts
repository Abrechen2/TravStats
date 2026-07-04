import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { readState, writeState, STATE_PATH } from "../src/state.js";

afterEach(() => {
  if (existsSync(STATE_PATH)) rmSync(STATE_PATH);
});

describe("state", () => {
  it("returns an empty array when no state file exists", () => {
    expect(readState()).toEqual([]);
  });

  it("round-trips a guild's rules message id", () => {
    writeState({ guildId: "123", rulesMessageId: "456" });
    expect(readState()).toEqual([{ guildId: "123", rulesMessageId: "456" }]);
  });

  it("overwrites the entry for the same guild instead of duplicating", () => {
    writeState({ guildId: "123", rulesMessageId: "456" });
    writeState({ guildId: "123", rulesMessageId: "789" });
    expect(readState()).toEqual([{ guildId: "123", rulesMessageId: "789" }]);
  });

  it("filters out malformed entries", () => {
    writeFileSync(
      STATE_PATH,
      JSON.stringify([
        { guildId: "123", rulesMessageId: "456" },
        { guildId: 999, rulesMessageId: "numeric-guild-id" },
        { nope: true },
        "not-an-object",
      ]),
      "utf8",
    );
    expect(readState()).toEqual([{ guildId: "123", rulesMessageId: "456" }]);
  });
});
