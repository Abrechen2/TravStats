import { useCallback, useMemo, useState } from "react";
import { tripsApi } from "../../lib/api";
import type { ProposedTrip, ProposedTripLeg } from "../../lib/api/trips";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

/** The project wrapper narrows i18next's `t` to this signature. */
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

interface DetectReviewModalProps {
  proposals: ProposedTrip[];
  onClose: () => void;
  onCommitted: () => void;
}

interface ProposalState {
  selected: boolean;
  name: string;
}

const HEURISTIC_LABEL: Record<ProposedTrip["source"], string> = {
  pnr: "PNR",
  home_loop: "Home-Loop",
  continuity: "Continuity",
};

const HEURISTIC_COLOR: Record<ProposedTrip["source"], { bg: string; color: string }> = {
  pnr: { bg: "rgba(74,222,128,0.15)", color: "#86efac" },
  home_loop: { bg: "rgba(96,165,250,0.15)", color: "#93c5fd" },
  continuity: { bg: "rgba(240,169,71,0.15)", color: "#f0a947" },
};

// Per-status chip styling for the expanded leg rows. Unknown statuses
// fall back to a neutral grey so the chip always renders.
const LEG_STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  flown: { bg: "rgba(74,222,128,0.15)", color: "#86efac" },
  scheduled: { bg: "rgba(96,165,250,0.15)", color: "#93c5fd" },
  cancelled: { bg: "rgba(248,113,113,0.15)", color: "#fca5a5" },
};
const LEG_STATUS_FALLBACK = { bg: "rgba(148,163,184,0.15)", color: "var(--text-muted)" };

/**
 * Stable per-proposal key. Proposals have no id, but their `flightIds`
 * uniquely identify the grouping, so we join them for the expansion map.
 */
function proposalKey(p: ProposedTrip): string {
  return p.flightIds.join(",");
}

/**
 * Per-proposal review flow (Phase-1 iteration 5). The DetectTripsBanner
 * used to commit ALL auto-detected proposals at once via a single
 * "Link all" button — that's now an opt-in UX in this modal: the user
 * sees each proposal individually, can toggle accept/reject, edit the
 * suggested name, and only the kept proposals are committed.
 */
