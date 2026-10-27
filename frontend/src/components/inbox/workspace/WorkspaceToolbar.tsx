import { useTranslation } from "../../../hooks/useTranslation";
import Button from "../../ui/Button";
import { W, type InboxSource } from "./model";

/**
 * Search, reload, re-check and the per-kind filter. The filter IS the inbox's
 * sections: `?tab=<kind>` selects one, so every link that ever pointed at an
 * old per-kind tab (`?tab=dawarich` from the settings card, `?tab=photos`)
 * still lands on exactly those items.
 */
export default function WorkspaceToolbar({
  query,
  onQuery,
  sources,
  source,
  onSource,
  counts,
  laterCount,
  showDeferred,
  onShowDeferred,
  loading,
  checking,
  onReload,
  onRecheck,
}: {
  query: string;
  onQuery: (value: string) => void;
  sources: readonly InboxSource[];
  source: InboxSource | "all";
  onSource: (kind: InboxSource | "all") => void;
  /** Per kind, `null` until measured; a string so a partial load can say "+?". */
  counts: Record<InboxSource | "all", string | null>;
  laterCount: number;
  showDeferred: boolean;
  onShowDeferred: (on: boolean) => void;
  loading: boolean;
  checking: boolean;
  onReload: () => void;
  onRecheck: () => void;
}) {
  const { t } = useTranslation(["dataQuality"]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 w-full text-sm sm:w-auto sm:flex-1">
          {t(`${W}.search`)}
          <input
            type="search"
            className="input mt-1 w-full"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t(`${W}.searchHint`)}
          />
        </label>
        <Button disabled={loading} onClick={onReload} title={t(`${W}.refreshHint`)}>
          {t(`${W}.refresh`)}
        </Button>
        <Button disabled={checking} onClick={onRecheck} title={t(`${W}.recheckHint`)}>
          {t(`${W}.recheckAll`)}
        </Button>
      </div>
      <div
        role="group"
        aria-label={t(`${W}.filterLabel`)}
        className="inbox-filters flex gap-2 overflow-x-auto pb-1 md:flex-wrap"
      >
        {(["all", ...sources] as const).map((kind) => (
          <Button
            key={kind}
            aria-pressed={source === kind}
            variant={source === kind ? "primary" : "secondary"}
            onClick={() => onSource(kind)}
          >
            {t(`${W}.sources.${kind}`)} {counts[kind] === null ? "(…)" : `(${counts[kind]})`}
          </Button>
        ))}
        <Button aria-pressed={showDeferred} onClick={() => onShowDeferred(!showDeferred)}>
          {t(`${W}.later`)} ({laterCount})
        </Button>
      </div>
      {showDeferred && <p className="t-caption">{t(`${W}.laterHint`)}</p>}
    </div>
  );
}
