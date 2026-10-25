import type { JSX } from "react";
import { Fragment } from "react";
import type { LodgingCurrency } from "../../types/lodging";
import { formatLocalDate } from "../../lib/displayFormat";
import {
  INPUT,
  currencyOptionGroups,
  ensureStay,
  parseTotalPriceInput,
  type EditableRow,
} from "./lodgingImportRowModel";
import { canCreate, createActionKey, rowBlockers } from "./lodgingImportRowState";
import { CityCell, NameCell } from "./LodgingImportRowIdentity";
import { RowHints, rowHints } from "./LodgingImportRowHints";

export interface PreviewRowLineProps {
  row: EditableRow;
  onChange: (sourceRowIndex: number, patch: Partial<EditableRow>) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** For `formatStayPeriod`, which names the month of a month-precision stay. */
  language: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A skipped row's value, as text: nothing on it will be written. */
function ReadOnly({ value, testId }: { value: string; testId: string }): JSX.Element {
  return (
    <span data-testid={testId} className="text-[var(--text-muted)]">
      {value}
    </span>
  );
}

const dayText = (day: string | undefined): string =>
  day && ISO_DAY.test(day) ? formatLocalDate(day) : (day ?? "");

/**
 * ONE entry, across TWO table rows: the editable fields, then the hints as a
 * full-width line beneath them.
 *
 * They shared a row until 2026-09-19, and the hint cell was the narrowest
 * column carrying the longest text — "Aufenthalt bereits vorhanden (gleiche
 * Referenz)" wrapped to three lines and took the width the action control
 * needed, which then clipped its own selected value to "Übersp…". `colSpan`
 * costs nothing and cannot be squeezed.
 *
 * A SKIPPED row writes nothing, so it offers nothing to edit and promises
 * nothing: its values are text, and only the action stays a control.
 */
export function PreviewRowLine({ row, onChange, t, language }: PreviewRowLineProps): JSX.Element {
  const { sourceRowIndex } = row;
  const skipped = row.decision === "skip";
  const attention = row.decision === "" || rowBlockers(row).length > 0;
  // A stay that already exists is the one case where the reader has to be told
  // that creating anyway is possible — the server's own choice is `skip` or
  // `update`, and both read as "nothing to decide here".
  const offersCreateAnyway = row.matchedStayId !== null && row.decision !== "create";
  const hints = rowHints(row);
  const stayField = (testId: string, field: "checkIn" | "checkOut"): JSX.Element =>
    skipped ? (
      <ReadOnly testId={testId} value={dayText(row.stay?.[field])} />
    ) : (
      <input
        type="date"
        data-testid={testId}
        value={row.stay?.[field] ?? ""}
        onChange={(e): void =>
          onChange(sourceRowIndex, { stay: { ...ensureStay(row), [field]: e.target.value } })
        }
        style={{ colorScheme: "dark" }}
        aria-label={t(`lodging:import.fields.${field}`)}
        className={INPUT}
      />
    );

  return (
    <Fragment>
      <tr
        className={
          attention
            ? "border-t border-[var(--color-border)] bg-amber-500/5"
            : "border-t border-[var(--color-border)]"
        }
      >
        <td className="p-2">
          <NameCell row={row} t={t} onChange={onChange} />
        </td>
        <td className="p-2">
          <CityCell row={row} t={t} onChange={onChange} />
        </td>
        <td className="p-2">{stayField(`lodging-import-checkin-${sourceRowIndex}`, "checkIn")}</td>
        <td className="p-2">
          {stayField(`lodging-import-checkout-${sourceRowIndex}`, "checkOut")}
        </td>
        <td className="p-2">
          {skipped ? (
            <ReadOnly
              testId={`lodging-import-price-${sourceRowIndex}`}
              value={row.stay?.totalPrice != null ? String(row.stay.totalPrice) : ""}
            />
          ) : (
            <input
              type="number"
              data-testid={`lodging-import-price-${sourceRowIndex}`}
              value={row.stay?.totalPrice ?? ""}
              onChange={(e): void =>
                onChange(sourceRowIndex, {
                  stay: { ...ensureStay(row), totalPrice: parseTotalPriceInput(e.target.value) },
                })
              }
              aria-label={t("lodging:import.fields.totalPrice")}
              className={INPUT}
            />
          )}
        </td>
        <td className="p-2">
          {/* Only once a stay exists — a currency alone would materialise an
            all-empty stay (see `isEmptyStay`) that the backend refuses. */}
          {skipped ? (
            <ReadOnly
              testId={`lodging-import-currency-${sourceRowIndex}`}
              value={row.stay?.currency ?? ""}
            />
          ) : (
            row.stay !== null && (
              <select
                data-testid={`lodging-import-currency-${sourceRowIndex}`}
                value={row.stay.currency ?? ""}
                onChange={(e): void =>
                  onChange(sourceRowIndex, {
                    stay: {
                      ...ensureStay(row),
                      currency: e.target.value ? (e.target.value as LodgingCurrency) : null,
                    },
                  })
                }
                aria-label={t("lodging:import.fields.currency")}
                className={INPUT}
              >
                <option value="">{t("lodging:import.preview.chooseCurrency")}</option>
                <optgroup label={t("common:currencySelect.frequent")}>
                  {currencyOptionGroups(row.stay.currency).frequent.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("common:currencySelect.all")}>
                  {currencyOptionGroups(row.stay.currency).rest.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </optgroup>
              </select>
            )
          )}
        </td>
        <td className="p-2">
          <select
            data-testid={`lodging-import-action-${sourceRowIndex}`}
            value={row.decision}
            onChange={(e): void =>
              onChange(sourceRowIndex, {
                decision: e.target.value as EditableRow["decision"],
              })
            }
            aria-label={t("lodging:import.fields.action")}
            // A width, not a truncation: a `w-full` select in a narrow column
            // cut its OWN selected value down to "Übersp…".
            className={`${INPUT} min-w-[13rem]`}
          >
            <option value="">{t("lodging:import.actions.choose")}</option>
            {/* Named for what it does to THIS row. A matched hotel with no
                stay has nothing to create, so it is not offered there. */}
            {(canCreate(row) || row.decision === "create") && (
              <option value="create">{t(`lodging:import.actions.${createActionKey(row)}`)}</option>
            )}
            {row.action === "update" && (
              <option value="update">{t("lodging:import.actions.update")}</option>
            )}
            <option value="skip">{t("lodging:import.actions.skip")}</option>
          </select>
          {/* The one control that names the alternative out loud: with a stay
            already on file the row read "Überspringen" and gave no sign that
            creating was even possible. */}
          {offersCreateAnyway && (
            <button
              type="button"
              data-testid={`lodging-import-create-anyway-${sourceRowIndex}`}
              onClick={(): void => onChange(sourceRowIndex, { decision: "create" })}
              title={t("lodging:import.createAnywayHint")}
              className="mt-1 block text-[10px] text-[var(--accent)] underline-offset-2 hover:underline"
            >
              {t("lodging:import.actions.createAnotherStay")}
            </button>
          )}
        </td>
      </tr>
      {/* The hints, full width under the entry they belong to, and only
          when there is something to say. */}
      {hints.any && (
        <tr className={attention ? "bg-amber-500/5" : undefined}>
          <td colSpan={7} className="px-2 pb-2">
            <RowHints row={row} t={t} language={language} onChange={onChange} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}
