/**
 * Plugin-fed place lists (owner 2026-11-26): a suggestion plugin may announce `list` in its
 * hello; TravStats then keeps ONE list per registration whose members are the places of that
 * plugin's accepted suggestions, with the announced columns filled from `externalRef.fields`.
 *
 * Generic on purpose: nothing here knows any plugin. The name is what the plugin sends (or the
 * registration's own name when the user switches the list on for a plugin that announces none),
 * and a column is shown only when the hello announced it.
 */
import { z } from "zod";
import type { Prisma, SuggestionPlugin } from "../../prisma";
import { prisma, type DbTransaction } from "../../db";
import type { PluginHello } from "../plugins/contract";
import logger from "../../utils/logger";

export const PLUGIN_ENTRY_CREATED_BY = "plugin";

export interface PluginListColumn {
  key: string;
  label: { de: string; en: string };
}

const columnsSchema = z.array(
  z.object({ key: z.string(), label: z.object({ de: z.string(), en: z.string() }) })
);

/** The columns a list stores; [] for a normal list or an unreadable value. */
export function pluginColumnsOf(value: unknown): PluginListColumn[] {
  const parsed = columnsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export interface EntryExternal {
  id: string;
  label?: string;
  fields: Record<string, string>;
}

/** What a membership row keeps: the reference, its label and ONLY the announced columns. */
export function entryExternal(
  ref: { externalRef?: string; externalLabel?: string; externalFields?: Record<string, string> },
  columns: readonly PluginListColumn[]
): EntryExternal | null {
  if (!ref.externalRef) return null;
  const allowed = new Set(columns.map((c) => c.key));
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(ref.externalFields ?? {}))
    if (allowed.has(k) && typeof v === "string") fields[k] = v.slice(0, 200);
  return {
    id: ref.externalRef,
    ...(ref.externalLabel ? { label: ref.externalLabel.slice(0, 200) } : {}),
    fields,
  };
}

export interface PluginListState {
  /** The switch "Orte dieses Plugins als Liste führen". */
  enabled: boolean;
  /** The hello announced `list`. */
  announced: boolean;
  listId: string | null;
  listName: string | null;
}

type Locale = "de" | "en";

/**
 * The places that belong to the plugin: those its accepted suggestions made (`plugin:<id>:<ref>`)
 * and, when the hello names a `refNamespace`, those carrying `<namespace>:<ref>` — as their own
 * reference or as an alias — however they were made. `refId` is the part after the prefix.
 */
async function pluginPlaces(
  userId: string,
  pluginId: string,
  namespace: string | null
): Promise<{ id: string; refId: string }[]> {
  const prefixes = [`plugin:${pluginId}:`, ...(namespace ? [`${namespace}:`] : [])];
  const [own, aliases] = await Promise.all([
    prisma.place.findMany({
      where: { userId, OR: prefixes.map((p) => ({ externalRef: { startsWith: p } })) },
      select: { id: true, externalRef: true },
    }),
    prisma.placeExternalRef.findMany({
      where: { userId, OR: prefixes.map((p) => ({ ref: { startsWith: p } })) },
      select: { placeId: true, ref: true },
    }),
  ]);
  const strip = (ref: string): string => {
    const p = prefixes.find((x) => ref.startsWith(x));
    return p ? ref.slice(p.length) : ref;
  };
  const out = new Map<string, string>();
  for (const p of own) if (p.externalRef) out.set(p.id, strip(p.externalRef));
  for (const a of aliases) if (!out.has(a.placeId)) out.set(a.placeId, strip(a.ref));
  return [...out].map(([id, refId]) => ({ id, refId }));
}

/** The fields an accepted finding carried for a place, newest first. */
async function fieldsFromFindings(
  userId: string,
  pluginId: string,
  placeIds: string[]
): Promise<
  Map<
    string,
    { externalRef?: string; externalLabel?: string; externalFields?: Record<string, string> }
  >
> {
  const out = new Map<
    string,
    { externalRef?: string; externalLabel?: string; externalFields?: Record<string, string> }
  >();
  if (placeIds.length === 0) return out;
  const rows = await prisma.dawarichStay.findMany({
    where: { userId, status: "accepted", placeId: { in: placeIds } },
    select: { placeId: true, evidence: true },
    orderBy: [{ startAt: "desc" }, { id: "asc" }],
  });
  for (const row of rows) {
    if (!row.placeId || out.has(row.placeId)) continue;
    const plugins = (row.evidence as { plugins?: unknown } | null)?.plugins;
    if (!Array.isArray(plugins)) continue;
    const hit = (plugins as Record<string, unknown>[]).find((p) => p.pluginId === pluginId);
    if (hit) out.set(row.placeId, hit as never);
  }
  return out;
}

