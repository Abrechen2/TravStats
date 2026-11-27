import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import { answerInBulk, type BulkResult } from "../../../lib/api/inboxBulk";
import { dataQualityFlagsApi } from "../../../lib/api/dataQualityFlags";
import Button from "../../ui/Button";
import { W, type InboxItem } from "./model";

type Line = { ok: boolean; text: string; failures: string[]; undo: string[] };

/**
 * "Alle annehmen" / "Alle verwerfen" for a group (a trip) or the filtered set (owner 2026-11-26).
 * The confirmation names the count and the kinds; accepting takes only what needs no input and
 * says what stays. Each item is answered on its own; failures are listed with their reason.
 */
export default function BulkActions({
  items,
  onDone,
  testId,
}: {
  items: InboxItem[];
  onDone: () => void | Promise<void>;
  testId?: string;
}): JSX.Element | null {
  const { t } = useTranslation(["dataQuality"]);
  const { confirm, confirmDialog } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Line | null>(null);
  if (items.length < 2 && !line) return null;

  const kinds = () => {
    const by = new Map<string, number>();
    for (const i of items) by.set(i.source, (by.get(i.source) ?? 0) + 1);
    return [...by.entries()].map(([k, n]) => `${n} ${t(`${W}.sources.${k}`)}`).join(", ");
  };
  const subject = (r: BulkResult) =>
    items.find((i) => i.source === r.kind && i.data.id === r.id)?.subject ?? r.id;

  const run = async (action: "accept" | "reject") => {
    const ok = await confirm({
      title: t(`${W}.bulk.${action}Title`),
      message: [
        t(`${W}.bulk.summary`, { count: items.length, kinds: kinds() }),
        t(`${W}.bulk.${action}Note`),
      ].join("\n"),
      confirmText: t(`${W}.bulk.${action}`),
      destructive: action === "reject",
    });
    if (!ok) return;
    setBusy(true);
    setLine(null);
    try {
      const results = await answerInBulk(
        action,
        items.map((i) => ({ kind: i.source, id: String(i.data.id) }))
      );
      const n = (o: BulkResult["outcome"]) => results.filter((r) => r.outcome === o).length;
      setLine({
        ok: n("failed") === 0,
        text: t(`${W}.bulk.result`, {
          done: n("done"),
          skipped: n("skipped"),
          failed: n("failed"),
        }),
        failures: results
          .filter((r) => r.outcome === "failed")
          .map(
            (r) =>
              `${subject(r)}: ${t(`${W}.bulk.reasons.${r.reason}`, { defaultValue: r.reason ?? "" })}`
          ),
        undo: results.filter((r) => r.undoable && r.outcome === "done").map((r) => r.id),
      });
      await onDone();
    } catch (e) {
      console.warn("inbox bulk answer failed", e);
      setLine({ ok: false, text: t(`${W}.bulk.failed`), failures: [], undo: [] });
    } finally {
      setBusy(false);
    }
  };

  const undo = async (ids: string[]) => {
    setBusy(true);
    let failed = 0;
    for (const id of ids) {
      try {
        await dataQualityFlagsApi.undo(id);
      } catch (e) {
        console.warn("inbox bulk undo failed", id, e);
        failed += 1;
      }
    }
    setLine({
      ok: failed === 0,
      text: failed ? t(`${W}.bulk.undoFailed`, { count: failed }) : t(`${W}.bulk.undone`),
      failures: [],
      undo: [],
    });
    setBusy(false);
    await onDone();
  };

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      {items.length >= 2 && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void run("accept")}>
            {t(`${W}.bulk.accept`)} ({items.length})
          </Button>
          <Button disabled={busy} onClick={() => void run("reject")}>
            {t(`${W}.bulk.reject`)} ({items.length})
          </Button>
        </div>
      )}
      {line && (
        <div role={line.ok ? "status" : "alert"} className="t-caption">
          <p style={{ color: line.ok ? "var(--ts-good)" : "var(--ts-bad)" }}>{line.text}</p>
          {line.failures.length > 0 && (
            <ul>
              {line.failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          {line.undo.length > 0 && (
            <Button disabled={busy} onClick={() => void undo(line.undo)}>
              {t(`${W}.bulk.undo`, { count: line.undo.length })}
            </Button>
          )}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
