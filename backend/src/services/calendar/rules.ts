/**
 * Calendar rules: a matched event's purpose and proposed name (spec
 * 2026-11-23-plugins-and-calendar.md, "Rules → purpose and name"). Ordered,
 * first match wins, none by default — an event without a rule proposes its
 * title and no purpose (unknown stays unknown).
 */
import { prisma } from "../../db";
import type { CalendarRule } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { z } from "../../schemas/zod";
import type { CalendarEvent } from "./icsParse";

export const MAX_CALENDAR_RULES = 50;
const NAME_CAP = 200;

export const calendarRuleInputSchema = z
  .object({
    kind: z.enum(["calendar", "keyword"]),
    sourceId: z.string().uuid().nullable().optional(),
    token: z.string().trim().min(1).max(80).nullable().optional(),
    matchMode: z.enum(["contains", "startsWith"]).default("contains"),
    purpose: z.enum(["private", "business"]).nullable().optional(),
    nameTemplate: z.string().trim().min(1).max(200).nullable().optional(),
    placeId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.kind === "calendar" && !r.sourceId)
      ctx.addIssue({ code: "custom", path: ["sourceId"], message: "required" });
    if (r.kind === "keyword" && !r.token)
      ctx.addIssue({ code: "custom", path: ["token"], message: "required" });
  });
export type CalendarRuleInput = z.infer<typeof calendarRuleInputSchema>;

export const calendarRulesPutSchema = z
  .object({ rules: z.array(calendarRuleInputSchema).max(MAX_CALENDAR_RULES) })
  .strict();

export const calendarRuleViewSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  kind: z.enum(["calendar", "keyword"]),
  sourceId: z.string().nullable(),
  token: z.string().nullable(),
  matchMode: z.enum(["contains", "startsWith"]),
  purpose: z.enum(["private", "business"]).nullable(),
  nameTemplate: z.string().nullable(),
  placeId: z.string().nullable(),
});
export type CalendarRuleView = z.infer<typeof calendarRuleViewSchema>;

export function ruleView(r: CalendarRule): CalendarRuleView {
  return {
    id: r.id,
    position: r.position,
    kind: r.kind === "calendar" ? "calendar" : "keyword",
    sourceId: r.sourceId,
    token: r.token,
    matchMode: r.matchMode === "startsWith" ? "startsWith" : "contains",
    purpose: r.purpose === "private" || r.purpose === "business" ? r.purpose : null,
    nameTemplate: r.nameTemplate,
    placeId: r.placeId,
  };
}

export async function listRules(userId: string): Promise<CalendarRule[]> {
  return prisma.calendarRule.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
}

/** Replaces the account's whole ordered list: the order IS the rule set. */
export async function replaceRules(
  userId: string,
  rules: readonly CalendarRuleInput[]
): Promise<CalendarRule[]> {
  if (rules.length > MAX_CALENDAR_RULES)
    throw new AppError("Too many calendar rules", 409, "CALENDAR_RULE_LIMIT");
  const sourceIds = [...new Set(rules.flatMap((r) => (r.sourceId ? [r.sourceId] : [])))];
  const placeIds = [...new Set(rules.flatMap((r) => (r.placeId ? [r.placeId] : [])))];
  const [sources, places] = await Promise.all([
    prisma.calendarSource.count({ where: { userId, id: { in: sourceIds } } }),
    prisma.place.count({ where: { userId, id: { in: placeIds } } }),
  ]);
  // Another account's calendar or place is "not found", never linked.
  if (sources !== sourceIds.length) throw new AppError("Calendar source not found", 404);
  if (places !== placeIds.length) throw new AppError("Place not found", 404);
  await prisma.$transaction([
    prisma.calendarRule.deleteMany({ where: { userId } }),
    prisma.calendarRule.createMany({
      data: rules.map((r, position) => ({
        userId,
        position,
        kind: r.kind,
        sourceId: r.sourceId ?? null,
        token: r.kind === "keyword" ? (r.token ?? null) : null,
        matchMode: r.matchMode,
        purpose: r.purpose ?? null,
        nameTemplate: r.nameTemplate ?? null,
        placeId: r.kind === "keyword" ? (r.placeId ?? null) : null,
      })),
    }),
  ]);
  return listRules(userId);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the token stands in the title at a word boundary, or -1. */
function tokenAt(title: string, token: string, mode: string): number {
  const boundary = `(?<![\\p{L}\\p{N}])${escape(token)}(?![\\p{L}\\p{N}])`;
  const re = new RegExp(mode === "startsWith" ? `^\\s*${boundary}` : boundary, "iu");
  const m = re.exec(title);
  return m ? m.index + m[0].length : -1;
}

export interface RuleOutcome {
  ruleId: string | null;
  kind: "calendar" | "keyword" | null;
  purpose: "private" | "business" | null;
  name: string;
  placeId: string | null;
}

function fill(template: string, event: CalendarEvent, after: string): string {
  return template
    .replace(/\{title\}/g, event.title)
    .replace(/\{location\}/g, event.location ?? "")
    .replace(/\{titleAfterToken\}/g, after)
    .replace(/\s+/g, " ")
    .trim();
}

/** The first rule that matches the event, applied; without one the title and no purpose. */
export function applyRules(
  rules: readonly CalendarRuleView[],
  event: CalendarEvent,
  sourceId: string
): RuleOutcome {
  for (const rule of rules) {
    let after = "";
    if (rule.kind === "calendar") {
      if (rule.sourceId !== sourceId) continue;
    } else {
      if (rule.sourceId && rule.sourceId !== sourceId) continue;
      const end = rule.token ? tokenAt(event.title, rule.token, rule.matchMode) : -1;
      if (end < 0) continue;
      after = event.title
        .slice(end)
        .replace(/^[\s:–—-]+/, "")
        .trim();
    }
    const name = (rule.nameTemplate ? fill(rule.nameTemplate, event, after) : "") || event.title;
    return {
      ruleId: rule.id,
      kind: rule.kind,
      purpose: rule.purpose,
      name: name.slice(0, NAME_CAP),
      placeId: rule.placeId,
    };
  }
  return {
    ruleId: null,
    kind: null,
    purpose: null,
    name: event.title.slice(0, NAME_CAP),
    placeId: null,
  };
}
