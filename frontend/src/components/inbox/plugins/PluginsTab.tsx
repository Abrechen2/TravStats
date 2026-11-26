import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/format";
import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import Button from "../../ui/Button";
import Toggletip from "../../ui/Toggletip";
import { pluginRequestFailureKey, suggestionPluginsApi } from "../../../lib/api/suggestionPlugins";
import { sortEntries, type PluginEntry, type PluginSort, type Severity } from "./pluginInboxModel";
import { usePluginInbox } from "./usePluginInbox";
import PluginRowEditor from "./PluginRowEditor";
import { archiveUndoRequest, coord } from "./archiveConfirm";

const NS = "dataQuality:pluginInbox";
const MS = "suggestionSources:plugins.maintenance";
const SORTS: readonly PluginSort[] = ["severity", "date", "stop"];
const TONE: Record<Severity, string> = {
  error: "var(--ts-bad)",
  warning: "var(--ts-warn)",
  info: "var(--ts-muted)",
};

/**
 * "Plugins" in the inbox (owner 2026-11-26): every plugin's maintenance proposals and notices,
 * sortable and filterable per plugin. A proposal opens into its editor; a notice says its reason
 * and offers "open the row" and "ignore". Every plugin that did not answer is named.
 */
export default function PluginsTab({
  onCount,
}: {
  onCount?: (count: number | null) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["dataQuality", "suggestionSources"]);
  const fmt = useDisplayFormat();
  const { confirm, confirmDialog } = useConfirmDialog();
  const locale = i18n.language?.startsWith("en") ? "en" : "de";
  const inbox = usePluginInbox(locale);
  const [sort, setSort] = useState<PluginSort>("severity");
  const [pluginId, setPluginId] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [line, setLine] = useState<{ ok: boolean; text: string } | null>(null);

  const all = inbox.entries.filter((e) => !hidden.has(e.key));
  useEffect(() => {
    onCount?.(inbox.loaded ? all.length : null);
  }, [onCount, inbox.loaded, all.length]);

  const shown = sortEntries(
    all.filter((e) => pluginId === null || e.plugin.id === pluginId),
    sort
  );

  const ignore = async (entry: PluginEntry, rowId: string | null) => {
    setLine(null);
    if (rowId === null) {
      // A notice about the whole plugin: hidden for this visit, nothing is written.
      setHidden((h) => new Set(h).add(entry.key));
      return;
    }
    try {
      await suggestionPluginsApi.ignoreRow(entry.plugin.id, rowId, true);
      setLine({ ok: true, text: t(`${MS}.ignored`, { name: nameOf(entry) }) });
      await inbox.reload();
    } catch (e) {
      const key = pluginRequestFailureKey(e);
      console.warn("plugin inbox: ignore failed", key);
      setLine({ ok: false, text: t(`suggestionSources:${key}`) });
    }
  };

  const openRow = (entry: PluginEntry, rowId: string) => {
    const key = `${entry.plugin.id}:row:${rowId}`;
    setOpen(key);
    setPluginId(null);
    requestAnimationFrame(() =>
      document.getElementById(`plugin-entry-${key}`)?.scrollIntoView?.({ block: "center" })
    );
  };

  const count = (id: string | null) => all.filter((e) => id === null || e.plugin.id === id).length;

  return (
    <section className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        <p className="t-caption m-0">{t(`${NS}.intro`)}</p>
        <Toggletip content={t(`${NS}.info`)} />
        <Button disabled={inbox.refreshing} onClick={() => void inbox.refresh()}>
          {t(`${NS}.refreshNow`)}
        </Button>
        {inbox.loaded && (
          <span className="t-caption" data-testid="plugin-refreshed-at">
            {inbox.refreshedAt
              ? t(`${NS}.refreshedAt`, { at: fmt.dateTime(inbox.refreshedAt) })
              : t(`${NS}.notYet`)}
          </span>
        )}
      </div>

      {inbox.failed.map((f, i) => (
        <p key={i} role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
          {f.plugin ? `${f.plugin.name}: ` : ""}
          {t(`suggestionSources:${f.key}`)}
          {f.plugin ? ` ${t(`${NS}.olderShown`)}` : ""}
        </p>
      ))}
      {line && (
        <p
          className="t-caption"
          role={line.ok ? "status" : "alert"}
          style={{ color: line.ok ? "var(--ts-good)" : "var(--ts-bad)" }}
        >
          {line.text}
        </p>
      )}

      {inbox.plugins.length > 1 && (
        <div role="group" aria-label={t(`${NS}.filterLabel`)} className="flex flex-wrap gap-1.5">
          {[null, ...inbox.plugins.map((p) => p.id)].map((id) => {
            const active = pluginId === id;
            const label =
              id === null ? t(`${NS}.all`) : inbox.plugins.find((p) => p.id === id)!.name;
            return (
              <button
                key={id ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setPluginId(id)}
                className="rounded-full px-3 py-1 text-sm"
                style={{
                  border: `1px solid ${active ? "var(--ts-accent)" : "var(--ts-border-button)"}`,
                  color: active ? "var(--ts-accent)" : "var(--ts-muted)",
                }}
              >
                {label} {count(id)}
              </button>
            );
          })}
        </div>
      )}

      <label className="t-caption flex items-center gap-2">
        {t(`${NS}.sortLabel`)}
        <select
          className="ts-control"
          value={sort}
          onChange={(e) => setSort(e.target.value as PluginSort)}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`${NS}.sort.${s}`)}
            </option>
          ))}
        </select>
      </label>

      {!inbox.loaded && <p className="t-caption">{t(`${NS}.loading`)}</p>}
      {inbox.loaded && shown.length === 0 && inbox.failed.length === 0 && (
        <p className="t-caption">
          {inbox.plugins.length === 0 ? t(`${NS}.noPlugins`) : t(`${NS}.empty`)}
        </p>
      )}
      {Object.entries(inbox.more).map(([id, n]) => (
        <p key={id} className="t-caption">
          {t(`${NS}.more`, { count: n, plugin: inbox.plugins.find((p) => p.id === id)?.name })}
        </p>
      ))}

      <ul className="grid" style={{ gap: "var(--ts-space-sm)", listStyle: "none", padding: 0 }}>
        {shown.map((entry) => (
          <li
            key={entry.key}
            id={`plugin-entry-${entry.key}`}
            data-testid="plugin-entry"
            className="rounded-xl px-4 py-3"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
              <span className="t-caption" style={{ color: TONE[entry.severity] }}>
                {t(`${NS}.severity.${entry.severity}`)}
              </span>
              <span className="text-sm font-semibold">{nameOf(entry)}</span>
              <span className="t-caption">{entry.plugin.name}</span>
              {entry.date && <span className="t-caption">{fmt.dateTime(entry.date)}</span>}
              {entry.hasStop && <span className="t-caption">{t(`${NS}.hasStop`)}</span>}
            </div>
            {entry.kind === "row" ? (
              <>
                <p className="t-caption mt-1">
                  {entry.row.issues.map((i) => t(`${MS}.issue.${i}`)).join(" · ")}
                </p>
                {open === entry.key ? (
                  <div className="mt-2">
                    <PluginRowEditor
                      plugin={entry.plugin}
                      row={entry.row}
                      onWritten={() => void inbox.reload()}
                    />
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button onClick={() => setOpen(entry.key)}>{t(`${NS}.edit`)}</Button>
                    <Button onClick={() => void ignore(entry, entry.row.rowId)}>
                      {t(`${NS}.ignore`)}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="t-caption mt-1">{entry.notice.message}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {entry.notice.rowId !== undefined && (
                    <Button onClick={() => openRow(entry, String(entry.notice.rowId))}>
                      {t(`${NS}.openRow`)}
                    </Button>
                  )}
                  <Button
                    onClick={() =>
                      void ignore(
                        entry,
                        entry.notice.rowId === undefined ? null : String(entry.notice.rowId)
                      )
                    }
                  >
                    {t(`${NS}.ignore`)}
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      {inbox.applied.length > 0 && (
        <section className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
          <h3 className="t-body">{t(`${NS}.appliedTitle`)}</h3>
          {inbox.applied.map(({ plugin, item }) => (
            <div
              key={`${plugin.id}:${item.undoId}`}
              className="t-caption flex flex-wrap items-center"
              style={{ gap: "var(--ts-space-sm)" }}
              data-testid="plugin-applied"
            >
              <span>
                {item.name} ({plugin.name}):{" "}
                {typeof item.written.Latitude === "number" &&
                typeof item.written.Longitude === "number"
                  ? `${coord(item.written.Latitude)}, ${coord(item.written.Longitude)}`
                  : "—"}
                {item.written.Strasse ? ` · ${item.written.Strasse}` : ""}
                {item.written.PLZ || item.written.Ort
                  ? ` · ${[item.written.PLZ, item.written.Ort].filter(Boolean).join(" ")}`
                  : ""}
              </span>
              <Button
                onClick={async () => {
                  const ok = await confirm(archiveUndoRequest(t, plugin.name, item.name));
                  if (!ok) return;
                  setLine(null);
                  try {
                    await suggestionPluginsApi.undoLocation(plugin.id, item.undoId);
                    setLine({ ok: true, text: t(`${NS}.undone`, { name: item.name }) });
                    await inbox.reload();
                  } catch (e) {
                    const key = pluginRequestFailureKey(e);
                    console.warn("plugin inbox: undo failed", key);
                    setLine({ ok: false, text: t(`suggestionSources:${key}`) });
                  }
                }}
              >
                {t(`${NS}.undo`)}
              </Button>
            </div>
          ))}
        </section>
      )}
      {confirmDialog}
    </section>
  );
}

function nameOf(entry: PluginEntry): string {
  return entry.kind === "row" ? entry.row.name : (entry.notice.name ?? entry.plugin.name);
}
