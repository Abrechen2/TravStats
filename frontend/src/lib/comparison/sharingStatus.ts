import type { Link } from "../api/comparison";
export interface PublicationStatus {
  id: string;
  linkId: string;
  audience: string;
  revision: number;
  ready: boolean;
  createdAt: string;
  expiresAt: string;
}
export function sharingStatus(
  link: Link,
  grant: Link["grants"][number],
  publications: PublicationStatus[],
  now = Date.now()
) {
  const latest = publications
    .filter((p) => p.linkId === link.id && p.audience === grant.audience && p.ready)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const state =
    !grant.active || !link.confirmed || !link.remoteConfirmed
      ? "revoked"
      : grant.scope.expiresAt && Date.parse(grant.scope.expiresAt) <= now
        ? "expired"
        : !latest || latest.revision !== grant.revision
          ? "unpublished"
          : Date.parse(latest.expiresAt) <= now
            ? "expired"
            : "published";
  return { state, latest };
}
