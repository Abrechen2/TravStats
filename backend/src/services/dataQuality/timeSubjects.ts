import {
  TIME_FLAG_ENTITY_TYPES,
  type DataQualityFlagSubject,
  type TimeFlagEntityType,
} from "../../schemas/dataQualityFlag";
import { loadRowLinks } from "../timeMigration/rowLinks";

/**
 * Names for the rows a time-model question is about (ADR 0002 phase 3b), so
 * the inbox can say which flight, which port call, which visit — and link to
 * the record it is edited on — without a second request. The lookups live in
 * `timeMigration/rowLinks.ts`, shared with the admin report; here they are
 * scoped to the account, because a flag names one of the user's own rows and a
 * stranger must not be able to read its name through an id.
 */

type TimeSubject = Extract<DataQualityFlagSubject, { parentId: string | null }>;

const isTimeEntity = (type: string): type is TimeFlagEntityType =>
  (TIME_FLAG_ENTITY_TYPES as readonly string[]).includes(type);

/** Subjects keyed `"<entityType> <entityId>"`, for the flags that are time questions. */
export async function resolveTimeSubjects(
  userId: string,
  flags: ReadonlyArray<{ entityType: string; entityId: string }>
): Promise<Map<string, TimeSubject>> {
  const idsByType = new Map<TimeFlagEntityType, string[]>();
  for (const flag of flags) {
    if (!isTimeEntity(flag.entityType)) continue;
    idsByType.set(flag.entityType, [...(idsByType.get(flag.entityType) ?? []), flag.entityId]);
  }
  const subjects = new Map<string, TimeSubject>();
  for (const [entityType, ids] of idsByType) {
    for (const link of (await loadRowLinks(entityType, ids, userId)).values()) {
      subjects.set(`${entityType} ${link.id}`, {
        entityType,
        entityId: link.id,
        label: link.label,
        parentId: link.parentId,
        parentType: link.parentType,
        tripId: link.tripId,
      });
    }
  }
  return subjects;
}
