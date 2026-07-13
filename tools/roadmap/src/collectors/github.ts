import { z } from "zod";
import type { CollectorResult } from "../types.js";
import type { Runner } from "./run.js";

export interface GithubIssue {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
  readonly author: string;
  readonly url: string;
}

export interface GithubPr {
  readonly number: number;
  readonly title: string;
  readonly url: string;
}

export interface GithubState {
  readonly issues: readonly GithubIssue[];
  readonly dependabotPrs: readonly GithubPr[];
}

const issuesSchema = z.array(
  z.object({
    number: z.number(),
    title: z.string(),
    labels: z.array(z.object({ name: z.string() })),
    author: z.object({ login: z.string() }),
    url: z.string(),
  })
);

const prsSchema = z.array(z.object({ number: z.number(), title: z.string(), url: z.string() }));

export async function collectGithub(run: Runner): Promise<CollectorResult<GithubState>> {
  try {
    const issuesRaw = await run("gh", [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title,labels,author,url",
    ]);
    const prsRaw = await run("gh", [
      "pr",
      "list",
      "--state",
      "open",
      "--author",
      "app/dependabot",
      "--limit",
      "50",
      "--json",
      "number,title,url",
    ]);

    const issues = issuesSchema.parse(JSON.parse(issuesRaw)).map((i) => ({
      number: i.number,
      title: i.title,
      labels: i.labels.map((l) => l.name),
      author: i.author.login,
      url: i.url,
    }));

    return {
      ok: true,
      data: { issues, dependabotPrs: prsSchema.parse(JSON.parse(prsRaw)) },
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
