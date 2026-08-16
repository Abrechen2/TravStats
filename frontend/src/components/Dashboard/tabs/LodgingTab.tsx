import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { useTranslation } from "../../../hooks/useTranslation";
import { getLodgingStats, listLodgings } from "../../../lib/api/lodging";
import { logger } from "../../../lib/logger";
import { loadMapAppearance, saveMapAppearance } from "../../map/mapAppearance";
import {
  intervalOverlapsRange,
  useDashboardFilterStore,
} from "../../../store/dashboardFilterStore";
import type { Lodging, LodgingStats } from "../../../types/lodging";
import MapContainer3D from "../../MapContainer3D";
import { LodgingListPanel } from "../sidebars/LodgingListPanel";
import { DomainDisabledNotice } from "./DomainDisabledNotice";
import { LodgingChainsView } from "./lodging/LodgingChainsView";
import { LodgingNightsChart } from "./lodging/LodgingNightsChart";

export function LodgingTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const navigate = useNavigate();
  const { isEnabled } = useEnabledDomains();
  const lodgingEnabled = isEnabled("lodging");
  const { t } = useTranslation(["dashboard"]);
  const [lodgings, setLodgings] = useState<Lodging[]>([]);
  const [stats, setStats] = useState<LodgingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Open by default (unlike CruisesTab's hidden-by-default sidebar) — the
  // list is one of this tab's three core surfaces (map + stat strip + list),
  // not an optional extra.
  /**
   * The list panel remembers whether it was open.
   *
   * It used to start open on every mount, and switching domain remounts the
   * tab — so it sprang open again every single time, undoing the choice the
   * user had just made. Stored next to the rest of the map appearance, which
   * is where the map control panel's own expanded state already lives.
   */
  const [sidebarOpen, setSidebarOpenState] = useState<boolean>(
    () => loadMapAppearance().lodgingListOpen ?? true
  );
  const setSidebarOpen = useCallback((open: boolean | ((prev: boolean) => boolean)): void => {
    setSidebarOpenState((prev) => {
      const next = typeof open === "function" ? open(prev) : open;
      saveMapAppearance({ lodgingListOpen: next });
      return next;
    });
  }, []);

  const loadLodgings = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const [list, lodgingStats] = await Promise.all([listLodgings({}), getLodgingStats()]);
      setLodgings(list);
      setStats(lodgingStats);
    } catch (err: unknown) {
      logger.error({ err }, "LodgingTab: failed to load lodgings");
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Domain-gating: never fetch lodging data while the domain is disabled —
  // the tab renders the DomainDisabledNotice stub instead (see below).
  useEffect(() => {
    if (!lodgingEnabled) return;
    void loadLodgings();
  }, [lodgingEnabled, loadLodgings]);

  // Clicking a map pin opens the lodging's detail page — same route
  // LodgingListPage/LodgingChainDetailPage already navigate to on a row
  // click (`/lodging/:id`, registered in App.tsx).
  const handleLodgingPinClick = useCallback(
    (lodgingId: string): void => {
      navigate(`/lodging/${lodgingId}`);
    },
    [navigate]
  );

  // Apply the global year filter to the map/list view: a lodging stays
  // visible if ANY of its stays overlaps the selected range. The stat strip
  // and the nights/chains views deliberately do NOT re-derive themselves
  // from this filtered subset — they're built from numbers the backend
  // already aggregated across the lodging's/user's full history
  // (getLodgingStats has no year param, and each Lodging's own
  // stayCount/nights/totalSpendBase cover all of its stays, not just the
  // ones in range), so partially filtering them would silently misrepresent
  // those totals rather than really filter them.
  const filterTime = useDashboardFilterStore((s) => s.time);
  const visibleLodgings = useMemo<Lodging[]>(() => {
    if (!filterTime.from && !filterTime.to) return lodgings;
    return lodgings.filter((lodging) =>
      lodging.stays.some(
        (stay) =>
          // An undated stay overlaps no range: it is not known which days it
          // occupied. It reappears the moment the time filter is cleared,
          // rather than being shown under a range it may not belong to.
          stay.checkIn !== null &&
          stay.checkOut !== null &&
          intervalOverlapsRange(stay.checkIn, stay.checkOut, filterTime.from, filterTime.to)
      )
    );
  }, [lodgings, filterTime.from, filterTime.to]);

  if (!lodgingEnabled) {
    return <DomainDisabledNotice domain="lodging" />;
  }

  const hasData = !loading && !loadError && lodgings.length > 0;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* Only the lodging appearance section (marker-size slider) — no
          flight/cruise controls, since this tab renders neither of those
          domains. Mirrors how CruisesTab/FlightsTab scope their own domain. */}
      <MapContainer3D
        flights={[]}
        visMode="routes"
        lodgingsOverride={visibleLodgings}
        onLodgingClick={handleLodgingPinClick}
        appearanceDomains={["lodging"]}
        // Without this the map fetches and draws every cruise route on top of the
        // hotel pins (showInternalCruises defaults to true).
        showInternalCruises={false}
      />

      <button
        type="button"
        onClick={() => setSidebarOpen((prev) => !prev)}
        style={{
          position: "absolute",
          top: 12,
          left: sidebarOpen ? 340 : 12,
          zIndex: 30,
          padding: "6px 12px",
          borderRadius: 10,
          background: "rgba(22,27,34,0.85)",
          color: "var(--text-primary)",
          border: "1px solid var(--color-border)",
          cursor: "pointer",
        }}
      >
        ☰ {t("dashboard:lodgingTab.listTitle")}
      </button>
      <LodgingListPanel
        lodgings={visibleLodgings}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* The stat strip and the currency breakdown used to sit HERE, floating
          over the map. They are statistics, not map controls: 291 hotels, 176
          nights and a per-currency breakdown tell you nothing about what you
          are looking at and cover the part of the world you came to see. They
          now live on the statistics page, where the rest of the numbers are. */}
      {hasData && mode === "nights" && stats && (
        <LodgingNightsChart nightsByMonth={stats.nightsByMonth} />
      )}
      {hasData && mode === "chains" && <LodgingChainsView lodgings={visibleLodgings} />}

      {loading && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            padding: "6px 14px",
            borderRadius: 10,
            background: "rgba(22,27,34,0.85)",
            color: "var(--text-muted)",
            border: "1px solid var(--color-border)",
            fontSize: 13,
          }}
        >
          {t("dashboard:lodgingTab.loading")}
        </div>
      )}
      {!loading && loadError && (
        <div
          role="alert"
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            padding: "8px 16px",
            borderRadius: 10,
            background: "rgba(60,20,20,0.92)",
            color: "var(--danger)",
            border: "1px solid var(--danger)",
            fontSize: 13,
          }}
        >
          {t("dashboard:errors.loadLodgings")}
        </div>
      )}
      {!loading && !loadError && lodgings.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              maxWidth: 420,
              textAlign: "center",
              padding: "28px 32px",
              borderRadius: 16,
              background: "rgba(22,27,34,0.92)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>
              🏨
            </div>
            <h2 style={{ margin: "0 0 8px", color: "var(--text-primary)", fontSize: 18 }}>
              {t("dashboard:lodgingTab.emptyTitle")}
            </h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>
              {t("dashboard:lodgingTab.emptyBody")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
