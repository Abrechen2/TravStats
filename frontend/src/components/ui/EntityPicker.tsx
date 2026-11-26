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
  /** Hover text of the row (a closed airport says so). */
  title?: string;
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
  /** Between the box and the result list (a "near you" section that is not a search result). */
  beforeList?: ReactNode;
  /** A heading above the result list. */
  listTitle?: string;
  /**
   * The list floats under the box instead of sitting in the flow, for a
   * picker inside a form row. Pressing a row never takes focus from the box.
   */
  popover?: boolean;
  /** Popover only: whether the list is showing. Defaults to "there is text". */
  open?: boolean;
  /**
   * Free text is a valid answer (a companion's name that is not in the list).
   * No row is highlighted until an arrow key moves there, so Enter submits
   * what was typed, and `onSubmitText` receives it.
   */
  onSubmitText?: (text: string) => void;
  /** Only the box's accessible name; no visible label above it. */
  hideLabel?: boolean;
  /** Said under the list when `showEmpty` is false and nothing matched (never both). */
  showEmpty?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Id, `aria-describedby`, `disabled`, `title`, `required` … for the box itself. */
  inputProps?: Omit<
    import("./SearchInput").SearchInputProps,
    "value" | "onChange" | "label" | "variant" | "inputRef"
  >;
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
  beforeList,
  listTitle,
  popover = false,
  open,
  onSubmitText,
  hideLabel = false,
  showEmpty = true,
  onFocus,
  onBlur,
  inputProps,
}: EntityPickerProps<T>): JSX.Element {
  const { t } = useTranslation(["common"]);
  const listId = useId();
  const freeText = onSubmitText !== undefined;
  const [active, setActive] = useState(freeText ? -1 : 0);
  const last = options.length - 1;
  const current = active < 0 ? -1 : Math.min(active, Math.max(last, 0));
  const hasBody = status !== "ready" || options.length > 0 || showEmpty;
  const showing = hasBody && (popover ? (open ?? query.trim().length > 0) : true);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && freeText && current < 0) {
      event.preventDefault();
      onSubmitText(query);
      return;
    }
    if (status !== "ready" || options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(current + 1, last));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(current - 1, freeText ? -1 : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (current >= 0) onPick(options[current]);
    }
  };

  const input = (
    <SearchInput
      {...inputProps}
      label={label}
      value={query}
      onChange={(next) => {
        setActive(freeText ? -1 : 0);
        onQueryChange(next);
      }}
      debounceMs={debounceMs}
      placeholder={placeholder}
      testId={searchTestId}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      role="combobox"
      aria-expanded={showing && status === "ready" && options.length > 0}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={
        showing && status === "ready" && current >= 0 && options.length > 0
          ? `${listId}-${current}`
          : undefined
      }
    />
  );

  const body = showing ? (
    <>
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
      {status === "ready" && options.length === 0 && showEmpty ? (
        <p className="t-body" data-testid={emptyTestId}>
          {emptyText ?? t("common:ui.picker.none")}
        </p>
      ) : null}
      {status === "ready" && options.length > 0 && listTitle ? (
        <p className="t-caption" style={{ fontWeight: 600 }}>
          {listTitle}
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
                title={option.title}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(option)}
                onMouseEnter={() => setActive(index)}
                className="t-body flex w-full items-center pointer-coarse:min-h-(--ts-size-touch-min)"
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
                  {option.detail ? (
                    <>
                      <span aria-hidden className="t-caption">
                        {" · "}
                      </span>
                      <span className="t-caption">{option.detail}</span>
                    </>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  ) : null;

  return (
    <div
      className={popover ? "relative flex flex-col" : "flex flex-col"}
      style={{ gap: "var(--ts-space-sm)" }}
    >
      {hideLabel ? (
        input
      ) : (
        <label className="t-caption flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
          {label}
          {input}
        </label>
      )}
      {beforeList}
      {popover ? (
        body ? (
          <div
            className="absolute left-0 right-0 z-10 flex max-h-60 flex-col overflow-auto"
            style={{
              top: "100%",
              marginTop: 4,
              padding: "var(--ts-space-sm)",
              gap: "var(--ts-space-sm)",
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
              borderRadius: "var(--ts-radius-card)",
              boxShadow: "var(--ts-shadow-paper-card)",
            }}
          >
            {body}
          </div>
        ) : null
      ) : (
        body
      )}
      {footer}
    </div>
  );
}
