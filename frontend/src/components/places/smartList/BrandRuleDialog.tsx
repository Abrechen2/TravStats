import Chip from "../../ui/Chip";
import { useEffect, useState } from "react";
import type { JSX } from "react";
import Modal from "../../Modal";
import { useTranslation } from "../../../hooks/useTranslation";
import { apiErrorMachineCode } from "../../../lib/apiError";
import { logger } from "../../../lib/logger";
import {
  DEFAULT_RULE_SETTINGS,
  clearListRule,
  saveListRule,
  searchBrands,
  type BrandHit,
  type ListRule,
  type RuleBrand,
} from "../../../lib/api/smartLists";

const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";
const SEARCH_DELAY_MS = 350;
const field = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--color-border)",
  color: "var(--text-primary)",
};

/** Why the brand search could not answer, as a locale key; never "no result". */
const SEARCH_ERRORS: Record<string, string> = {
  OPEN_DATA_DISABLED: "places:smartList.search.disabled",
  UPSTREAM_TIMEOUT: "places:smartList.search.timeout",
  UPSTREAM_RATE_LIMITED: "places:smartList.search.rateLimited",
  UPSTREAM_UNAVAILABLE: "places:smartList.search.unavailable",
};

/**
 * The rule of a smart list: which chains (picked by name from Wikidata, never typed as an id),
 * how long a stop may last, how near the outlet must be, and whether confident matches are taken
 * without asking (off by default). Saving an empty brand list is not possible; "Stop following"
 * removes the rule and keeps the list.
 */
