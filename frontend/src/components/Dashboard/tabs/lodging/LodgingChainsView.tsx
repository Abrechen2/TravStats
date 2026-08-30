import { useMemo } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../../hooks/useTranslation";

import { ChainNameLink } from "../../../lodging/ChainNameLink";
import type { Lodging } from "../../../../types/lodging";
import { useDomainColors } from "../../../../hooks/useDomainColors";

interface LodgingChainsViewProps {
  lodgings: readonly Lodging[];
}

interface ChainSummary {
  key: string;
  id: number | null;
  name: string;
  color: string | null;
  hotelCount: number;
  stayCount: number;
  nights: number;
}

const INDEPENDENT_KEY = "independent";

/**
 * Groups the already-fetched lodging list by chain, summing each lodging's
 * `stayCount`/`nights` — both are per-lodging aggregates the backend already
 * computed (`computeAggregates` in routes/lodging.ts). This only re-groups
 * those numbers by chain; it never re-derives them from raw stays.
 */
function groupByChain(lodgings: readonly Lodging[], independentLabel: string): ChainSummary[] {
  const byKey = new Map<string, ChainSummary>();
  for (const lodging of lodgings) {
    const key = lodging.chain ? `chain-${lodging.chain.id}` : INDEPENDENT_KEY;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        hotelCount: existing.hotelCount + 1,
        stayCount: existing.stayCount + lodging.stayCount,
        nights: existing.nights + lodging.nights,
      });
    } else {
      byKey.set(key, {
        key,
        id: lodging.chain?.id ?? null,
        name: lodging.chain?.name ?? independentLabel,
        color: lodging.chain?.brandColor ?? null,
        hotelCount: 1,
        stayCount: lodging.stayCount,
        nights: lodging.nights,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.nights - a.nights);
}

/** "Stays per chain" mode — a simple proportional-bar list, no new chart dependency. */
export function LodgingChainsView({ lodgings }: LodgingChainsViewProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const { colorOf } = useDomainColors();
  const independentLabel = t("dashboard:lodgingTab.independentChain");
  const chains = useMemo(
    () => groupByChain(lodgings, independentLabel),
    [lodgings, independentLabel]
  );
  const maxNights = Math.max(1, ...chains.map((c) => c.nights));

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        right: 12,
        maxWidth: 640,
        maxHeight: 320,
        overflowY: "auto",
        zIndex: 25,
        padding: 16,
        borderRadius: 12,
        // Solid, not translucent — this card sits over the map's own
        // bottom-left FlatMapControlPanel; a translucent background let
        // its text bleed through as faded ghost text underneath.
        background: "var(--bg-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      <h3 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-primary)" }}>
        {t("dashboard:lodgingTab.chainsViewTitle")}
      </h3>
      {chains.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
          {t("dashboard:lodgingTab.chainsViewEmpty")}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {chains.map((chain) => (
            <div key={chain.key}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--text-primary)",
                }}
              >
                <span>
                  {chain.id !== null ? (
                    <ChainNameLink chainId={chain.id} name={chain.name} />
                  ) : (
                    chain.name
                  )}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {t("lodging:field.staysCount", { count: chain.stayCount })} ·{" "}
                  {t("lodging:field.nightsCount", { count: chain.nights })}
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: "var(--color-border)",
                  marginTop: 4,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    borderRadius: 3,
                    width: `${(chain.nights / maxNights) * 100}%`,
                    background: chain.color ?? colorOf("lodging"),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
