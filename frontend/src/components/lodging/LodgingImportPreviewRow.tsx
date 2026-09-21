import type { JSX } from "react";
import { Fragment } from "react";
import type { LodgingCurrency } from "../../types/lodging";
import {
  HEURISTIC_MATCH,
  INPUT,
  changeSummary,
  currencyOptions,
  ensureLodging,
  ensureStay,
  matchedStayLabel,
  priceLacksCurrency,
  parseTotalPriceInput,
  type EditableRow,
} from "./lodgingImportRowModel";

export interface PreviewRowLineProps {
  row: EditableRow;
  onChange: (sourceRowIndex: number, patch: Partial<EditableRow>) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** For `formatStayPeriod`, which names the month of a month-precision stay. */
  language: string;
}

/**
 * ONE entry, across TWO table rows: the editable fields, then the hints as a
 * full-width line beneath them.
 *
 * They shared a row until 2026-09-19, and the hint cell was the narrowest
 * column carrying the longest text — "Aufenthalt bereits vorhanden (gleiche
 * Referenz)" wrapped to three lines and took the width the action control
 * needed, which then clipped its own selected value to "Übersp…". A reader
 * could neither see what the row would do nor that "Anlegen" was among the
 * choices. `colSpan` costs nothing and cannot be squeezed.
 */
