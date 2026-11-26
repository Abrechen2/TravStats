import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import Button from "../../ui/Button";
import { Input } from "../../ui/Field";
import MaintenanceMap from "../../Settings/suggestionSources/MaintenanceMap";
import {
  pluginRequestFailureKey,
  suggestionPluginsApi,
  type MaintenanceRow,
  type MaintenanceSource,
  type SuggestionPlugin,
} from "../../../lib/api/suggestionPlugins";

const NS = "dataQuality:pluginInbox";
const MS = "suggestionSources:plugins.maintenance";

/** Up to six decimals, as the plugin writes them: the confirmation shows exactly that. */
export const coord = (x: number) => x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

type Line = { ok: boolean; text: string };

/**
 * One archive row in the inbox, editable before anything is written (owner 2026-11-26): a proposal
 * or a click on the map gives the position, street, postcode and town are fields. "Übernehmen"
 * opens a confirmation naming exactly what goes into the archive; only its "Bestätigen" asks for
 * the single-use ticket and writes. Afterwards the write can be undone. No bulk path exists.
 */
export default function PluginRowEditor({
  plugin,
  row,
  onWritten,
}: {
  plugin: SuggestionPlugin;
  row: MaintenanceRow;
  /** A write or undo went through: the tab re-reads. */
  onWritten: () => void;
}): JSX.Element {
  const { t } = useTranslation(["dataQuality", "suggestionSources", "location"]);
  const { confirm, confirmDialog } = useConfirmDialog();
  const start = row.proposals.find((p) => p.source === "stop") ?? row.proposals[0] ?? null;
  const [at, setAt] = useState<{ lat: number; lon: number; source: MaintenanceSource } | null>(
    start ? { lat: start.lat, lon: start.lon, source: start.source } : null
  );
  const [street, setStreet] = useState(row.street || start?.street || "");
  const [postcode, setPostcode] = useState(row.postcode ?? "");
  const [town, setTown] = useState(row.town ?? "");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Line | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);

  const fail = (e: unknown) => {
    const key = pluginRequestFailureKey(e);
    console.warn("plugin inbox: a write failed", key);
    return t(`suggestionSources:${key}`);
  };

  /** Only fields that change are sent; an unchanged one is left as the archive holds it. */
  const changed = (value: string, before: string | null | undefined) => {
    const v = value.trim();
    return v && v !== (before ?? "").trim() ? v : undefined;
  };

  const take = async () => {
    if (!at) return;
    const values = {
      street: changed(street, row.street),
      postcode: changed(postcode, row.postcode),
      town: changed(town, row.town),
    };
    const field = (label: string, next: string | undefined, before: string | null | undefined) =>
      next
        ? t(`${NS}.confirm.field`, { label, value: next })
        : t(`${NS}.confirm.kept`, { label, value: before || "—" });
    const message = [
      t(`${NS}.confirm.writes`, { plugin: plugin.name, name: row.name }),
      t(`${NS}.confirm.coords`, { lat: coord(at.lat), lon: coord(at.lon) }),
      field(t(`${NS}.street`), values.street, row.street),
      field(t(`${NS}.postcode`), values.postcode, row.postcode),
      field(t(`${NS}.town`), values.town, row.town),
      t(`${NS}.confirm.undo`),
    ].join("\n");
    const ok = await confirm({
      title: t(`${NS}.confirm.title`),
      message,
      confirmText: t(`${NS}.confirm.button`),
    });
    if (!ok) return;
    setBusy(true);
    setLine(null);
    try {
      const done = await suggestionPluginsApi.applyLocation(plugin.id, {
        rowId: row.rowId,
        lat: at.lat,
        lon: at.lon,
        ...(values.street ? { street: values.street } : {}),
        ...(values.postcode ? { postcode: values.postcode } : {}),
        ...(values.town ? { town: values.town } : {}),
        source: at.source,
      });
      setUndoId(done.undoId);
      setLine({ ok: true, text: t(`${NS}.applied`, { name: row.name }) });
    } catch (e) {
      setLine({ ok: false, text: fail(e) });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!undoId) return;
    // Undo writes to the archive too: it is confirmed like the write itself.
    const ok = await confirm({
      title: t(`${NS}.undoConfirm.title`),
      message: t(`${NS}.undoConfirm.message`, { plugin: plugin.name, name: row.name }),
      confirmText: t(`${NS}.undo`),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await suggestionPluginsApi.undoLocation(plugin.id, undoId);
      setUndoId(null);
      setLine({ ok: true, text: t(`${NS}.undone`, { name: row.name }) });
      onWritten();
    } catch (e) {
      setLine({ ok: false, text: fail(e) });
    } finally {
      setBusy(false);
    }
  };

  const id = `plugin-row-${plugin.id}-${row.rowId}`;
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <MaintenanceMap
        current={
          typeof row.lat === "number" && typeof row.lon === "number"
            ? { lat: row.lat, lon: row.lon }
            : null
        }
        proposals={row.proposals}
        picked={at}
        onPick={(p) => setAt({ ...p, source: "manual" })}
        ariaLabel={t(`${MS}.mapLabel`, { name: row.name })}
        attributionLabel={t("location:attribution")}
      />
      <p className="t-caption">{t(`${NS}.mapHint`)}</p>
      {row.proposals.length > 0 && (
        <div className="flex flex-wrap" style={{ gap: "var(--ts-space-xs)" }}>
          {row.proposals.map((p, i) => (
            <Button
              key={`${p.source}-${i}`}
              disabled={busy}
              onClick={() => {
                setAt({ lat: p.lat, lon: p.lon, source: p.source });
                if (p.street && !row.street) setStreet(p.street);
              }}
            >
              {i + 1} · {t(`${MS}.source.${p.source}`)} · {t(`${MS}.confidence.${p.confidence}`)}
            </Button>
          ))}
        </div>
      )}
      <p className="t-caption" data-testid="plugin-row-position">
        {at
          ? t(`${NS}.position`, { lat: coord(at.lat), lon: coord(at.lon) })
          : t(`${NS}.noPosition`)}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="t-caption flex flex-col gap-1" htmlFor={`${id}-street`}>
          {t(`${NS}.street`)}
          <Input
            id={`${id}-street`}
            value={street}
            maxLength={200}
            onChange={(e) => setStreet(e.target.value)}
          />
        </label>
        <label className="t-caption flex flex-col gap-1" htmlFor={`${id}-postcode`}>
          {t(`${NS}.postcode`)}
          <Input
            id={`${id}-postcode`}
            value={postcode}
            maxLength={32}
            onChange={(e) => setPostcode(e.target.value)}
          />
        </label>
        <label className="t-caption flex flex-col gap-1" htmlFor={`${id}-town`}>
          {t(`${NS}.town`)}
          <Input
            id={`${id}-town`}
            value={town}
            maxLength={200}
            onChange={(e) => setTown(e.target.value)}
          />
        </label>
      </div>
      {line && (
        <p
          className="t-caption"
          role={line.ok ? "status" : "alert"}
          style={{ color: line.ok ? "var(--ts-good)" : "var(--ts-bad)" }}
        >
          {line.text}
        </p>
      )}
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        <Button variant="primary" disabled={busy || !at || !!undoId} onClick={() => void take()}>
          {t(`${NS}.take`)}
        </Button>
        {undoId && (
          <Button disabled={busy} onClick={() => void undo()}>
            {t(`${NS}.undo`)}
          </Button>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
