import { useEffect, useRef, useState } from "react";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useTranslation } from "../../hooks/useTranslation";
import { Icon } from "./Icon";
import type { InputHTMLAttributes, JSX, MutableRefObject, Ref } from "react";

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "size"
> {
  value: string;
  onChange: (value: string) => void;
  /** The accessible name. A placeholder is not one: it vanishes on typing. */
  label: string;
  /**
   * Hold `onChange` back until typing pauses, for a box whose every keystroke
   * would reach the server. The text in the box stays immediate; only the
   * callback waits. Clearing is never delayed.
   */
  debounceMs?: number;
  /** `field` is a bordered form field; `inline` sits in a bar that draws its own frame. */
  variant?: "field" | "inline";
  inputRef?: Ref<HTMLInputElement>;
  /** Extra classes on the input itself (a width in a tight bar). */
  inputClassName?: string;
  /** Stable hook for tests; lands on the input. */
  testId?: string;
}

/**
 * The one search box: a leading glass, a clear button when there is text, an
 * accessible name, and a 44 px target on a finger. Twenty hand-built boxes
 * differed in which of those they had (ui-unify audit, 2026-11-26).
 *
 * It stays a real `type="search"` input, so the `searchbox` role and the
 * mobile "search" keyboard key come for free; the browser's own cancel glyph is
 * hidden because ours replaces it.
 */
export function SearchInput({
  value,
  onChange,
  label,
  debounceMs,
  variant = "field",
  inputRef,
  inputClassName,
  testId,
  className,
  style,
  ...rest
}: SearchInputProps): JSX.Element {
  const { t } = useTranslation(["common"]);
  const coarse = useCoarsePointer();
  const innerRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(value);
  // What the parent last knew: a change of `value` that is not ours is adopted.
  const known = useRef(value);
  // The caller's closure changes every render; the timer must not restart for it.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (value !== known.current) {
      known.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (!debounceMs || draft === known.current) return;
    const timer = setTimeout(() => {
      known.current = draft;
      onChangeRef.current(draft);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [draft, debounceMs]);

  const text = debounceMs ? draft : value;
  const emit = (next: string): void => {
    if (debounceMs) {
      setDraft(next);
    } else {
      onChange(next);
    }
  };
  const clear = (): void => {
    known.current = "";
    setDraft("");
    onChange("");
    innerRef.current?.focus();
  };

  const inline = variant === "inline";
  return (
    <div
      className={`flex items-center${className ? ` ${className}` : ""}`}
      style={{
        gap: "var(--ts-space-sm)",
        minHeight: coarse ? "var(--ts-size-touch-min)" : inline ? 36 : 40,
        padding: "0 var(--ts-space-md)",
        borderRadius: "var(--ts-radius-button)",
        background: inline ? "var(--ts-tile)" : "var(--ts-surface)",
        border: inline ? "none" : "1px solid var(--ts-border-input)",
        color: "var(--ts-muted)",
        ...style,
      }}
    >
      <Icon name="search" size={16} />
      <input
        {...rest}
        ref={(node) => {
          innerRef.current = node;
          if (typeof inputRef === "function") inputRef(node);
          else if (inputRef) (inputRef as MutableRefObject<HTMLInputElement | null>).current = node;
        }}
        type="search"
        aria-label={label}
        data-testid={testId}
        value={text}
        onChange={(event) => emit(event.target.value)}
        className={`min-w-0 flex-1 bg-transparent text-sm focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-(--ts-accent) outline-hidden pointer-coarse:min-h-(--ts-size-touch-min) [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden${inputClassName ? ` ${inputClassName}` : ""}`}
        style={{ color: "var(--ts-text-bright)", minHeight: "inherit" }}
      />
      {text.length > 0 && !rest.disabled && !rest.readOnly ? (
        <button
          type="button"
          onClick={clear}
          aria-label={t("common:ui.clearSearch")}
          className="flex shrink-0 items-center justify-center"
          style={{
            width: coarse ? "var(--ts-size-touch-min)" : 28,
            height: coarse ? "var(--ts-size-touch-min)" : 28,
            marginRight: coarse ? -10 : -4,
            color: "var(--ts-muted)",
            background: "transparent",
          }}
        >
          <Icon name="x" size={16} />
        </button>
      ) : null}
    </div>
  );
}
