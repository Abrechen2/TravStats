import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { pendingUpdatesApi } from "../../../lib/api/pendingUpdates";
import type { PendingUpdate, FlightUpdateData } from "../../../lib/api/types";
import { useDisplayFormat } from "../../../lib/displayFormat";
import Button from "../../ui/Button";
import type { InboxAction } from "./FlagQuickEditor";
import { W } from "./model";

/** All proposed fields stay visible. Saving the draft and applying it are separate API acts. */
export default function FlightUpdateCard({
  update,
  busy,
  act,
}: {
  update: PendingUpdate;
  busy: boolean;
  act: InboxAction;
}) {
  const { t } = useTranslation(["dataQuality", "pendingUpdates"]);
  const format = useDisplayFormat();
  const fieldLabel = (field: string) =>
    t(`pendingUpdates:editor.${field}`, {
      defaultValue: t(`pendingUpdates:editor.fields.${field}`, { defaultValue: field }),
    });
  const [draft, setDraft] = useState<FlightUpdateData>({});
  const changes = update.editedChanges ?? update.changes;
  const proposed = update.editedData ?? update.proposedData;
  const expired = Date.parse(update.expiresAt) <= Date.now();
  const value = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || expired) return;
        void act(async () => {
          if (Object.keys(draft).length > 0)
            await pendingUpdatesApi.update(update.id, { ...proposed, ...draft });
          await pendingUpdatesApi.apply(update.id);
        });
      }}
    >
      <p className="t-caption">
        {t(`${W}.source`)}:{" "}
        {t(`pendingUpdates:apiSource.${update.apiSource}`, { defaultValue: update.apiSource })} ·{" "}
        {format.dateTime(update.fetchedAt)}
      </p>
      {update.flight && (
        <p className="text-sm">
          {format.dateTime(update.flight.departureTime, { timeZone: "UTC" })} UTC ·{" "}
          <Link className="underline" to={`/flights/${update.flightId}`}>
            {t(`${W}.openRecord`)}
          </Link>
        </p>
      )}
      <fieldset disabled={busy || expired} className="min-w-0 space-y-3">
        <legend className="t-label-mono mb-2">{t(`${W}.compare`)}</legend>
        {changes.map((change) => {
          const isTime = /Time$/.test(change.field);
          const current = Object.prototype.hasOwnProperty.call(draft, change.field)
            ? draft[change.field]
            : proposed[change.field];
          const originalType = typeof (proposed[change.field] ?? change.oldValue);
          const editable =
            typeof current === "string" ||
            typeof current === "number" ||
            typeof current === "boolean" ||
            current == null;
          return (
            <div
              key={change.field}
              className="grid gap-2 rounded-lg border border-(--ts-border) p-3 sm:grid-cols-2"
            >
              <div>
                <p className="text-sm font-semibold">
                  {fieldLabel(change.field)}
                  {isTime ? " (UTC)" : ""}
                </p>
                <p className="t-caption">
                  {t(`${W}.stored`)}: {value(change.oldValue)}
                </p>
              </div>
              <label className="text-sm">
                {t(`${W}.proposed`)}
                {originalType === "boolean" ? (
                  <select
                    className="input mt-1 w-full"
                    aria-label={fieldLabel(change.field)}
                    value={current == null ? "" : String(current)}
                    onChange={(e) =>
                      setDraft((old) => ({
                        ...old,
                        [change.field]: e.target.value === "" ? null : e.target.value === "true",
                      }))
                    }
                  >
                    <option value="">—</option>
                    <option value="true">{t("common:buttons.yes")}</option>
                    <option value="false">{t("common:buttons.no")}</option>
                  </select>
                ) : (
                  editable && (
                    <input
                      className="input mt-1 w-full"
                      aria-label={fieldLabel(change.field)}
                      type={
                        originalType === "number" ? "number" : isTime ? "datetime-local" : "text"
                      }
                      step={originalType === "number" ? "any" : isTime ? "1" : undefined}
                      value={
                        isTime && typeof current === "string"
                          ? current.replace(/Z$/, "").slice(0, 19)
                          : current == null
                            ? ""
                            : String(current)
                      }
                      onChange={(e) =>
                        setDraft((old) => ({
                          ...old,
                          [change.field]:
                            e.target.value === ""
                              ? null
                              : originalType === "number"
                                ? Number(e.target.value)
                                : isTime
                                  ? `${e.target.value}Z`
                                  : e.target.value,
                        }))
                      }
                    />
                  )
                )}
              </label>
            </div>
          );
        })}
      </fieldset>
      <p className="t-caption">{t(`${W}.flightEffect`, { count: changes.length })}</p>
      {expired && <p role="status">{t(`${W}.expired`)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy || expired}>
          {t(`${W}.applyFlight`)}
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() => void act(() => pendingUpdatesApi.reject(update.id))}
        >
          {t(`${W}.keepFlight`)}
        </Button>
      </div>
    </form>
  );
}
