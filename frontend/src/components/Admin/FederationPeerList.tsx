import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { FederationPeer } from "../../lib/api/federationAdmin";
import { Button } from "../ui";

/** The servers this one is connected to: when each was last reached, and the two row actions. */
export default function FederationPeerList({
  peers,
  busy,
  locked,
  onVerify,
  onRemove,
}: {
  peers: FederationPeer[];
  busy: boolean;
  locked: boolean;
  onVerify: (origin: string) => void;
  onRemove: (origin: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const fmt = useDisplayFormat();
  if (peers.length === 0)
    return (
      <p className="t-caption" style={{ margin: 0 }}>
        {t("federation.peerListEmpty")}
      </p>
    );
  return (
    <ul
      data-testid="federation-peer-list"
      className="flex flex-col"
      style={{ gap: "var(--ts-space-sm)", margin: 0, padding: 0, listStyle: "none" }}
    >
      {peers.map((p) => (
        <li
          key={p.origin}
          className="flex flex-wrap items-center justify-between"
          style={{ gap: "var(--ts-space-md)" }}
        >
          <span className="flex min-w-0 flex-col">
            <span className="break-all">{p.origin}</span>
            <span className="t-caption">
              {!p.enabled
                ? t("federation.checklist.peerSuspended")
                : p.verifiedAt
                  ? t("federation.verifiedAt", { date: fmt.date(p.verifiedAt) }) +
                    (p.leaderboardVersions.includes(1) ? "" : ` · ${t("federation.outdated")}`)
                  : t("federation.unverified")}
            </span>
          </span>
          <span className="flex" style={{ gap: "var(--ts-space-xs)" }}>
            <Button
              variant="secondary"
              disabled={busy || locked}
              onClick={() => onVerify(p.origin)}
            >
              {t("federation.verify")}
            </Button>
            <Button variant="danger" disabled={busy || locked} onClick={() => onRemove(p.origin)}>
              {t("federation.remove")}
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
