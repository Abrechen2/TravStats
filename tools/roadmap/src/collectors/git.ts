import type { CollectorResult } from "../types.js";
import type { Runner } from "./run.js";

export interface GitBranch {
  readonly name: string;
  readonly head: string;
  /** Commits on this branch that main does not have. 0 for main itself. */
  readonly ahead: number;
  readonly worktree: string | null;
}

export interface GitState {
  readonly branches: readonly GitBranch[];
}

const TRUNK = "main";

/** `git worktree list --porcelain` emits stanzas of "worktree <path>" / "branch <ref>". */
function parseWorktrees(porcelain: string): Map<string, string> {
  const byBranch = new Map<string, string>();
  let currentPath: string | null = null;

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) currentPath = line.slice("worktree ".length).trim();
    if (line.startsWith("branch ") && currentPath !== null) {
      byBranch.set(line.slice("branch refs/heads/".length).trim(), currentPath);
    }
  }
  return byBranch;
}

export async function collectGit(run: Runner): Promise<CollectorResult<GitState>> {
  try {
    const refs = await run("git", [
      "for-each-ref",
      "--format=%(refname:short)\t%(objectname:short)",
      "refs/heads",
    ]);
    const worktrees = parseWorktrees(await run("git", ["worktree", "list", "--porcelain"]));

    const branches: GitBranch[] = [];
    for (const line of refs.split("\n").filter((l) => l.trim().length > 0)) {
      const [name, head] = line.split("\t");
      const ahead =
        name === TRUNK
          ? 0
          : Number.parseInt(
              (await run("git", ["rev-list", "--count", `${TRUNK}..${name}`])).trim(),
              10
            );
      branches.push({
        name,
        head: head.trim(),
        ahead: Number.isNaN(ahead) ? 0 : ahead,
        worktree: worktrees.get(name) ?? null,
      });
    }

    return { ok: true, data: { branches } };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