export default function DetectReviewModal({
  proposals,
  onClose,
  onCommitted,
}: DetectReviewModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [state, setState] = useState<ProposalState[]>(() =>
    proposals.map((p) => ({ selected: true, name: p.suggestedName }))
  );
  const [committing, setCommitting] = useState(false);
  // Expanded proposals tracked by their stable flightIds key — multiple
  // cards may be open at once. Collapsed by default.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggleExpanded = useCallback((key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectedCount = useMemo(() => state.filter((s) => s.selected).length, [state]);
  const allSelected = selectedCount === state.length && state.length > 0;
  const totalFlights = useMemo(
    () =>
      proposals.reduce((sum, p, idx) => sum + (state[idx]?.selected ? p.flightIds.length : 0), 0),
    [proposals, state]
  );

  const toggleAll = (): void => {
    setState((prev) => prev.map((s) => ({ ...s, selected: !allSelected })));
  };

  const togglePart = (i: number): void => {
    setState((prev) => prev.map((s, idx) => (idx === i ? { ...s, selected: !s.selected } : s)));
  };

  const renamePart = (i: number, name: string): void => {
    setState((prev) => prev.map((s, idx) => (idx === i ? { ...s, name } : s)));
  };

  const handleCommit = async (): Promise<void> => {
    const selected = proposals
      .map((p, idx) => ({ p, s: state[idx] }))
      .filter(({ s }) => s.selected && s.name.trim().length > 0);
    if (selected.length === 0) return;
    setCommitting(true);
    try {
      const res = await tripsApi.detect({
        dryRun: false,
        selectedProposals: selected.map(({ p, s }) => ({
          flightIds: p.flightIds,
          name: s.name.trim(),
          pnr: p.pnr,
          source: p.source,
        })),
      });
      addToast(
        "success",
        t("trips:detectBanner.success", {
          trips: res.created.length,
          flights: res.created.reduce((sum, c) => sum + c.flightIds.length, 0),
          orphans: res.orphansRemoved,
        })
      );
      onCommitted();
    } catch {
      addToast("error", t("trips:detectBanner.error"));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-3xl rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div
          className="flex items-center justify-between p-5"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div>
            <h2 className="text-lg font-display font-semibold">
              {t("trips:detectReview.title", { defaultValue: "Reisen erkennen" })}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {t("trips:detectReview.subtitle", {
                count: proposals.length,
                defaultValue: "{{count}} Vorschläge — wähle, was zu Reisen werden soll.",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ color: "var(--text-muted)" }}
            aria-label={t("common:accessibility.close")}
          >
            ✕
          </button>
        </div>

        <div
          className="px-5 py-3 flex items-center gap-3"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <Toggle
            checked={allSelected}
            onClick={toggleAll}
            indeterminate={!allSelected && selectedCount > 0}
          />
          <strong className="text-sm">
            {t("trips:detectReview.selectAll", { defaultValue: "Alle auswählen" })}
          </strong>
          <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>
            {t("trips:detectReview.summary", {
              trips: selectedCount,
              flights: totalFlights,
              defaultValue: "{{trips}} ausgewählt · {{flights}} Flüge werden zugeordnet",
            })}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {proposals.map((p, i) => {
            const s = state[i];
            const heur = HEURISTIC_COLOR[p.source];
            const key = proposalKey(p);
            const isOpen = expanded.has(key);
            const hasLegs = p.legs.length > 0;
            const panelId = `detect-legs-${i}`;
            return (
              <div
                key={`${p.source}-${i}`}
                className="rounded-xl p-3 transition-opacity"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--color-border)",
                  opacity: s.selected ? 1 : 0.45,
                }}
              >
                <div className="flex items-center gap-3">
                  <Toggle checked={s.selected} onClick={() => togglePart(i)} />
                  <RoutePreview proposal={p} />
                  <div className="flex-1 min-w-0">
                    <input
                      value={s.name}
                      onChange={(e) => renamePart(i, e.target.value)}
                      className="w-full bg-transparent border-0 text-sm font-semibold outline-hidden focus:bg-(--bg-base) focus:px-2 focus:py-1 focus:rounded-sm"
                      style={{ color: "var(--text-primary)" }}
                    />
                    <div
                      className="flex items-center gap-2 mt-1 text-[11px] flex-wrap"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span
                        className="px-1.5 py-0.5 rounded-full uppercase tracking-wide font-semibold"
                        style={{ background: heur.bg, color: heur.color }}
                      >
                        {HEURISTIC_LABEL[p.source]}
                        {p.pnr && ` · ${p.pnr}`}
                      </span>
                      <span>
                        {p.flightIds.length} {p.flightIds.length === 1 ? "Flug" : "Flüge"}
                      </span>
                      <span>
                        · {p.origin} → {p.destination}
                      </span>
                      {p.span?.from && p.span?.to && (
                        <span>
                          · {p.span.from} – {p.span.to}
                        </span>
                      )}
                    </div>
                  </div>
                  {hasLegs && (
                    <button
                      type="button"
                      onClick={(e) => {
                        // Keep expansion independent from selection: the
                        // chevron lives in the same row as the checkbox,
                        // so stop the click before it can bubble anywhere.
                        e.stopPropagation();
                        toggleExpanded(key);
                      }}
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors hover:bg-(--bg-base)"
                      style={{ color: "var(--text-muted)" }}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      aria-label={
                        isOpen
                          ? t("trips:detectReview.collapseLegs", {
                              defaultValue: "Flüge ausblenden",
                            })
                          : t("trips:detectReview.expandLegs", { defaultValue: "Flüge anzeigen" })
                      }
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="w-4 h-4 transition-transform"
                        style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 6l4 4 4-4" />
                      </svg>
                    </button>
                  )}
                </div>
                {hasLegs && isOpen && <LegList id={panelId} legs={p.legs} t={t} />}
              </div>
            );
          })}
        </div>

        <div
          className="flex items-center justify-between p-4 gap-3"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={committing}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("trips:detectReview.discard", { defaultValue: "Verwerfen" })}
          </button>
          <button
            type="button"
            onClick={() => void handleCommit()}
            disabled={selectedCount === 0 || committing}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-(--accent) text-(--bg-base) disabled:opacity-50"
          >
            {committing
              ? t("common:loading.default")
              : `✓ ${t("trips:detectReview.commit", {
                  count: selectedCount,
                  defaultValue: "{{count}} Reisen erstellen",
                })}`}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onClick: () => void;
  indeterminate?: boolean;
}

