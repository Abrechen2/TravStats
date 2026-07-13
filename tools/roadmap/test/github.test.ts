import { describe, expect, it } from "vitest";
import { collectGithub } from "../src/collectors/github.js";
import type { Runner } from "../src/collectors/run.js";

const ISSUES = JSON.stringify([
  {
    number: 197,
    title: "Booking- and Ticketnumber fields missing",
    labels: [{ name: "bug" }],
    author: { login: "alexanderkuenzel" },
    url: "https://github.com/Abrechen2/TravStats/issues/197",
  },
  {
    number: 189,
    title: "Airline and aircraft master data",
    labels: [{ name: "enhancement" }],
    author: { login: "Abrechen2" },
    url: "https://github.com/Abrechen2/TravStats/issues/189",
  },
]);

const PRS = JSON.stringify([
  {
    number: 165,
    title: "Bump tailwindcss",
    url: "https://github.com/Abrechen2/TravStats/pull/165",
  },
]);

const fakeRunner: Runner = async (_cmd, args) => (args[0] === "issue" ? ISSUES : PRS);

describe("collectGithub", () => {
  it("flattens issue labels and author into a plain shape", async () => {
    const result = await collectGithub(fakeRunner);
    if (!result.ok) throw new Error(result.reason);

    const issue = result.data.issues.find((i) => i.number === 197);
    expect(issue?.title).toContain("Booking");
    expect(issue?.labels).toEqual(["bug"]);
    expect(issue?.author).toBe("alexanderkuenzel");
  });

  it("collects the open dependabot PRs", async () => {
    const result = await collectGithub(fakeRunner);
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.dependabotPrs).toHaveLength(1);
    expect(result.data.dependabotPrs[0].number).toBe(165);
  });

  it("reports a failure when gh is not authenticated", async () => {
    const result = await collectGithub(async () => {
      throw new Error("gh: not logged in");
    });
    expect(result.ok).toBe(false);
  });

  it("reports a failure on unparseable output rather than crashing", async () => {
    const result = await collectGithub(async () => "not json");
    expect(result.ok).toBe(false);
  });
});