/** Adds every place this plugin's accepted suggestions made (the list's first fill). */
async function backfillMembers(
  userId: string,
  pluginId: string,
  listId: string,
  columns: PluginListColumn[],
  namespace: string | null
) {
  const already = new Set(
    (await prisma.placeListEntry.findMany({ where: { listId }, select: { placeId: true } })).map(
      (e) => e.placeId
    )
  );
  const places = (await pluginPlaces(userId, pluginId, namespace)).filter(
    (p) => !already.has(p.id)
  );
  if (places.length === 0) return;
  const found = await fieldsFromFindings(
    userId,
    pluginId,
    places.map((p) => p.id)
  );
  for (const place of places) {
    const refId = place.refId;
    const evidence = found.get(place.id) ?? { externalRef: refId };
    const external = entryExternal(
      { ...evidence, externalRef: evidence.externalRef ?? refId },
      columns
    );
    await prisma.placeListEntry.upsert({
      where: { listId_placeId: { listId, placeId: place.id } },
      create: {
        listId,
        placeId: place.id,
        createdBy: PLUGIN_ENTRY_CREATED_BY,
        ...(external ? { externalFields: external as unknown as Prisma.InputJsonValue } : {}),
      },
      update: {},
    });
  }
}

/**
 * The list state of one registration, creating the list when it should exist and does not:
 * the switch is on (or not chosen yet and the hello announces `list`). A list that exists takes
 * the columns the hello announces now; its name stays the user's.
 */
export async function syncPluginList(
  userId: string,
  plugin: SuggestionPlugin,
  hello: PluginHello | null,
  locale: Locale
): Promise<PluginListState> {
  const announced = Boolean(hello?.list);
  let list = await prisma.placeList.findFirst({
    where: { userId, pluginId: plugin.id },
    select: { id: true, name: true, pluginColumns: true },
  });
  // Not chosen yet: on when announced. A hello that failed this time announces nothing, and a
  // list made earlier keeps the switch on rather than reading as "off".
  const enabled = plugin.listEnabled ?? (announced || list !== null);
  const columns: PluginListColumn[] = hello?.list?.columns ?? [];
  if (enabled && !list) {
    const name = hello?.list ? hello.list.defaultName[locale] : plugin.name;
    list = await prisma.placeList.create({
      data: {
        userId,
        name: name.slice(0, 100),
        pluginId: plugin.id,
        pluginColumns: columns as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, name: true, pluginColumns: true },
    });
    logger.info({ operation: "pluginList.created", userId, pluginId: plugin.id, listId: list.id });
  } else if (list && hello?.list) {
    if (JSON.stringify(pluginColumnsOf(list.pluginColumns)) !== JSON.stringify(columns))
      await prisma.placeList.update({
        where: { id: list.id },
        data: { pluginColumns: columns as unknown as Prisma.InputJsonValue },
      });
  }
  // Fill (first time) and top up: places made since, also outside the accept flow, join on the
  // next look at the settings card. Only missing members are written.
  if (enabled && list)
    await backfillMembers(userId, plugin.id, list.id, columns, hello?.list?.refNamespace ?? null);
  return { enabled, announced, listId: list?.id ?? null, listName: list?.name ?? null };
}

/** The switch. Off keeps the list as a normal list (no longer fed); on creates or reuses it. */
export async function setPluginListEnabled(
  userId: string,
  plugin: SuggestionPlugin,
  enabled: boolean,
  hello: PluginHello | null,
  locale: Locale
): Promise<PluginListState> {
  const updated = await prisma.suggestionPlugin.update({
    where: { id: plugin.id },
    data: { listEnabled: enabled },
  });
  if (!enabled)
    await prisma.placeList.updateMany({
      where: { userId, pluginId: plugin.id },
      data: { pluginId: null },
    });
  return syncPluginList(userId, updated, hello, locale);
}

/**
 * An accepted suggestion of `pluginId` puts its place into the plugin's list, when the list
 * exists. Inside the accepting transaction: the place and its membership land together.
 */
export async function joinPluginList(
  tx: DbTransaction,
  userId: string,
  pluginId: string,
  placeId: string,
  ref: { externalRef?: string; externalLabel?: string; externalFields?: Record<string, string> }
): Promise<boolean> {
  const list = await tx.placeList.findFirst({
    where: { userId, pluginId },
    select: { id: true, pluginColumns: true },
  });
  if (!list) return false;
  const external = entryExternal(ref, pluginColumnsOf(list.pluginColumns));
  const data = external ? { externalFields: external as unknown as Prisma.InputJsonValue } : {};
  await tx.placeListEntry.upsert({
    where: { listId_placeId: { listId: list.id, placeId } },
    create: { listId: list.id, placeId, createdBy: PLUGIN_ENTRY_CREATED_BY, ...data },
    update: data,
  });
  return true;
}
