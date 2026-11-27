import { toast } from "../../../store/toastStore";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import { useDisplayFormat } from "../../../lib/format";
import Dialog from "../../ui/Dialog";
import Button from "../../ui/Button";
import { Switch } from "../../ui/Field";
import {
  pluginRequestFailureKey,
  suggestionPluginsApi,
  type MaintenanceList,
  type MaintenanceRow,
  type SuggestionPlugin,
} from "../../../lib/api/suggestionPlugins";
import MaintenanceMap from "./MaintenanceMap";
import { archiveUndoRequest, archiveWriteRequest } from "../../inbox/plugins/archiveConfirm";
import MaintenanceRowCard, { type Choice } from "./MaintenanceRowCard";
import InlineError from "../../ui/InlineError";
import { SearchInput } from "../../ui/SearchInput";

const NS = "suggestionSources:plugins.maintenance";
const PAGE_SIZE = 50;

type Load =
  | { status: "loading" }
  | { status: "failed"; key: string }
  | { status: "done"; list: MaintenanceList };
type Line = { ok: boolean; text: string };

/**
 * "Standorte pflegen" (owner 2026-11-24): the plugin's rows without a usable
 * position, its proposals on a mini map, and the user's choice — which the
 * plugin writes into ITS data only after a confirmation naming exactly what is
 * written. Every failure (readOnly, signature, unreachable, …) is shown.
 */
