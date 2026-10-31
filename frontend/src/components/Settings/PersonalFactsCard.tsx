import { useEffect, useState, type FormEvent, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { personalApi, type PersonalFacts } from "../../lib/api/companionData";
import { searchPlaces, type PlaceSearchResult } from "../../lib/api/geo";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import { SectionCard } from "./SettingsShared";
import { SettingRow, SettingRows } from "../ui/SettingRow";

const NAME_MAX = 200;

function placeName(hit: PlaceSearchResult): string {
  const parts = [hit.name, hit.city, hit.country].filter((p): p is string => !!p);
  return [...new Set(parts)].join(", ").slice(0, NAME_MAX);
}

type SearchState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "failed" }
  | { kind: "degraded" }
  | { kind: "results"; hits: PlaceSearchResult[] };

/**
 * Home place and passport expiry (forgejo#398) — facts the Companion writes
 * to the server (`/settings/personal`), shown and editable here. The server
 * keeps one value per field and the last write wins (the endpoint has no rev),
 * so every save shows what the server answered, and a failed one keeps the
 * stored value on screen and says so.
 */
export default function PersonalFactsCard(): JSX.Element {
  const { t, i18n } = useTranslation(["settings"]);
  const [facts, setFacts] = useState<PersonalFacts | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });

  useEffect(() => {
    let alive = true;
    personalApi
      .get()
      .then((f) => {
        if (alive) setFacts(f);
      })
      .catch((error: unknown) => {
        logger.warn("Failed to load personal facts", error);
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async (patch: Partial<PersonalFacts>): Promise<boolean> => {
    setSaving(true);
    try {
      setFacts(await personalApi.put(patch));
      return true;
    } catch (error) {
      logger.warn("Failed to save personal facts", error);
      useToastStore.getState().addToast("error", t("settings:errors.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const runSearch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setSearch({ kind: "busy" });
    try {
      const { results, degraded } = await searchPlaces(q, i18n?.language);
      if (results.length === 0) setSearch({ kind: degraded ? "degraded" : "results", hits: [] });
      else setSearch({ kind: "results", hits: results.slice(0, 5) });
    } catch (error) {
      logger.warn("Home place search failed", error);
      setSearch({ kind: "failed" });
    }
  };

  const pick = async (hit: PlaceSearchResult): Promise<void> => {
    const ok = await save({
      homePlace: { name: placeName(hit), lat: hit.lat, lon: hit.lon, zone: null },
    });
    if (ok) {
      setSearch({ kind: "idle" });
      setQuery("");
    }
  };

  const home = facts?.homePlace ?? null;
  return (
    <SectionCard>
      <SettingRows>
        <SettingRow
          title={t("settings:personalFacts.homePlace.label")}
          sub={
            loadFailed
              ? t("settings:personalFacts.loadFailed")
              : t("settings:personalFacts.homePlace.description")
          }
          control={
            <span className="flex flex-wrap items-center" style={{ gap: 8 }}>
              <span data-testid="home-place-value">
                {facts ? (home?.name ?? t("settings:personalFacts.notSet")) : "…"}
              </span>
              {home && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={saving}
                  onClick={() => void save({ homePlace: null })}
                >
                  {t("settings:personalFacts.clear")}
                </button>
              )}
            </span>
          }
        />
        {facts && (
          <div className="flex flex-col" style={{ gap: 8, paddingBottom: 8 }}>
            <form onSubmit={(e) => void runSearch(e)} className="flex flex-wrap" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ flex: "1 1 220px", minHeight: "var(--ts-size-touch-min)" }}
                value={query}
                aria-label={t("settings:personalFacts.homePlace.search")}
                placeholder={t("settings:personalFacts.homePlace.search")}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="submit"
                className="btn-secondary"
                disabled={saving || search.kind === "busy" || query.trim().length < 2}
              >
                {t("settings:personalFacts.homePlace.searchAction")}
              </button>
            </form>
            {search.kind === "failed" && (
              <p role="alert" className="t-caption">
                {t("settings:personalFacts.homePlace.searchFailed")}
              </p>
            )}
            {search.kind === "degraded" && (
              <p role="alert" className="t-caption">
                {t("settings:personalFacts.homePlace.searchDegraded")}
              </p>
            )}
            {search.kind === "results" && search.hits.length === 0 && (
              <p className="t-caption">{t("settings:personalFacts.homePlace.noResults")}</p>
            )}
            {search.kind === "results" && search.hits.length > 0 && (
              <ul className="flex flex-col" style={{ gap: 4 }}>
                {search.hits.map((hit, i) => (
                  <li key={`${hit.externalRef ?? hit.name}-${i}`}>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={saving}
                      onClick={() => void pick(hit)}
                    >
                      {placeName(hit)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <SettingRow
          title={t("settings:personalFacts.passport.label")}
          htmlFor="settings-passport-expiry"
          sub={t("settings:personalFacts.passport.description")}
          control={
            <span className="flex flex-wrap items-center" style={{ gap: 8 }}>
              <input
                id="settings-passport-expiry"
                type="date"
                className="input"
                style={{ minHeight: "var(--ts-size-touch-min)" }}
                // keyed by the stored value: a rejected save snaps back to it
                key={facts?.passportExpiry ?? "none"}
                defaultValue={facts?.passportExpiry ?? ""}
                disabled={!facts || saving}
                onBlur={(e) => {
                  const next = e.target.value === "" ? null : e.target.value;
                  if (next === (facts?.passportExpiry ?? null)) return;
                  void save({ passportExpiry: next }).then((ok) => {
                    if (!ok) e.target.value = facts?.passportExpiry ?? "";
                  });
                }}
              />
            </span>
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