export function PreviewRowLine({ row, onChange, t, language }: PreviewRowLineProps): JSX.Element {
  const { sourceRowIndex } = row;
  const name = row.lodging?.name ?? row.lodgingName ?? "";
  // A row can be `action: "create"` while `matchedLodgingId` already points
  // at an existing hotel — that row creates a STAY, not a new hotel. Show
  // the dedupe hint whenever a match exists, independent of the chosen
  // action, so the user is never told a hotel will be added when it won't.
  const showDedupeHint = row.dedupeHint !== "none";
  // A matched row attaches its stay to the EXISTING lodging on commit — the
  // commit service never reads `row.lodging` for it (lodgingImportCommit.ts:
  // `if (!lodgingId && row.lodging)`). Editing name/city here would look
  // saved but be silently discarded, so these two fields render read-only
  // instead of as editable inputs. Note `matchedLodgingId` can be set with
  // `dedupeHint === "none"` (the stays-only by-name join never sets a
  // dedupe hint), so this must be its own check, not derived from
  // `showDedupeHint`.
  const isMatched = row.matchedLodgingId !== null;
  const needsCurrency = priceLacksCurrency(row);
  const attention = row.decision === "" || needsCurrency;
  // A stay that already exists is the one case where the reader has to be told
  // that creating anyway is possible — the server's own choice is `skip` or
  // `update`, and both read as "nothing to decide here".
  const offersCreateAnyway = row.matchedStayId !== null && row.decision !== "create";
  // Whether the second row has anything in it. Derived from the same four
  // conditions the cells below render on, so a silent drift cannot leave an
  // empty band under an entry.
  const hasHints =
    row.flags.length > 0 ||
    showDedupeHint ||
    row.matchedStay != null ||
    (row.action === "update" && (row.changes ?? []).length > 0);

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
          {isMatched ? (
            <div>
              <div
                data-testid={`lodging-import-name-${sourceRowIndex}`}
                aria-label={t("lodging:import.fields.name")}
                title={t("lodging:import.matchedLodgingHint")}
                className={`${INPUT} cursor-not-allowed truncate text-[var(--text-muted)]`}
              >
                {name}
              </div>
              {/* The house the guess points at — plain JSX, not interpolated,
                so the test mock (which drops t() options) still shows it. */}
              {row.matchedLodgingName && (
                <p
                  data-testid={`lodging-import-matched-name-${sourceRowIndex}`}
                  className="mt-1 text-[10px] text-emerald-300"
                >
                  {t("lodging:import.matchedAs")} {row.matchedLodgingName}
                </p>
              )}
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                {t("lodging:import.matchedLodgingHint")}
              </p>
              {HEURISTIC_MATCH.has(row.dedupeHint) && (
                <button
                  type="button"
                  data-testid={`lodging-import-reject-match-${sourceRowIndex}`}
                  onClick={(): void =>
                    // Rejecting the guess makes this an ordinary unmatched row:
                    // the fields unlock, and `create` then creates a NEW house.
                    // Every trace of the match goes, `matchedStay` included —
                    // a described stay left behind would keep the hint line
                    // open (`hasHints`) and name a stay in a house this row no
                    // longer claims to be.
                    onChange(sourceRowIndex, {
                      matchedLodgingId: null,
                      matchedLodgingName: null,
                      matchedStayId: null,
                      matchedStay: null,
                      dedupeHint: "none",
                    })
                  }
                  className="mt-1 text-[10px] text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  {t("lodging:import.rejectMatch")}
                </button>
              )}
            </div>
          ) : (
            <input
              data-testid={`lodging-import-name-${sourceRowIndex}`}
              value={name}
              onChange={(e): void =>
                onChange(sourceRowIndex, {
                  // Immutable: a NEW lodging object, never a mutation of the
                  // prop. Mirrors the city-edit path below: a name edit on a
                  // NON-matched row must materialize `row.lodging` — otherwise
                  // `commitRowSchema` has no `lodgingName` field, commit reads
                  // only `lodging`/`matchedLodgingId`, and an unresolved row the
                  // user only renamed is guaranteed to fail with
                  // `missing_lodging_reference`.
                  lodging: { ...ensureLodging(row, name), name: e.target.value },
                  lodgingName: e.target.value,
                })
              }
              aria-label={t("lodging:import.fields.name")}
              className={INPUT}
            />
          )}
        </td>
        <td className="p-2">
          {isMatched ? (
            <div
              data-testid={`lodging-import-city-${sourceRowIndex}`}
              aria-label={t("lodging:import.fields.city")}
              title={t("lodging:import.matchedLodgingHint")}
              className={`${INPUT} cursor-not-allowed truncate text-[var(--text-muted)]`}
            >
              {row.lodging?.city ?? ""}
            </div>
          ) : (
            <input
              data-testid={`lodging-import-city-${sourceRowIndex}`}
              value={row.lodging?.city ?? ""}
              onChange={(e): void =>
                onChange(sourceRowIndex, {
                  lodging: { ...ensureLodging(row, name), city: e.target.value },
                })
              }
              aria-label={t("lodging:import.fields.city")}
              className={INPUT}
            />
          )}
        </td>
        <td className="p-2">
          <input
            type="date"
            data-testid={`lodging-import-checkin-${sourceRowIndex}`}
            value={row.stay?.checkIn ?? ""}
            onChange={(e): void =>
              onChange(sourceRowIndex, {
                stay: { ...ensureStay(row), checkIn: e.target.value },
              })
            }
            style={{ colorScheme: "dark" }}
            aria-label={t("lodging:import.fields.checkIn")}
            className={INPUT}
          />
        </td>
        <td className="p-2">
          <input
            type="date"
            data-testid={`lodging-import-checkout-${sourceRowIndex}`}
            value={row.stay?.checkOut ?? ""}
            onChange={(e): void =>
              onChange(sourceRowIndex, {
                stay: { ...ensureStay(row), checkOut: e.target.value },
              })
            }
            style={{ colorScheme: "dark" }}
            aria-label={t("lodging:import.fields.checkOut")}
            className={INPUT}
          />
        </td>
        <td className="p-2">
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
        </td>
        <td className="p-2">
          {/* Only once a stay exists — a currency alone would materialise an
            all-empty stay (see `isEmptyStay`) that the backend refuses. */}
          {row.stay !== null && (
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
              {currencyOptions(row.stay.currency).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
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
            // A width, not a truncation: the longest option is the German
            // "Aktualisieren", and a `w-full` select in a narrow column cut
            // its OWN selected value down to "Übersp…" — so the row said
            // nothing at all about what it would do.
            className={`${INPUT} min-w-[11rem]`}
          >
            <option value="">{t("lodging:import.actions.choose")}</option>
            <option value="create">{t("lodging:import.actions.create")}</option>
            <option value="skip">{t("lodging:import.actions.skip")}</option>
            {row.action === "update" && (
              <option value="update">{t("lodging:import.actions.update")}</option>
            )}
          </select>
          {/* The one control that names the alternative out loud.
            A <select> keeps its options behind a click, and the owner's
            complaint was exactly that: with a stay already on file the row
            read "Überspringen" and gave no sign that creating was even
            possible. The select stays — it is the full chooser, and every
            decision still travels through `decision` — and this button is the
            missing affordance, shown only where the server's own choice hides
            an alternative the reader may want. */}
          {offersCreateAnyway && (
            <button
              type="button"
              data-testid={`lodging-import-create-anyway-${sourceRowIndex}`}
              onClick={(): void => onChange(sourceRowIndex, { decision: "create" })}
              title={t("lodging:import.createAnywayHint")}
              className="mt-1 block text-[10px] text-[var(--accent)] underline-offset-2 hover:underline"
            >
              {t("lodging:import.createAnyway")}
            </button>
          )}
        </td>
      </tr>
      {/* The hints, full width under the entry they belong to, and only
          when there is something to say — an empty second row is a gap
          the reader has to account for. */}
      {hasHints && (
        <tr className={attention ? "bg-amber-500/5" : undefined}>
          <td colSpan={7} className="px-2 pb-2">
            <div className="flex flex-wrap gap-1">
              {row.flags.map((flag) => (
                <span
                  key={flag}
                  title={t(`lodging:import.flags.${flag}`)}
                  className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
                >
                  {t(`lodging:import.flags.${flag}`)}
                </span>
              ))}
              {/* An unknown chain is an OFFER, never a silent create — the
                  commit stopped adding whatever a parser took for a chain. One
                  tick per row decides it; unticked, the house imports without
                  a chain. */}
              {row.flags.includes("unknown_chain") && row.lodging?.chainName && (
                <label className="flex items-center gap-1 text-[10px] text-amber-300">
                  <input
                    type="checkbox"
                    checked={row.lodging.createChain === true}
                    onChange={(e): void =>
                      onChange(sourceRowIndex, {
                        lodging: { ...row.lodging!, createChain: e.target.checked },
                      })
                    }
                    className="h-3 w-3"
                  />
                  {t("lodging:import.createChain", { name: row.lodging.chainName })}
                </label>
              )}
              {showDedupeHint && (
                <span
                  title={t(`lodging:import.dedupeHints.${row.dedupeHint}`)}
                  className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300"
                >
                  {t(`lodging:import.dedupeHints.${row.dedupeHint}`)}
                </span>
              )}
              {/* WHICH stay is already there, not merely that one is. The
                  dates link to the house that holds it — a stay has no page of
                  its own — and open in a new tab so the half-finished import
                  is not lost. */}
              {row.matchedStay && (
                <span
                  data-testid={`lodging-import-matched-stay-${sourceRowIndex}`}
                  className="text-[10px] text-emerald-300"
                >
                  {t("lodging:import.matchedStayAt")}{" "}
                  <a
                    href={row.matchedStay.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t("lodging:import.openMatchedStay")}
                    className="underline underline-offset-2"
                  >
                    {matchedStayLabel(row.matchedStay, language, t)}
                  </a>
                </span>
              )}
              {/* A changed booking: say WHAT moves. "This differs" is not a
                  decision anyone can take. */}
              {row.action === "update" && (row.changes ?? []).length > 0 && (
                <span
                  data-testid={`lodging-import-changes-${sourceRowIndex}`}
                  title={changeSummary(row)}
                  className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300"
                >
                  {t("lodging:import.changedHint")}: {changeSummary(row)}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