export default function PluginMaintenanceDialog({
  plugin,
  open,
  onClose,
}: {
  plugin: SuggestionPlugin;
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["suggestionSources", "location", "dataQuality"]);
  const fmt = useDisplayFormat();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [line, setLine] = useState<Line | null>(null);
  const locale = i18n.language?.startsWith("en") ? "en" : "de";

  const fail = (e: unknown) => {
    const key = pluginRequestFailureKey(e);
    console.warn("plugin maintenance request failed", key);
    return t(`suggestionSources:${key}`);
  };

  const reload = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const list = await suggestionPluginsApi.maintenance(plugin.id, locale, {
        q: search,
        offset,
        limit: PAGE_SIZE,
      });
      setLoad({ status: "done", list });
      setSelected((s) => s ?? list.rows.find((r) => !r.ignored)?.rowId ?? null);
    } catch (e) {
      const key = pluginRequestFailureKey(e);
      console.warn("plugin maintenance list failed", key);
      setLoad({ status: "failed", key });
    }
  }, [plugin.id, locale, search, offset]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  // The offer ends with the dialog: a failed undo would have no surface to say so.
  const undoToast = useRef<string | null>(null);
  useEffect(() => {
    if (open) return;
    if (undoToast.current) toast.dismiss(undoToast.current);
    undoToast.current = null;
  }, [open]);
  useEffect(
    () => () => {
      if (undoToast.current) toast.dismiss(undoToast.current);
    },
    []
  );

  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setLine(null);
    try {
      setLine({ ok: true, text: await work() });
      await reload();
    } catch (e) {
      setLine({ ok: false, text: fail(e) });
    } finally {
      setBusy(false);
    }
  };

  const take = async (row: MaintenanceRow, choice: Choice) => {
    // The street is written only into an empty field: say which it is.
    const street = !row.street && choice.street ? choice.street : undefined;
    // The same confirmation as the inbox (owner 2026-11-26): exactly what goes into the archive.
    if (
      !(await confirm(
        archiveWriteRequest(t, {
          plugin: plugin.name,
          name: row.name,
          lat: choice.lat,
          lon: choice.lon,
          values: street ? { street } : {},
          before: row,
        })
      ))
    )
      return;
    await act(async () => {
      const applied = await suggestionPluginsApi.applyLocation(plugin.id, {
        rowId: row.rowId,
        lat: choice.lat,
        lon: choice.lon,
        ...(street ? { street } : {}),
        source: choice.source,
      });
      if (undoToast.current) toast.dismiss(undoToast.current);
      undoToast.current = toast.undoable({
        label: t(`${NS}.applied`, { name: row.name }),
        undoLabel: t(`${NS}.undo`),
        onUndo: () =>
          void act(async () => {
            await suggestionPluginsApi.undoLocation(plugin.id, applied.undoId);
            return t(`${NS}.undone`, { name: row.name });
          }),
      });
      return t(`${NS}.applied`, { name: row.name });
    });
  };

  if (!open) return null;
  const list = load.status === "done" ? load.list : null;
  const rows = list ? list.rows.filter((r) => showIgnored || !r.ignored) : [];
  const total = list?.totalRows ?? list?.rows.length ?? 0;
  const pageStart = list?.offset ?? offset;
  const current = list?.rows.find((r) => r.rowId === selected) ?? null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(`${NS}.title`, { name: plugin.name })}
      maxWidth={1200}
      busy={busy}
      testId="plugin-maintenance"
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        <p className="t-caption">{t(`${NS}.intro`)}</p>
        {load.status === "loading" && <p className="t-caption">{t(`${NS}.loading`)}</p>}
        {load.status === "failed" && (
          <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
            <InlineError>{t(`suggestionSources:${load.key}`)}</InlineError>
            <Button onClick={() => void reload()}>{t(`${NS}.reload`)}</Button>
          </div>
        )}
        {line && (
          <p
            className="t-caption"
            role={line.ok ? "status" : "alert"}
            style={{ color: line.ok ? "var(--ts-good)" : "var(--ts-bad)" }}
          >
            {line.text}
          </p>
        )}
        {list && (
          <>
            <p className="t-caption">
              {list.stopsWithheld
                ? t(`${NS}.stopsWithheld.${list.stopsWithheld}`)
                : t(`${NS}.stopsSent`, { count: list.stopsSent })}
              {list.pendingSearches
                ? ` · ${t(`${NS}.pendingSearches`, { count: list.pendingSearches })}`
                : ""}
            </p>
            <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
              <Switch
                id={`maint-ignored-${plugin.id}`}
                checked={showIgnored}
                onChange={setShowIgnored}
                label={t(`${NS}.showIgnored`)}
              />
              <Button disabled={busy} onClick={() => void reload()}>
                {t(`${NS}.reload`)}
              </Button>
            </div>
            <form
              className="flex flex-wrap items-center"
              style={{ gap: "var(--ts-space-sm)" }}
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setOffset(0);
                setSearch(draft.trim());
              }}
            >
              <SearchInput
                value={draft}
                maxLength={100}
                onChange={setDraft}
                placeholder={t(`${NS}.searchPlaceholder`)}
                label={t(`${NS}.searchLabel`)}
              />
              <Button type="submit" disabled={busy}>
                {t(`${NS}.searchButton`)}
              </Button>
              {search && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft("");
                    setSearch("");
                    setOffset(0);
                  }}
                >
                  {t(`${NS}.searchClear`)}
                </Button>
              )}
            </form>
            {total > 0 && (
              <div
                className="flex flex-wrap items-center t-caption"
                style={{ gap: "var(--ts-space-sm)" }}
              >
                <span data-testid="maintenance-range">
                  {t(`${NS}.range`, {
                    from: pageStart + 1,
                    to: pageStart + list.rows.length,
                    total,
                  })}
                </span>
                <Button
                  disabled={busy || pageStart === 0}
                  onClick={() => setOffset(Math.max(0, pageStart - PAGE_SIZE))}
                >
                  {t(`${NS}.prev`)}
                </Button>
                <Button
                  disabled={busy || pageStart + list.rows.length >= total}
                  onClick={() => setOffset(pageStart + PAGE_SIZE)}
                >
                  {t(`${NS}.next`)}
                </Button>
              </div>
            )}
            {current && (
              <MaintenanceMap
                current={
                  typeof current.lat === "number" && typeof current.lon === "number"
                    ? { lat: current.lat, lon: current.lon }
                    : null
                }
                proposals={current.proposals}
                ariaLabel={t(`${NS}.mapLabel`, { name: current.name })}
                attributionLabel={t("location:attribution")}
              />
            )}
            {rows.length === 0 && (
              <p className="t-caption">{t(search ? `${NS}.noMatch` : `${NS}.empty`)}</p>
            )}
            <ul
              className="grid"
              style={{
                gap: "var(--ts-space-sm)",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              }}
            >
              {rows.map((row) => (
                <MaintenanceRowCard
                  key={row.rowId}
                  row={row}
                  selected={row.rowId === selected}
                  busy={busy}
                  onSelect={() => setSelected(row.rowId)}
                  onTake={(c) => void take(row, c)}
                  onIgnore={(ignored) =>
                    void act(async () => {
                      await suggestionPluginsApi.ignoreRow(plugin.id, row.rowId, ignored);
                      return t(ignored ? `${NS}.ignored` : `${NS}.unignored`, { name: row.name });
                    })
                  }
                />
              ))}
            </ul>
            {(list.applied ?? []).length > 0 && (
              <section className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
                <h3 className="t-body">{t(`${NS}.appliedTitle`)}</h3>
                {(list.applied ?? []).map((a) => (
                  <div
                    key={a.undoId}
                    className="t-caption flex flex-wrap items-center"
                    style={{ gap: "var(--ts-space-sm)" }}
                    data-testid="maintenance-applied"
                  >
                    <span>
                      {t(`${NS}.appliedLine`, {
                        name: a.name,
                        lat: a.written.Latitude ?? "—",
                        lon: a.written.Longitude ?? "—",
                        at: fmt.dateTime(a.appliedAt),
                      })}
                      {a.written.Strasse ? ` · ${a.written.Strasse}` : ""}
                    </span>
                    <Button
                      disabled={busy}
                      onClick={async () => {
                        // Undo writes to the archive too: confirmed per item like the write.
                        if (!(await confirm(archiveUndoRequest(t, plugin.name, a.name)))) return;
                        await act(async () => {
                          await suggestionPluginsApi.undoLocation(plugin.id, a.undoId);
                          return t(`${NS}.undone`, { name: a.name });
                        });
                      }}
                    >
                      {t(`${NS}.undo`)}
                    </Button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
      {confirmDialog}
    </Dialog>
  );
}