function Toggle({ checked, onClick, indeterminate }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Selection is fully independent from card expansion — never let
        // a checkbox click bubble up to any surrounding expand handler.
        e.stopPropagation();
        onClick();
      }}
      className="w-6 h-6 rounded-md flex items-center justify-center transition-colors shrink-0"
      style={{
        background: checked || indeterminate ? "var(--accent)" : "transparent",
        border: `2px solid ${checked || indeterminate ? "var(--accent)" : "var(--color-border)"}`,
        color: "#000",
      }}
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
    >
      {checked && "✓"}
      {!checked && indeterminate && (
        <span className="block w-2 h-0.5" style={{ background: "#000" }} />
      )}
    </button>
  );
}

interface RoutePreviewProps {
  proposal: ProposedTrip;
}

function RoutePreview({ proposal }: RoutePreviewProps): JSX.Element {
  // Tiny SVG sketch — three dots + curved path. Doesn't need real
  // coordinates; visually distinguishes the proposals from each other.
  const n = Math.min(proposal.flightIds.length + 1, 6);
  const dots: number[] = Array.from({ length: n }, (_, i) => i);
  const heur = HEURISTIC_COLOR[proposal.source];
  return (
    <div
      className="w-24 h-14 rounded-lg shrink-0 flex items-center justify-center"
      style={{ background: "var(--bg-base)" }}
    >
      <svg viewBox="0 0 96 56" className="w-full h-full">
        <path
          d="M 8 40 Q 48 8 88 40"
          stroke={heur.color}
          strokeWidth="1.5"
          fill="none"
          strokeDasharray={proposal.source === "continuity" ? "3,2" : undefined}
        />
        {dots.map((i) => {
          const x = 8 + (i / Math.max(1, n - 1)) * 80;
          const t = i / Math.max(1, n - 1);
          // Approximate the path curve so dots sit on it
          const y = 40 - 32 * 4 * t * (1 - t);
          return <circle key={i} cx={x} cy={y} r="2.5" fill={heur.color} />;
        })}
        <text x="6" y="52" fontSize="7" fill="var(--text-muted)">
          {proposal.origin}
        </text>
        <text x="74" y="52" fontSize="7" fill="var(--text-muted)">
          {proposal.destination}
        </text>
      </svg>
    </div>
  );
}

interface LegListProps {
  id: string;
  legs: ProposedTripLeg[];
  t: TranslateFn;
}

/**
 * Compact per-leg breakdown shown when a proposal card is expanded.
 * One row per leg, already ordered by departure time upstream.
 */
function LegList({ id, legs, t }: LegListProps): JSX.Element {
  return (
    <ul
      id={id}
      className="mt-3 pt-3 space-y-1 list-none"
      style={{ borderTop: "1px solid var(--color-border)" }}
    >
      {legs.map((leg, idx) => {
        const chip = LEG_STATUS_COLOR[leg.status] ?? LEG_STATUS_FALLBACK;
        const statusLabel = t(`trips:detectReview.legStatus.${leg.status}`, {
          defaultValue: leg.status,
        });
        return (
          <li
            key={`${leg.date}-${leg.flightNumber ?? "?"}-${idx}`}
            className="flex items-center gap-2 text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            <span className="tabular-nums shrink-0">{leg.date}</span>
            <span className="font-semibold shrink-0" style={{ color: "var(--text-primary)" }}>
              {leg.flightNumber ?? "—"}
            </span>
            <span className="truncate">
              {leg.depIata ?? "—"} → {leg.arrIata ?? "—"}
            </span>
            <span
              className="ml-auto px-1.5 py-0.5 rounded-full uppercase tracking-wide font-semibold shrink-0"
              style={{ background: chip.bg, color: chip.color }}
            >
              {statusLabel}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
