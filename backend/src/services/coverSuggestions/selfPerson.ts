/**
 * "Das bin ich": which recognised person of each photo source is the account
 * holder. Only the person's id is stored (`UserSettings`); the people list is
 * read from the source when the picker opens and thrown away.
 */
import { prisma } from "../../db";
import type { PhotoSourceKind } from "../photoSource/types";

const COLUMN = {
  immich: "immichSelfPersonId",
  photoprism: "photoprismSelfPersonId",
} as const satisfies Record<PhotoSourceKind, string>;

export async function selfPersonId(
  userId: string,
  provider: PhotoSourceKind
): Promise<string | null> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { immichSelfPersonId: true, photoprismSelfPersonId: true },
  });
  return row?.[COLUMN[provider]] ?? null;
}

export async function setSelfPersonId(
  userId: string,
  provider: PhotoSourceKind,
  personId: string | null
): Promise<void> {
  const data = { [COLUMN[provider]]: personId };
  await prisma.userSettings.upsert({
    where: { userId },
    update: data,
    create: { userId, data: {}, ...data },
  });
}
