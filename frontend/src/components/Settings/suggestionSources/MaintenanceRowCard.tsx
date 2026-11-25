import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import Button from "../../ui/Button";
import { Input } from "../../ui/Field";
import { searchPlaces, type PlaceSearchResult } from "../../../lib/api/geo";
import type {
  MaintenanceProposal,
  MaintenanceRow,
  MaintenanceSource,
} from "../../../lib/api/suggestionPlugins";

const NS = "suggestionSources:plugins.maintenance";

/** A position the user may take over, from a proposal or a search hit. */
export interface Choice {
  lat: number;
  lon: number;
  street?: string;
  label: string;
  source: MaintenanceSource;
}

type Search =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "failed" }
  | { status: "done"; results: PlaceSearchResult[] };

const hitLabel = (h: PlaceSearchResult) =>
  [h.name, h.address, h.city, h.country].filter(Boolean).join(", ");

/** One archive row: its issues, its proposals, and the three actions. */
export default function MaintenanceRowCard({
  row,
  selected,
  busy,
  onSelect,
  onTake,
  onIgnore,
}: {
  row: MaintenanceRow;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onTake: (choice: Choice) => void;
  onIgnore: (ignored: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation(["suggestionSources"]);
  const fmt = useDisplayFormat();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState(() => [row.name, row.town].filter(Boolean).join(" "));
  const [search, setSearch] = useState<Search>({ status: "idle" });
  const address = [row.street, [row.postcode, row.town].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  const runSearch = async () => {
    setSearch({ status: "searching" });
    try {
      const r = await searchPlaces(query.trim());
      // A failed geocoder is not "no matches" (#263).
      if (r.degraded) {
        console.warn("maintenance address search: geocoder degraded");
        setSearch({ status: "failed" });
      } else setSearch({ status: "done", results: r.results.slice(0, 5) });
    } catch (e) {
      console.warn("maintenance address search failed", e);
      setSearch({ status: "failed" });
    }
  };

  const evidence = (p: MaintenanceProposal): string => {
    const e = p.evidence ?? {};
    if (p.source === "stop")
      return t(`${NS}.evidence.stop`, {
        venue: e.venueName ?? "—",
        at: e.stopStart ? fmt.dateTime(e.stopStart) : "—",
        tokens: (e.matchedTokens ?? []).join(", ") || "—",
      });
    return t(`${NS}.evidence.geocoder`, { label: e.label || p.address || "—" });
  };

  return (
    <li
      className="flex flex-col"
      style={{
        gap: "var(--ts-space-xs)",
        padding: "var(--ts-space-sm)",
        border: `1px solid ${selected ? "var(--ts-accent)" : "var(--ts-border)"}`,
        borderRadius: "var(--ts-radius-card)",
        opacity: row.ignored ? 0.6 : 1,
      }}
      data-testid="maintenance-row"
    >
      <button type="button" className="text-left" onClick={onSelect} aria-pressed={selected}>
        <span className="t-body">{row.name}</span>
        {row.projNr ? <span className="t-caption"> · {row.projNr}</span> : null}
        <span className="t-caption block">{address || t(`${NS}.noAddress`)}</span>
        <span className="t-caption block">
          {row.issues.map((i) => t(`${NS}.issue.${i}`)).join(" · ")}
        </span>
      </button>
      {row.proposals.length === 0 && <p className="t-caption">{t(`${NS}.noProposals`)}</p>}
      <ol className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
        {row.proposals.map((p, i) => (
          <li key={`${p.source}-${i}`} className="t-caption">
            <p>
              <strong>{i + 1}.</strong> {t(`${NS}.source.${p.source}`)} ·{" "}
              {t(`${NS}.confidence.${p.confidence}`)}
              {p.evidence?.distanceMeters !== undefined
                ? ` · ${t(`${NS}.distance`, { meters: p.evidence.distanceMeters })}`
                : ""}
            </p>
            <p>{p.address ?? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`}</p>
            <p>{evidence(p)}</p>
            <Button
              disabled={busy}
              onClick={() =>
                onTake({
                  lat: p.lat,
                  lon: p.lon,
                  street: p.street,
                  label: p.address ?? evidence(p),
                  source: p.source,
                })
              }
            >
              {t(`${NS}.take`)}
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        <Button disabled={busy} onClick={() => setSearchOpen((o) => !o)}>
          {t(`${NS}.otherAddress`)}
        </Button>
        <Button disabled={busy} onClick={() => onIgnore(!row.ignored)}>
          {row.ignored ? t(`${NS}.unignore`) : t(`${NS}.ignore`)}
        </Button>
      </div>
      {searchOpen && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
          <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
            <Input
              aria-label={t(`${NS}.searchLabel`)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              disabled={busy || !query.trim() || search.status === "searching"}
              onClick={() => void runSearch()}
            >
              {t(`${NS}.search`)}
            </Button>
          </div>
          {search.status === "failed" && (
            <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
              {t(`${NS}.searchFailed`)}
            </p>
          )}
          {search.status === "done" && search.results.length === 0 && (
            <p className="t-caption">{t(`${NS}.searchEmpty`)}</p>
          )}
          {search.status === "done" &&
            search.results.map((h, i) => (
              <div key={`${h.lat},${h.lon},${i}`} className="t-caption flex flex-wrap items-center">
                <span style={{ marginRight: "var(--ts-space-sm)" }}>{hitLabel(h)}</span>
                <Button
                  disabled={busy}
                  onClick={() =>
                    onTake({
                      lat: h.lat,
                      lon: h.lon,
                      street: h.address || undefined,
                      label: hitLabel(h),
                      source: "manual",
                    })
                  }
                >
                  {t(`${NS}.take`)}
                </Button>
              </div>
            ))}
        </div>
      )}
    </li>
  );
}
