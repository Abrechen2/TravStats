import type { BulkRow } from "./useRowSelection";

/**
 * What each domain's list row hands the bulk edit (forgejo#405 A4): the fields
 * the edit reads to count, the `updatedAt` it conditions on, and the words the
 * failure list names the row by. Structural types, so the lists keep their own.
 */

interface Ride {
  id: string;
  depStationName: string;
  arrStationName: string;
  operator: string | null;
  status: string;
  tags: string[];
  companions: string[];
  tripId: string | null;
  updatedAt: string;
}

const common = (r: {
  id: string;
  status: string;
  tags?: string[];
  companions: string[];
  tripId: string | null;
  updatedAt: string;
}) => ({
  id: r.id,
  status: r.status,
  tags: r.tags,
  companions: r.companions,
  tripId: r.tripId,
  updatedAt: r.updatedAt,
});

export const railBulkRow = (r: Ride & { travelClass: string | null }): BulkRow => ({
  ...common(r),
  label: `${r.depStationName} → ${r.arrStationName}`,
  operator: r.operator,
  serviceClass: r.travelClass,
});

export const busFerryBulkRow = (r: Ride & { fareClass: string | null }): BulkRow => ({
  ...common(r),
  label: `${r.depStationName} → ${r.arrStationName}`,
  operator: r.operator,
  serviceClass: r.fareClass,
});

export const rentalBulkRow = (r: {
  id: string;
  provider: string;
  pickupStationName: string;
  status: string;
  tags: string[];
  companions: string[];
  tripId: string | null;
  updatedAt: string;
}): BulkRow => ({ ...common(r), label: `${r.provider}, ${r.pickupStationName}` });

export const cruiseBulkRow = (r: {
  id: string;
  routeName: string | null;
  cruiseLine: string | null;
  shipNameOverride: string | null;
  ship: { name: string } | null;
  status: string;
  tags: string[];
  companions: string[];
  tripId: string | null;
  updatedAt: string;
}): BulkRow => ({
  ...common(r),
  label: r.routeName ?? r.ship?.name ?? r.shipNameOverride ?? r.cruiseLine ?? r.id,
});

export const stayBulkRow = (r: {
  id: string;
  lodging: { name: string };
  status: string;
  companions: string[];
  tripId: string | null;
  updatedAt: string;
}): BulkRow => ({ ...common(r), label: r.lodging.name });
