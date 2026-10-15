import { sourceSchema, checkTree } from "./schema";
import { z } from "zod";
import { api } from "../api/client";
import { comparisonPost, type Scope, type Snapshot, type Link } from "../api/comparison";
import {
  createPublication,
  openPublication,
  encode,
  type DeviceKeys,
  type PublicDevice,
  type Manifest,
} from "./crypto";
import { pinnedDevices, checkFreshness } from "./vault";
export interface Asset {
  key: string;
  kind: string;
  id: string;
  name: string;
  mime: string;
  size: number | null;
  assetId?: string;
}
export interface SourceData {
  version: 2;
  asOf: string;
  scope: Scope;
  snapshot: Snapshot;
  sections: Record<string, unknown[]>;
  assets: Asset[];
  omitted: string[];
}
export interface Audience {
  audience: string;
  members: Array<{ source: string; label: string; origin: string; devices: PublicDevice[] }>;
}
export interface Target {
  linkId: string | null;
  circleId?: string;
}
export interface ReaderTarget extends Target {
  audience: string;
  source?: string;
  own?: boolean;
}
interface PackedFile extends Asset {
  start: number;
  count: number;
  size: number;
}
export interface OpenData {
  data: SourceData;
  files: Asset[];
  download: (key: string) => Promise<Blob>;
  manifest?: Manifest;
}
export const deviceBinding = (target: Target, source: string) =>
  target.circleId ? `group:${target.circleId}:${source}` : `friend:${source}`;
export const sourceData = (scope: Scope) => post<SourceData>("/source", scope);
export const audienceDevices = (target: Target) => post<Audience>("/recipients", target);
const CHUNK = 256 * 1024;
const post = <T>(path: string, body: unknown) =>
  api
    .post<{ data: T }>(`/comparison/sealed${path}`, body, { timeout: 120000 })
    .then((r) => r.data.data);
