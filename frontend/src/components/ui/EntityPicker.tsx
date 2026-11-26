import { useId, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Button from "./Button";
import { SearchInput } from "./SearchInput";
import type { JSX, KeyboardEvent, ReactNode } from "react";

export interface EntityOption {
  id: string;
  /** The name. */
  label: ReactNode;
  /** After the name, quieter: a city, a country, a code. */
  detail?: ReactNode;
  /** Before the name: a flag, an airline logo, a domain icon. */
  mark?: ReactNode;
}

export type EntityPickerStatus = "ready" | "loading" | "failed";

interface EntityPickerProps<T extends EntityOption> {
  /** Visible label and accessible name of the search box. */
  label: string;
  query: string;
  onQueryChange: (query: string) => void;
  options: readonly T[];
  onPick: (option: T) => void;
  /** `loading` and `failed` each say so; a failed search is never an empty list. */
  status?: EntityPickerStatus;
  onRetry?: () => void;
  /** Said when the search finished and found nothing. Defaults to the shared copy. */
  emptyText?: string;
  /** Said while the search runs / when it failed / on the retry button. Default to the shared copy. */
  loadingText?: string;
  failedText?: string;
  retryText?: string;
  placeholder?: string;
  debounceMs?: number;
  searchTestId?: string;
  emptyTestId?: string;
  /** Under the list: "Create it", the way out of a list that is missing the thing. */
  footer?: ReactNode;
}

/**
 * Search box plus result list, in one control.
 *
 * The three pickers that had a list below a box each handled loading, failure
 * and "no match" differently — one answered a failed search with "no match".
 * Here a failure is its own state with a retry, a pick is one click or Enter,
 * and the arrow keys walk the list while focus stays in the box (listbox with
 * `aria-activedescendant`).
 */
export function EntityPicker<T extends EntityOption>({
  label,
  query,
  onQueryChange,
  options,
  onPick,
  status = "ready",
  onRetry,
  emptyText,
  loadingText,
  failedText,
  retryText,
  placeholder,
  debounceMs,
  searchTestId,
  emptyTestId,
  footer,
}: EntityPickerProps<T>): JSX.Element {
  const { t } = useTranslation(["common"]);
  const listId = useId();
  const [active, setActive] = useState(0);
  const last = options.length - 1;
  const current = Math.min(active, Math.max(last, 0));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (status !== "ready" || options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(current + 1, last));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      onPick(options[current]);
    }
  };

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <label className="t-caption flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
        {label}
        <SearchInput
          label={label}
          value={query}
          onChange={(next) => {
            setActive(0);
            onQueryChange(next);
          }}
          debounceMs={debounceMs}
          placeholder={placeholder}
          testId={searchTestId}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={status === "ready" && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            status === "ready" && options.length > 0 ? `${listId}-${current}` : undefined
          }
        />
      </label>
      {status === "loading" ? (
        <p className="t-caption" role="status">
          {loadingText ?? t("common:ui.picker.loading")}
        </p>
      ) : null}
      {status === "failed" ? (
        <div role="alert" className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <p className="t-body" style={{ color: "var(--ts-bad)" }}>
            {failedText ?? t("common:ui.picker.failed")}
          </p>
          {onRetry ? (
            <div>
              <Button variant="secondary" onClick={onRetry}>
                {retryText ?? t("common:ui.picker.retry")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {status === "ready" && options.length === 0 ? (
        <p className="t-body" data-testid={emptyTestId}>
          {emptyText ?? t("common:ui.picker.none")}
        </p>
      ) : null}
      {status === "ready" && options.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("common:ui.picker.results")}
          className="flex flex-col"
          style={{ listStyle: "none", margin: 0, padding: 0, gap: 2 }}
        >
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onPick(option)}
                onMouseEnter={() => setActive(index)}
                className="t-body flex w-full items-center"
                style={{
                  minHeight: "var(--ts-size-touch-min)",
                  gap: "var(--ts-space-md)",
                  padding: "0 var(--ts-space-md)",
                  textAlign: "left",
                  borderRadius: "var(--ts-radius-button)",
                  background: index === current ? "var(--ts-tile)" : "transparent",
                }}
              >
                {option.mark ? (
                  <span className="flex shrink-0 items-center">{option.mark}</span>
                ) : null}
                <span className="min-w-0 flex-1">
                  {option.label}
                  {option.detail ? <span className="t-caption"> · {option.detail}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {footer}
    </div>
  );
}
