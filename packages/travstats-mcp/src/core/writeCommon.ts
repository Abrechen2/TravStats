import { z } from "zod";
import { ToolFailure } from "./errors";
import type { DraftStore } from "./drafts";
import type { ToolContext, ToolResult } from "./types";

export type Rec = Record<string, unknown>;

export const WRITES =
  "WRITES to the user's TravStats. Show the user exactly what will be saved and get their yes first; then call again with confirm: true. Without confirm it saves nothing and returns what it would send.";
export const MAX_TEXT_BYTES = 20_000;
export const DOMAINS_PARSE = [
  "auto",
  "flight",
  "lodging",
  "rail",
  "cruise",
  "rental",
  "bus",
  "ferry",
  "package",
] as const;

export const confirmField = z
  .boolean()
  .default(false)
  .describe("Must be true to write. Only set it after the user said yes to this exact content.");

export const text20k = z
  .string()
  .min(1)
  .refine((t) => Buffer.byteLength(t) <= MAX_TEXT_BYTES, `at most ${MAX_TEXT_BYTES} bytes`);

export const store = (ctx: ToolContext): DraftStore => {
  if (!ctx.drafts)
    throw new ToolFailure("config", "This server was started without a draft store.");
  return ctx.drafts;
};

export const idOf = (res: Rec): string | undefined => {
  const pick = (o: unknown): string | undefined =>
    o && typeof o === "object" && typeof (o as Rec).id === "string"
      ? ((o as Rec).id as string)
      : undefined;
  return pick(res.flight) ?? pick(res.data) ?? pick(res) ?? pick(res.journey);
};

export function dryRun(summary: string, wouldSend: unknown, extra: Rec = {}): ToolResult {
  return {
    summary: `Nothing was written. ${summary}`,
    data: { written: false, confirmRequired: true, wouldSend, ...extra },
  };
}