export async function publish(
  account: string,
  device: DeviceKeys,
  links: Link[],
  target: Target,
  audience: Audience,
  scope: Scope,
  data: SourceData,
  progress: (text: string) => void
) {
  const pins = await pinnedDevices(account),
    recipients = [
      ...new Map(
        audience.members.flatMap((m) => m.devices).map((d) => [d.fingerprint, d])
      ).values(),
    ];
  if (
    audience.members.some(
      (m) =>
        !m.devices.length ||
        m.devices.some(
          (d) =>
            d.fingerprint !== device.public.fingerprint &&
            !pins[`${deviceBinding(target, m.source)}:${d.fingerprint}`]
        )
    )
  )
    throw Error("E2E_VERIFY_ALL_DEVICES");
  if (!recipients.some((d) => d.fingerprint === device.public.fingerprint))
    recipients.push(device.public);
  const selectedLink = target.linkId
    ? links.find((l) => l.id === target.linkId)
    : links.find((l) => audience.members.some((m) => m.source === l.channel));
  if (!selectedLink) throw Error("E2E_LINK");
  let revision: number;
  if (target.circleId) {
    await comparisonPost("/circles/grant", {
      ...target,
      circleId: target.circleId,
      version: Number(audience.audience.split(":")[1]),
      scope,
    });
    const list = (await api.get<{ data: Link[] }>("/comparison/links")).data.data;
    revision = list
      .find((l) => l.id === selectedLink.id)!
      .grants.find((g) => g.audience === audience.audience && g.active)!.revision;
  } else
    revision = (
      await comparisonPost<{ revision: number }>(`/links/${selectedLink.id}/grant`, {
        audience: "",
        scope,
      })
    ).revision;
  const now = Date.now();
  const context = {
    version: 2 as const,
    id: crypto.randomUUID(),
    channel: selectedLink.channel,
    audience: audience.audience,
    revision,
    sender: device.public.fingerprint,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(
      Math.min(now + 30 * 86400000, scope.expiresAt ? Date.parse(scope.expiresAt) : Infinity)
    ).toISOString(),
  };
  const sealed = await createPublication(device, context, recipients);
  await post("/begin", { linkId: selectedLink.id, context });
  let parts = 0;
  const send = async (bytes: Uint8Array<ArrayBuffer>) => {
    const chunk = await sealed.chunk(bytes);
    await post(`/${context.id}/chunk`, chunk);
    parts++;
  };
  const files: PackedFile[] = [];
  try {
    for (const [index, asset] of data.assets.entries()) {
      progress(`${index + 1}/${data.assets.length}: ${asset.name}`);
      const blob = (
        await api.get<Blob>(
          `/comparison/sealed/asset/${encodeURIComponent(asset.kind)}/${encodeURIComponent(asset.id)}`,
          {
            params: asset.assetId ? { assetId: asset.assetId } : undefined,
            responseType: "blob",
            timeout: 120000,
          }
        )
      ).data;
      if (blob.size > 512 * 1024 * 1024) throw Error("E2E_FILE_QUOTA");
      const start = parts;
      for (let offset = 0; offset < blob.size; offset += CHUNK)
        await send(new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer()));
      files.push({ ...asset, start, count: parts - start, size: blob.size });
    }
    const indexStart = parts,
      index = encode(JSON.stringify({ data, files }));
    checkTree(data);
    sourceSchema.parse(data);
    if (index.length > 64 * 1024 * 1024) throw Error("E2E_INDEX_QUOTA");
    for (let offset = 0; offset < index.length; offset += CHUNK)
      await send(index.slice(offset, offset + CHUNK));
    const manifest = await sealed.finish(indexStart, parts - indexStart);
    await post(`/${context.id}/finish`, manifest);
  } catch (error) {
    await api.delete(`/comparison/sealed/${context.id}`).catch(() => undefined);
    throw error;
  }
}
const fileSchema = z.object({
  key: z.string().max(200),
  name: z.string().max(1000),
  mime: z.string().max(200),
  start: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
});
export async function readPublication(
  account: string,
  device: DeviceKeys,
  target: ReaderTarget,
  expectedSenders: PublicDevice[],
  channel?: string
): Promise<OpenData | null> {
  const read = <T>(extra: Record<string, unknown> = {}) =>
    post<T>("/read", { ...target, recipient: device.public.fingerprint, ...extra });
  const head = await read<{ manifest: Manifest; sender: PublicDevice } | null>();
  if (!head) return null;
  const pins = await pinnedDevices(account);
  const sender =
    head.sender.fingerprint === device.public.fingerprint
      ? device.public
      : pins[`${deviceBinding(target, target.source ?? channel ?? "")}:${head.sender.fingerprint}`];
  if (!sender || !expectedSenders.some((s) => s.fingerprint === sender.fingerprint))
    throw Error("E2E_UNVERIFIED_SENDER");
  const decrypt = await openPublication(device, sender, head.manifest, {
    audience: target.audience,
    channel: target.circleId ? undefined : channel,
  });
  const c = head.manifest.context;
  const readChunk = async (part: number) => {
    const reply = await read<{ part: number; bytes: string }>({ publication: c.id, part });
    if (reply.part !== part) throw Error("E2E_PART");
    return decrypt(part, reply.bytes);
  };
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (let i = head.manifest.indexStart; i < head.manifest.digests.length; i++) {
    const bytes = await readChunk(i);
    size += bytes.length;
    if (size > 64 * 1024 * 1024) throw Error("E2E_INDEX_QUOTA");
    chunks.push(bytes);
  }
  const text = await new Blob(chunks).text();
  const parsed = z
    .object({
      data: sourceSchema,
      files: z.array(fileSchema).max(20000),
    })
    .parse(JSON.parse(text));
  checkTree(parsed.data);
  // File ranges cannot name metadata, overlap, escape the signed publication, or omit a chunk.
  let next = 0;
  for (const f of parsed.files) {
    if (
      f.start !== next ||
      f.start + f.count > head.manifest.indexStart ||
      f.size > 512 * 1024 * 1024 ||
      Math.ceil(f.size / CHUNK) !== f.count
    )
      throw Error("E2E_FILE_RANGE");
    next += f.count;
  }
  if (next !== head.manifest.indexStart) throw Error("E2E_FILE_RANGE");
  await checkFreshness(
    account,
    `${target.audience}:${channel ?? target.source ?? ""}`,
    sender.fingerprint,
    c.createdAt,
    c.id
  );
  return {
    data: parsed.data as unknown as SourceData,
    files: parsed.files as PackedFile[],
    manifest: head.manifest,
    async download(key) {
      const f = parsed.files.find((f) => f.key === key);
      if (!f) throw Error("E2E_FILE");
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (let i = f.start; i < f.start + f.count; i++) parts.push(await readChunk(i));
      const blob = new Blob(parts, { type: "application/octet-stream" });
      if (blob.size !== f.size) throw Error("E2E_FILE_SIZE");
      return blob;
    },
  };
}

/** Own files retain the owner's ordinary authenticated path; they are not peer reads. */
export function ownDataView(data: SourceData): OpenData {
  return {
    data,
    files: data.assets,
    async download(key) {
      const asset = data.assets.find((a) => a.key === key);
      if (!asset) throw Error("E2E_FILE");
      return (
        await api.get<Blob>(
          `/comparison/sealed/asset/${encodeURIComponent(asset.kind)}/${encodeURIComponent(asset.id)}`,
          {
            params: asset.assetId ? { assetId: asset.assetId } : undefined,
            responseType: "blob",
            timeout: 120000,
          }
        )
      ).data;
    },
  };
}
