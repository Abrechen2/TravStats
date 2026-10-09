import type { DbTransaction } from "../../../db";
import type { Lodging, LodgingStay, Prisma } from "../../../prisma";
import { deriveLodgingStatus } from "../../../shared/statusDerivation";
import { SHARED_SOURCE } from "../copyEntries";
import {
  LODGING_FACT_FIELDS,
  LODGING_STAY_FACT_FIELDS,
  isSameHouse,
  lodgingFacts,
  lodgingStayFacts,
  pickFacts,
  type LodgingFactField,
  type LodgingStayFactField,
} from "../facts";
import { plainData, type EntityAdapter, type SharedRow } from "./types";

/**
 * A stay and its house. The house travels as one pseudo-fact, `lodging`: the
 * house's own facts plus the catalogue chain it belongs to, if any (a chain a
 * user made is their row and never crosses accounts).
 */

type HouseFacts = Pick<Lodging, LodgingFactField> & { catalogueChainId: number | null };

const HOUSE_SELECT = {
  id: true,
  name: true,
  lat: true,
  lon: true,
  city: true,
  country: true,
  isoCountryCode: true,
} as const;

type StayWithHouse = LodgingStay & {
  lodging: Lodging & { chain: { userId: string | null } | null };
};

function stayRow(row: StayWithHouse): SharedRow {
  const house: HouseFacts = {
    ...pickFacts(row.lodging, LODGING_FACT_FIELDS),
    catalogueChainId:
      row.lodging.chain && row.lodging.chain.userId === null ? row.lodging.chainId : null,
  };
  return {
    id: row.id,
    userId: row.userId,
    tripId: row.tripId,
    shareKey: row.shareKey,
    facts: { ...pickFacts(row, LODGING_STAY_FACT_FIELDS), lodging: house },
    label: row.lodging.name,
    zones: {
      checkInAt: row.stayZone,
      checkOutAt: row.stayZone,
      checkInDate: row.stayZone,
      checkOutDate: row.stayZone,
    },
  };
}

const INCLUDE = { lodging: { include: { chain: { select: { userId: true } } } } } as const;

/**
 * The recipient's row for `house`: one of their own lodgings when it is the
 * same house (`isSameHouse`, name AND place), otherwise a new lodging made of
 * the house's facts. `preferId` is checked first, so a stay already filed
 * under the right house keeps it.
 */
async function houseFor(
  c: DbTransaction,
  recipientId: string,
  house: HouseFacts,
  preferId: string | null
): Promise<{ id: string; reused: boolean }> {
  const candidates = await c.lodging.findMany({
    where: { userId: recipientId },
    select: HOUSE_SELECT,
    orderBy: { createdAt: "asc" },
  });
  const preferred = candidates.find((l) => l.id === preferId && isSameHouse(l, house));
  const match = preferred ?? candidates.find((l) => isSameHouse(l, house));
  if (match) return { id: match.id, reused: true };
  const { catalogueChainId, ...facts } = house;
  const created = await c.lodging.create({
    data: {
      ...lodgingFacts(facts),
      userId: recipientId,
      chainId: catalogueChainId,
      dataSource: SHARED_SOURCE,
    },
    select: { id: true },
  });
  return { id: created.id, reused: false };
}

/** The copy's status re-derived from its dates after the write (the column is a cache). */
function derivedStatus(data: Prisma.LodgingStayUncheckedUpdateInput, current: SharedRow): string {
  const value = (key: "checkIn" | "checkOut" | "status") =>
    key in data ? (data as Record<string, unknown>)[key] : current.facts[key];
  return deriveLodgingStatus({
    checkIn: value("checkIn") as Date | null,
    checkOut: value("checkOut") as Date | null,
    current: value("status") as string,
  });
}

export const lodgingStayAdapter: EntityAdapter = {
  entity: "lodgingStay",
  fields: [...LODGING_STAY_FACT_FIELDS, "lodging"],
  async load(c, ids) {
    const rows = await c.lodgingStay.findMany({
      where: { id: { in: [...ids] } },
      include: INCLUDE,
    });
    return rows.map(stayRow);
  },
  async copiesOf(c, shareKey, groupId) {
    const rows = await c.lodgingStay.findMany({
      where: { shareKey, trip: { shareGroupId: groupId } },
      include: INCLUDE,
    });
    return rows.map(stayRow);
  },
  async setKey(c, id, key) {
    await c.lodgingStay.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const facts = source.facts as Pick<LodgingStay, LodgingStayFactField>;
    const house = await houseFor(c, recipientId, source.facts.lodging as HouseFacts, null);
    const copy = await c.lodgingStay.create({
      data: {
        ...lodgingStayFacts(facts),
        // A cache of the dates (`shared/statusDerivation.ts`), derived afresh.
        status: deriveLodgingStatus({
          checkIn: facts.checkIn,
          checkOut: facts.checkOut,
          current: facts.status,
        }),
        lodgingId: house.id,
        userId: recipientId,
        tripId: recipientTripId,
        shareKey: source.shareKey,
        dataSource: SHARED_SOURCE,
      },
      select: { id: true },
    });
    return copy.id;
  },
  async apply(c, copy, values, keys) {
    const data = plainData(
      values,
      keys,
      LODGING_STAY_FACT_FIELDS
    ) as Prisma.LodgingStayUncheckedUpdateInput;
    if (["checkIn", "checkOut", "status"].some((k) => keys.includes(k))) {
      data.status = derivedStatus(data, copy);
    }
    if (keys.includes("lodging")) {
      const house = values.lodging as HouseFacts;
      const stay = await c.lodgingStay.findUniqueOrThrow({
        where: { id: copy.id },
        select: { lodgingId: true },
      });
      const target = await houseFor(c, copy.userId, house, stay.lodgingId);
      if (target.id === stay.lodgingId) {
        // The same house: its facts follow (a corrected address, a website).
        const { catalogueChainId: _chain, ...facts } = house;
        await c.lodging.update({ where: { id: target.id }, data: lodgingFacts(facts) });
      } else {
        data.lodgingId = target.id;
      }
    }
    if (Object.keys(data).length > 0) {
      await c.lodgingStay.update({ where: { id: copy.id }, data });
    }
  },
  async remove(c, id) {
    await c.lodgingStay.delete({ where: { id } });
  },
};
