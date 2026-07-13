import { describe, expect, it } from "vitest";
import { collectGit } from "../src/collectors/git.js";
import type { Runner } from "../src/collectors/run.js";

const BRANCHES = [
  "main\t72ecfd29",
  "dev/hotels\t27389802",
  "feat/airline-logo-proxy\t486c4ba1",
].join("\n");

const WORKTREES = [
  "worktree D:/TravStats_Projekt/TravStats",
  "branch refs/heads/main",
  "",
  "worktree D:/TravStats_Projekt/TravStats/.claude/worktrees/hotels",
  "branch refs/heads/dev/hotels",
  "",
].join("\n");

function fakeRunner(aheadCounts: Record<string, string>): Runner {
  return async (_cmd, args) => {
    if (args[0] === "for-each-ref") return BRANCHES;
    if (args[0] === "worktree") return WORKTREES;
    if (args[0] === "rev-list") {
      const branch = args[args.length - 1].replace("main..", "");
      return aheadCounts[branch] ?? "0";
    }
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
}

describe("collectGit", () => {
  it("reports branches with their ahead-count and worktree", async () => {
    const result = await collectGit(fakeRunner({ "dev/hotels": "42" }));
    if (!result.ok) throw new Error(result.reason);

    const hotels = result.data.branches.find((b) => b.name === "dev/hotels");
    expect(hotels?.ahead).toBe(42);
    expect(hotels?.worktree).toContain("worktrees/hotels");
    expect(hotels?.head).toBe("27389802");
  });

  it("gives main an ahead-count of zero and no worktree confusion", async () => {
    const result = await collectGit(fakeRunner({}));
    if (!result.ok) throw new Error(result.reason);

    const main = result.data.branches.find((b) => b.name === "main");
    expect(main?.ahead).toBe(0);
  });

  it("reports a failure instead of throwing when git is unavailable", async () => {
    const result = await collectGit(async () => {
      throw new Error("git: command not found");
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toContain("command not found");
  });
});
