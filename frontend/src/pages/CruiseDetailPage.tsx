import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { cruiseApi } from "../lib/api";
import type { Cruise } from "../types";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import { CruiseRouteMap } from "../components/Cruise/CruiseRouteMap";
import {
  buildEffectiveTimeline,
  countPortCalls,
  countUniquePorts,
  countUnresolvedPorts,
} from "../components/Cruise/cruisePorts";
import { cruiseStatusPillStyle } from "../components/Cruise/cruiseStatusStyle";
import CruiseItinerary from "../components/Cruise/CruiseItinerary";
import TripPill from "../components/Trips/TripPill";
import AppShell from "../components/ui/AppShell";
import DetailHeader from "../components/ui/DetailHeader";
import DetailKpis, { type DetailKpi } from "../components/ui/DetailKpis";
import DetailSection from "../components/ui/DetailSection";
import PeopleList from "../components/ui/PeopleList";
import { Icon } from "../components/ui/Icon";
import Button from "../components/ui/Button";
import { useDocumentCount } from "../hooks/useDocumentCount";
import { useTranslation } from "../hooks/useTranslation";
import { formatDateInTimezone } from "../lib/dateUtils";
import { formatAmount } from "../lib/units";
import { useToastStore } from "../store/toastStore";
import { cruiseExtractTarget } from "../lib/extractTargets";
import ConfirmModal from "../components/Training/ConfirmModal";
import DocumentsSection from "../components/documents/DocumentsSection";
import { countedDeleteMessage, DELETE_BUTTON_CLASS, withDocumentNote } from "../lib/deleteConfirm";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { logger } from "../lib/logger";
import TripPhotoWindowStrip from "../components/common/TripPhotoWindowStrip";

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  return formatDateInTimezone(iso, "UTC");
};

