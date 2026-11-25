import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import { useDisplayFormat } from "../../../lib/displayFormat";
import Modal from "../../Modal";
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
import MaintenanceRowCard, { type Choice } from "./MaintenanceRowCard";

const NS = "suggestionSources:plugins.maintenance";

type Load =
  | { status: "loading" }
  | { status: "failed"; key: string }
  | { status: "done"; list: MaintenanceList };
type Line = { ok: boolean; text: string };

/** Up to six decimals, as the plugin writes them: the confirmation shows exactly that. */
const coord = (x: number) => x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

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
  const { t, i18n } = useTranslation(["suggestionSources", "location"]);
  const fmt = useDisplayFormat();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [busy, setBusy] = useState(false);
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
      const list = await suggestionPluginsApi.maintenance(plugin.id, locale);
      setLoad({ status: "done", list });
      setSelected((s) => s ?? list.rows.find((r) => !r.ignored)?.rowId ?? null);
    } catch (e) {
      const key = pluginRequestFailureKey(e);
      console.warn("plugin maintenance list failed", key);
      setLoad({ status: "failed", key });
    }
  }, [plugin.id, locale]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

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
    const message = [
      t(`${NS}.confirm.intro`, { plugin: plugin.name, name: row.name }),
      t(`${NS}.confirm.coords`, { lat: coord(choice.lat), lon: coord(choice.lon) }),
      street
        ? t(`${NS}.confirm.street`, { street })
        : t(`${NS}.confirm.streetKept`, { street: row.street || "—" }),
      t(`${NS}.confirm.source`, { source: choice.label }),
      t(`${NS}.confirm.undo`),
    ].join("\n");
    if (
      !(await confirm({ title: t(`${NS}.confirm.title`), message, confirmText: t(`${NS}.take`) }))
    )
      return;
    await act(async () => {
      await suggestionPluginsApi.applyLocation(plugin.id, {
        rowId: row.rowId,
        lat: choice.lat,
        lon: choice.lon,
        ...(street ? { street } : {}),
        source: choice.source,
      });
      return t(`${NS}.applied`, { name: row.name });
    });
  };

  if (!open) return null;
  const list = load.status === "done" ? load.list : null;
  const rows = list ? list.rows.filter((r) => showIgnored || !r.ignored) : [];
  const current = list?.rows.find((r) => r.rowId === selected) ?? null;

  return (
    <Modal
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
            <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
              {t(`suggestionSources:${load.key}`)}
            </p>
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
            {rows.length === 0 && <p className="t-caption">{t(`${NS}.empty`)}</p>}
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
                      onClick={() =>
                        void act(async () => {
                          await suggestionPluginsApi.undoLocation(plugin.id, a.undoId);
                          return t(`${NS}.undone`, { name: a.name });
                        })
                      }
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
    </Modal>
  );
}