export function BrandRuleDialog({
  listId,
  rule,
  onClose,
  onSaved,
}: {
  listId: string;
  rule: ListRule | null;
  onClose: () => void;
  onSaved: (rule: ListRule | null) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["places", "common"]);
  const initial = rule ?? { ...DEFAULT_RULE_SETTINGS, listId, brands: [] };
  const [brands, setBrands] = useState<RuleBrand[]>(initial.brands);
  const [minDwell, setMinDwell] = useState(String(initial.minDwellMinutes));
  const [maxDwell, setMaxDwell] = useState(String(initial.maxDwellMinutes));
  const [distance, setDistance] = useState(String(initial.maxDistanceM));
  const [autoDistance, setAutoDistance] = useState(String(initial.autoAcceptDistanceM));
  const [auto, setAuto] = useState(initial.autoAccept);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BrandHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearchError(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchBrands(q, i18n.language.startsWith("de") ? "de" : "en")
        .then((found) => {
          if (!current) return;
          setHits(found);
          setSearchError(null);
        })
        .catch((err: unknown) => {
          if (!current) return;
          logger.error({ err }, "BrandRuleDialog: the brand search failed");
          setHits([]);
          setSearchError(
            SEARCH_ERRORS[apiErrorMachineCode(err) ?? ""] ?? "places:smartList.search.failed"
          );
        })
        .finally(() => {
          if (current) setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, i18n.language]);

  const min = Number(minDwell);
  const max = Number(maxDwell);
  const dist = Number(distance);
  const windowOk =
    Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min && max <= 1440;
  const autoDist = Number(autoDistance);
  const distOk = Number.isInteger(dist) && dist >= 10 && dist <= 500;
  const autoDistOk = Number.isInteger(autoDist) && autoDist >= 10 && autoDist <= dist;
  const canSave = brands.length > 0 && windowOk && distOk && autoDistOk && !busy;

  const add = (hit: BrandHit): void => {
    setBrands((b) =>
      b.some((x) => x.brandWikidataId === hit.id)
        ? b
        : [...b, { brandWikidataId: hit.id, brandName: hit.label }]
    );
    setQuery("");
    setHits([]);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setSaveError(null);
    try {
      onSaved(
        await saveListRule(listId, {
          brands,
          minDwellMinutes: min,
          maxDwellMinutes: max,
          maxDistanceM: dist,
          autoAcceptDistanceM: autoDist,
          autoAccept: auto,
        })
      );
    } catch (err: unknown) {
      logger.error({ err }, "BrandRuleDialog: the rule was refused");
      setSaveError(
        apiErrorMachineCode(err) === "LIST_IS_CURATED"
          ? "places:smartList.saveErrors.curated"
          : "places:smartList.saveErrors.failed"
      );
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    setSaveError(null);
    try {
      await clearListRule(listId);
      onSaved(null);
    } catch (err: unknown) {
      logger.error({ err }, "BrandRuleDialog: the rule could not be removed");
      setSaveError("places:smartList.saveErrors.failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      maxWidth={560}
      closeLabel={t("common:buttons.close")}
      title={t("places:smartList.dialogTitle")}
      footer={(requestClose) => (
        <>
          {rule && (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={busy}
              className={`mr-auto rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${COARSE}`}
              style={{ border: "1px solid var(--color-border)", color: "var(--danger)" }}
            >
              {t("places:smartList.stop")}
            </button>
          )}
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${COARSE}`}
            style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
          >
            {t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className={`btn-primary disabled:opacity-50 ${COARSE}`}
          >
            {busy ? t("common:buttons.saving") : t("common:buttons.save")}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("places:smartList.dialogIntro")}
        </p>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="smart-brand-search"
            className="text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("places:smartList.brandSearch")}
          </label>
          <input
            id="smart-brand-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("places:smartList.brandPlaceholder")}
            autoComplete="off"
            className={`w-full rounded-lg px-3 py-2 text-sm ${COARSE}`}
            style={field}
          />
          {searching && (
            <p role="status" className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("places:smartList.search.searching")}
            </p>
          )}
          {searchError && (
            <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
              {t(searchError)}
            </p>
          )}
          {!searching && !searchError && query.trim().length >= 2 && hits.length === 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("places:smartList.search.none")}
            </p>
          )}
          {hits.length > 0 && (
            <ul className="grid gap-1" style={{ listStyle: "none", padding: 0 }}>
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => add(hit)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${COARSE}`}
                    style={{
                      border: "1px solid var(--color-border)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <span className="font-semibold">{hit.label}</span>
                    {hit.description && (
                      <span className="ml-2" style={{ color: "var(--text-muted)" }}>
                        {hit.description}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:smartList.chosenBrands")}
          </p>
          {brands.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("places:smartList.noBrandYet")}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2" style={{ listStyle: "none", padding: 0 }}>
              {brands.map((b) => (
                <li key={b.brandWikidataId}>
                  <Chip
                    onRemove={() =>
                      setBrands((all) => all.filter((x) => x.brandWikidataId !== b.brandWikidataId))
                    }
                    removeLabel={t("places:smartList.removeBrand", { name: b.brandName })}
                  >
                    {b.brandName}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </div>

        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:smartList.window")}
          </legend>
          <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:smartList.minDwell")}
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={minDwell}
              onChange={(e) => setMinDwell(e.target.value)}
              className={`w-28 rounded-lg px-3 py-2 text-sm ${COARSE}`}
              style={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:smartList.maxDwell")}
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={maxDwell}
              onChange={(e) => setMaxDwell(e.target.value)}
              className={`w-28 rounded-lg px-3 py-2 text-sm ${COARSE}`}
              style={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:smartList.maxDistance")}
            <input
              type="number"
              inputMode="numeric"
              min={10}
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              className={`w-28 rounded-lg px-3 py-2 text-sm ${COARSE}`}
              style={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:smartList.autoDistance")}
            <input
              type="number"
              inputMode="numeric"
              min={10}
              value={autoDistance}
              onChange={(e) => setAutoDistance(e.target.value)}
              className={`w-28 rounded-lg px-3 py-2 text-sm ${COARSE}`}
              style={field}
            />
          </label>
        </fieldset>
        {!windowOk && (
          <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
            {t("places:smartList.windowInvalid")}
          </p>
        )}
        {!distOk && (
          <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
            {t("places:smartList.distanceInvalid")}
          </p>
        )}
        {distOk && !autoDistOk && (
          <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
            {t("places:smartList.autoDistanceInvalid")}
          </p>
        )}

        <label className="flex items-start gap-2 text-sm" style={{ color: "var(--text-primary)" }}>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
            className="mt-1"
            style={{ width: 20, height: 20, accentColor: "var(--ts-accent)" }}
          />
          <span>
            {t("places:smartList.autoAccept")}
            <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
              {t("places:smartList.autoAcceptHint")}
            </span>
          </span>
        </label>

        {saveError && (
          <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
            {t(saveError)}
          </p>
        )}
      </div>
    </Modal>
  );
}
