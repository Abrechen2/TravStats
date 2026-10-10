import type { EvidenceDomain, EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { DomainRecord } from "../../schemas/statsDomainRecords";
import { loadDomainRecords } from "../stats/domainRecords";
import type { PagingParams } from "./paging";
import { domainSumEvidence, requireLifetime } from "./domainMeasureResponse";

/**
 * The travel records of the overview (forgejo#265, `GET /stats/domain-records`)
 * — one measure per record, each answered by the record's own witness: the
 * entry that holds it, contributing the record's value. Release 1 serves `sum`
 * and `distinct` only, and a one-row sum is exactly an extremum's evidence.
 * The value is the endpoint's own (`loadDomainRecords`), visibility included:
 * a domain the user does not see has no record and answers no figure.
 */
export const DOMAIN_RECORD_KEYS: Record<
  DomainRecord["id"],
  { key: string; unit: DomainRecord["unit"] }
> = {
  "longest-cruise": { key: "recordLongestCruise", unit: "days" },
  "longest-stay": { key: "recordLongestStay", unit: "nights" },
  "most-visited-place": { key: "recordMostVisitedPlace", unit: "visits" },
  "longest-roadtrip": { key: "recordLongestRoadtrip", unit: "days" },
  "longest-rail-ride": { key: "recordLongestRailRide", unit: "km" },
  "longest-rental": { key: "recordLongestRental", unit: "days" },
  "longest-bus-ride": { key: "recordLongestBusRide", unit: "km" },
};

const EVIDENCE_DOMAIN: Record<DomainRecord["domain"], EvidenceDomain> = {
  cruise: "cruise",
  lodging: "lodging",
  poi: "place",
  roadtrip: "roadtrip",
  rail: "rail",
  rental: "rental",
  bus: "bus",
};

function recordResolver(id: DomainRecord["id"], key: string, unit: string) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    requireLifetime(scope, key);
    const record = (await loadDomainRecords(userId)).find((r) => r.id === id) ?? null;
    const entries = record
      ? [
          {
            domain: EVIDENCE_DOMAIN[record.domain],
            id: record.entryId,
            href: record.href,
            title: { text: record.label ?? "" },
            subtitle: null,
            date: null,
            contribution: record.value,
          },
        ]
      : [];
    return domainSumEvidence({
      key,
      unit,
      scope,
      page,
      entries,
      value: record?.value ?? null,
    });
  };
}

export const DOMAIN_RECORD_RESOLVERS = Object.fromEntries(
  (
    Object.entries(DOMAIN_RECORD_KEYS) as Array<[DomainRecord["id"], { key: string; unit: string }]>
  ).map(([id, { key, unit }]) => [key, recordResolver(id, key, unit)])
);
