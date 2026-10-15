import { z } from "zod";
import { prisma } from "../../../db";
import type { ComparisonLink } from "../../../prisma";
import { ownedLink } from "../links";
import { ownedCircle, circleInfo, audienceOf, incomingInfo } from "../circles";
import { circleSchema } from "../contract";
import { exchange, refused } from "../security";
import { ownDevices, sourceDevices, readSealed, ownSealed } from "./store";
import { deviceSchema, type PublicDevice, type SealedRequest } from "./wire";
export interface DeviceMember {
  source: string;
  label: string;
  origin: string;
  devices: PublicDevice[];
}
async function counterpart(link: ComparisonLink) {
  const other = await prisma.comparisonLink.findFirst({
    where: { channel: link.channel, origin: "local", id: { not: link.id }, revoked: false },
  });
  if (!other) throw refused();
  return other;
}
export async function ask(
  link: ComparisonLink,
  body: Omit<SealedRequest, "channel" | "action">
): Promise<unknown> {
  if (!link.confirmed || !link.remoteConfirmed || link.revoked) throw refused();
  const request: SealedRequest = { action: "sealed", channel: link.channel, ...body };
  return link.origin === "local"
    ? handleSealed(await counterpart(link), request)
    : exchange(link.origin, request);
}
async function group(userId: string, circleId: string, viewer?: ComparisonLink) {
  const raw = await ownedCircle(userId, circleId);
  const c = circleSchema.parse({
    id: raw.id,
    name: raw.name,
    version: raw.version,
    members: raw.members,
  });
  if (viewer) await circleInfo(viewer, circleId);
  return c;
}
export async function groupDevices(
  userId: string,
  circleId: string,
  viewer?: ComparisonLink
): Promise<{ audience: string; members: DeviceMember[] }> {
  const c = await group(userId, circleId, viewer);
  const members: DeviceMember[] = [
    { source: "host", label: "host", origin: "local", devices: await ownDevices(userId) },
  ];
  // No partial roster: an unreachable source must prevent approval of an incomplete audience.
  for (const member of c.members) {
    const l = await prisma.comparisonLink.findFirst({
      where: { userId, channel: member.channel, revoked: false },
    });
    if (!l) throw refused();
    const devices = z
      .array(deviceSchema)
      .max(5)
      .parse(await ask(l, { operation: "devices", audience: "" }));
    members.push({ source: member.channel, label: member.label, origin: member.origin, devices });
  }
  if ((await ownedCircle(userId, circleId)).version !== c.version) throw refused();
  return { audience: audienceOf(c), members };
}
export async function groupRead(
  userId: string,
  circleId: string,
  request: SealedRequest,
  viewer?: ComparisonLink
) {
  const c = await group(userId, circleId, viewer),
    audience = audienceOf(c);
  if (
    request.audience !== audience ||
    !request.recipient ||
    (viewer && !c.members.find((m) => m.channel === viewer.channel)?.accepted)
  )
    throw refused();
  let data;
  if (request.source === "host")
    data = await ownSealed(userId, audience, request.recipient, request.publication, request.part);
  else {
    const member = c.members.find((m) => m.channel === request.source && m.accepted);
    if (!member) throw refused();
    const link = await prisma.comparisonLink.findFirst({
      where: { userId, channel: member.channel, revoked: false },
    });
    if (!link) throw refused();
    data = await ask(link, {
      operation: "read",
      audience,
      recipient: request.recipient,
      publication: request.publication,
      part: request.part,
    });
  }
  const latest = await group(userId, circleId, viewer);
  if (
    latest.version !== c.version ||
    (viewer && !latest.members.find((m) => m.channel === viewer.channel)?.accepted)
  )
    throw refused();
  return data;
}
export async function handleSealed(link: ComparisonLink, request: SealedRequest): Promise<unknown> {
  await ownedLink(link.userId, link.id);
  if (!link.confirmed || !link.remoteConfirmed) throw refused();
  if (request.operation === "devices") return sourceDevices(link);
  if (request.operation === "read") {
    if (!request.recipient) throw refused();
    return readSealed(link, request.audience, request.recipient, request.publication, request.part);
  }
  if (!request.circleId) throw refused();
  return request.operation === "group-devices"
    ? groupDevices(link.userId, request.circleId, link)
    : groupRead(link.userId, request.circleId, request, link);
}
export async function recipients(userId: string, linkId: string | null, circleId?: string) {
  if (!circleId) {
    if (!linkId) throw refused();
    const l = await ownedLink(userId, linkId);
    return {
      audience: "",
      members: [
        {
          source: l.channel,
          label: l.label,
          origin: l.origin,
          devices: z
            .array(deviceSchema)
            .max(5)
            .parse(await ask(l, { operation: "devices", audience: "" })),
        },
      ],
    };
  }
  if (!linkId) return groupDevices(userId, circleId);
  const l = await ownedLink(userId, linkId);
  await incomingInfo(l, circleId);
  return ask(l, { operation: "group-devices", audience: "", circleId });
}
