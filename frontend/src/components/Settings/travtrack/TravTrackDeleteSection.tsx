import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useTravTrackCapabilities } from "../../../hooks/useTravTrackVisible";
import { trackErrorKey, travTrackApi } from "../../../lib/api/travtrack";
import { Field, Input } from "../../ui/Field";
import { SettingRows } from "../../ui/SettingRow";
import { ActionControl, ErrorLine, SettingItem } from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import { useBlockConfirm } from "../useBlockConfirm";
import { RowFailure, useRowAction } from "../location/useRowAction";
import { useSpanCount, useSpanPreset } from "./useSpan";

const NS = "settings:tt.delete";

/**
 * Settings → TravTrack → Zeitraum löschen: a span (preset by
 * `?from=&until=`, never filled in on its own), the count that will go, read
 * from the summary of exactly that span, and a confirmation that asks for the
 * word typed out. The button is dead while the count has not been read: a
 * delete is never offered for an amount nobody saw. The span stays deleted for
 * a phone that sends it later; logbook entries are untouched.
 */
export default function TravTrackDeleteSection(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const caps = useTravTrackCapabilities();
  const preset = useSpanPreset();
  const { confirm, dialog } = useBlockConfirm();
  const [from, setFrom] = useState(preset.from);
  const [until, setUntil] = useState(preset.until);
  const [version, setVersion] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const count = useSpanCount(from, until, version);
  const del = useRowAction((err) => t(trackErrorKey(err)));
  if (!caps || !(caps.hasData || caps.enabled) || isDemo) return null;

  const invalid = from !== "" && until !== "" && from > until;

  const run = async (): Promise<void> => {
    if (count.kind !== "count") return;
    setNote(null);
    const amount = count.count;
    await del.run(async () => {
      const agreed = await confirm({
        title: t(`${NS}.confirm.title`),
        affects: t(`${NS}.confirm.affects`, { from, until }),
        amount: t(`${NS}.confirm.amount`, { count: amount }),
        after: t(`${NS}.confirm.after`),
        confirmLabel: t(`${NS}.confirm.do`, { count: amount }),
        word: t(`${NS}.confirm.word`),
      });
      if (!agreed) return;
      const deleted = await travTrackApi.deleteDays({ fromDay: from, toDay: until });
      setNote(t(`${NS}.done`, { count: deleted }));
      setVersion((v) => v + 1);
    });
  };

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t(`${NS}.name`)}
          sub={t(`${NS}.sub`)}
          help={t(`${NS}.help`)}
          control={
            <ActionControl
              danger
              label={t(`${NS}.do`)}
              busy={del.busy}
              disabled={count.kind !== "count" || count.count === 0 || invalid}
              onClick={() => void run()}
            />
          }
        >
          <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-sm)" }}>
            <Field label={t(`${NS}.from`)} htmlFor="tt-delete-from">
              <Input
                id="tt-delete-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label={t(`${NS}.until`)} htmlFor="tt-delete-until">
              <Input
                id="tt-delete-until"
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
          </div>
          {invalid ? <ErrorLine>{t(`${NS}.invalidRange`)}</ErrorLine> : null}
          {count.kind === "counting" ? (
            <p className="t-caption" style={{ margin: 0 }}>
              {t(`${NS}.counting`)}
            </p>
          ) : count.kind === "count" ? (
            <p className="t-caption" role="status" data-testid="delete-count" style={{ margin: 0 }}>
              {count.count === 0 ? t(`${NS}.none`) : t(`${NS}.affected`, { count: count.count })}
            </p>
          ) : count.kind === "failed" ? (
            <ErrorLine>{t(count.key)}</ErrorLine>
          ) : null}
          <RowFailure error={del.error} onRetry={del.retry} />
          {note ? (
            <p role="status" className="t-caption" style={{ margin: 0, color: "var(--ts-good)" }}>
              {note}
            </p>
          ) : null}
        </SettingItem>
      </SettingRows>
      {dialog}
    </SectionCard>
  );
}