export default function CruiseDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("cruise");
  const [cruise, setCruise] = useState<Cruise | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  // Two states, not one: a 404 means the cruise is gone, anything else
  // means we could not ask. The page used to answer "nicht gefunden" to
  // both, denying a record that a dropped connection had merely hidden.
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  /** Bumped by the retry button; the fetch effect watches it. */
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [editing, setEditing] = useState<boolean>(false);
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);
  /**
   * Asked only while the confirmation is opening — `null` keeps the hook
   * silent, so reading a cruise costs the same requests it always did.
   */
  const documentCount = useDocumentCount(
    confirmingDelete && cruise ? { type: "cruise", id: cruise.id } : null
  );
  const [deleting, setDeleting] = useState<boolean>(false);
  const addToast = useToastStore((s) => s.addToast);

  const handleDelete = async (): Promise<void> => {
    if (!id) return;
    setDeleting(true);
    try {
      await cruiseApi.remove(id);
      addToast("success", t("detail.deleteSuccess"));
      navigate("/cruises");
    } catch (err: unknown) {
      logger.error("CruiseDetailPage: delete failed", err);
      addToast("error", t("detail.deleteError"));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFailure(null);
      try {
        const c = await cruiseApi.get(id);
        if (!cancelled) setCruise(c);
      } catch (err: unknown) {
        logger.error("CruiseDetailPage: failed to load cruise", err);
        if (!cancelled) setFailure(classifyLoadFailure(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  if (loading) {
    return (
      <AppShell width="list">
        <p className="text-(--text-muted)">{t("detail.loading")}</p>
      </AppShell>
    );
  }
  if (failure !== null || !cruise) {
    // A load error is a state you get out of, so it offers the retry that
    // "not found" must not pretend to have.
    const isLoadError = failure === "loadError";
    return (
      <AppShell width="reading">
        <div>
          <Link to="/cruises" className="ts-back-link text-sm text-(--text-muted)">
            ← {t("list.title")}
          </Link>
          <div
            role="alert"
            className="mt-4 rounded-md border border-(--danger)/50 bg-(--danger)/10 p-4 text-sm text-(--danger)"
          >
            {isLoadError ? t("detail.loadError") : t("detail.notFound")}
          </div>
          {isLoadError && (
            <div className="mt-3">
              <Button onClick={() => setReloadKey((k) => k + 1)}>
                {t("common:buttons.retry")}
              </Button>
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  const portsCount = countUniquePorts(cruise);
  const unresolvedCount = countUnresolvedPorts(cruise);
  const seaDays = cruise.stops.filter((s) => s.isAtSea).length;

  const shipName = cruise.ship?.name ?? cruise.shipNameOverride ?? "—";
  const nights =
    cruise.startDate && cruise.endDate
      ? Math.round(
          (Date.parse(cruise.endDate.slice(0, 10)) - Date.parse(cruise.startDate.slice(0, 10))) /
            86_400_000
        )
      : null;
  const countries = new Set(
    buildEffectiveTimeline(cruise)
      .map((entry) => entry.port?.country)
      .filter((c): c is string => Boolean(c))
  ).size;
  const price =
    cruise.price !== null
      ? formatAmount(cruise.price, cruise.currency, { language: i18n.language })
      : null;

  const kpis: DetailKpi[] = [
    ...(nights !== null && nights >= 0
      ? [{ key: "nights", value: nights, label: t("detail.nights", { count: nights }) }]
      : []),
    {
      key: "ports",
      value: (
        <>
          {portsCount}
          {unresolvedCount > 0 && (
            <span
              className="t-caption"
              style={{ marginLeft: 4 }}
              title={t("list.unresolvedPorts", { count: unresolvedCount })}
              aria-label={t("list.unresolvedPorts", { count: unresolvedCount })}
            >
              +{unresolvedCount}
            </span>
          )}
        </>
      ),
      label: `${t("field.ports", { count: portsCount })} · ${seaDays} ${t("field.sea_days", { count: seaDays })}`,
    },
    ...(countries > 0
      ? [{ key: "countries", value: countries, label: t("detail.countries", { count: countries }) }]
      : []),
    ...(price ? [{ key: "price", value: price, label: t("detail.priceKpi") }] : []),
  ];

  return (
    <AppShell width="list">
      <DetailHeader
        backTo="/cruises"
        backLabel={t("detail.backToLogbook")}
        domain="cruise"
        icon={<Icon name="ship" size={24} />}
        title={[shipName, cruise.routeName].filter(Boolean).join(" · ")}
        meta={[
          cruise.cruiseLine ?? cruise.ship?.cruiseLine,
          cruise.startDate && cruise.endDate
            ? `${fmtDate(cruise.startDate)} – ${fmtDate(cruise.endDate)}`
            : null,
          cruise.departurePort && cruise.arrivalPort
            ? `${cruise.departurePort.name} → ${cruise.arrivalPort.name}`
            : null,
          cruise.ship?.imo ? `IMO ${cruise.ship.imo}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        hero={kpis.length > 0 ? <DetailKpis items={kpis} /> : undefined}
        status={
          <span className="ts-status-pill" style={cruiseStatusPillStyle(cruise.status)}>
            {t(`status.${cruise.status}`)}
          </span>
        }
        actions={
          <>
            <Button onClick={() => setEditing(true)}>{t("detail.edit")}</Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              {t("detail.delete")}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        <div className="flex flex-col gap-6 md:col-span-3">
          <DetailSection title={t("detail.itinerary")}>
            {cruise.stops.length > 0 || cruise.departurePort ? (
              <CruiseItinerary cruise={cruise} />
            ) : (
              <p className="t-caption">{t("detail.stopsEmpty")}</p>
            )}
          </DetailSection>

          <DetailSection
            title={t("detail.cabin")}
            facts={[
              { label: t("field.cabinNumber"), value: cruise.cabinNumber, mono: true },
              {
                label: t("field.cabinType"),
                value: cruise.cabinType
                  ? t(`cabinType.${cruise.cabinType}`, { defaultValue: cruise.cabinType })
                  : null,
              },
              { label: t("field.deck"), value: cruise.deck, mono: true },
            ]}
          />

          <DetailSection
            title={t("detail.costs")}
            facts={[
              { label: t("field.price"), value: price, mono: true },
              { label: t("field.bookingReference"), value: cruise.bookingReference, mono: true },
            ]}
          />

          <DocumentsSection
            entry={{ type: "cruise", id: cruise.id }}
            extract={cruiseExtractTarget(cruise, async (updates) => {
              await cruiseApi.update(cruise.id, updates);
              addToast("success", t("documents:extract.applied"));
              setReloadKey((k) => k + 1);
            })}
          />
        </div>

        <aside className="flex flex-col gap-6 md:col-span-2">
          {cruise.trip && (
            <DetailSection title={t("trips:tab")}>
              <span data-testid="cruise-detail-trip">
                <TripPill trip={cruise.trip} />
              </span>
            </DetailSection>
          )}
          {cruise.tripId && <TripPhotoWindowStrip entry="cruises" id={cruise.id} />}

          <DetailSection title={t("detail.route")}>
            <CruiseRouteMap cruise={cruise} />
          </DetailSection>

          {cruise.companions.length > 0 && (
            <DetailSection title={t("field.companions")}>
              <PeopleList names={cruise.companions} />
            </DetailSection>
          )}

          {(cruise.tags.length > 0 || (cruise.notes !== null && cruise.notes.length > 0)) && (
            <DetailSection title={t("detail.meta")}>
              {cruise.notes !== null && cruise.notes.length > 0 && (
                <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--ts-text)" }}>
                  {cruise.notes}
                </p>
              )}
              {cruise.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {cruise.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border px-2.5 py-0.5 text-xs"
                      style={{ borderColor: "var(--ts-border)", color: "var(--ts-muted)" }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </DetailSection>
          )}
        </aside>
      </div>

      {editing && (
        <CruiseEditModal
          mode="edit"
          cruise={cruise}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setCruise(updated);
            setEditing(false);
          }}
        />
      )}

      {/* Same component, same keys and same sentence as the cruise LIST.
            The two used to disagree: the list named the ship without warning
            that it was permanent, this one warned without naming the ship,
            and neither mentioned the port calls that go with it. */}
      <ConfirmModal
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void handleDelete()}
        isLoading={deleting}
        title={t("detail.deleteConfirmTitle")}
        // Finding 3 of the write-path audit (2026-09-19): the booking
        // confirmation filed with a cruise cascades with it (`onDelete:
        // Cascade`, proven live by
        // `backend/src/__tests__/integrity/cascades.integrity.test.ts`).
        message={withDocumentNote(
          countedDeleteMessage(
            t,
            {
              counted: "cruise:detail.deleteConfirmMessage",
              empty: "cruise:detail.deleteConfirmMessageNoStops",
            },
            cruise.ship?.name ?? cruise.shipNameOverride ?? t("list.unnamedShip"),
            countPortCalls(cruise)
          ),
          t,
          documentCount
        )}
        confirmText={t("detail.deleteConfirm")}
        cancelText={t("detail.deleteCancel")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </AppShell>
  );
}
