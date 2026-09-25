import {
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import { useTagSuggestions } from "../hooks/useTagSuggestions";
import { useTranslation } from "../hooks/useTranslation";
import { addTags, hasTag, splitTagText } from "../lib/tagList";

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  /** For a `<label htmlFor>` outside. */
  id?: string;
  /** For forms whose label is not a `<label htmlFor>`. */
  ariaLabel?: string;
  placeholder?: string;
  /** Classes of the box that looks like the form's other inputs. */
  className?: string;
  style?: CSSProperties;
  /** Chip colour; the trip form tints tags with the trip's colour. */
  accent?: string;
}

/**
 * Tags as chips, with the user's own tags offered while typing (most used
 * first, from `GET /tags`). Enter or a comma turns the text into a chip, a
 * pasted "a, b, c" becomes three, Backspace in the empty field takes the last
 * chip back. Tags stay free text: an unknown tag is as welcome as a known one.
 *
 * Text still in the field when it loses focus becomes a chip too — the forms
 * read the chips on save, and a tag typed but never confirmed would otherwise
 * be dropped without a word.
 */
export default function TagInput({
  value,
  onChange,
  id,
  ariaLabel,
  placeholder,
  className = "input",
  style,
  accent,
}: Props): JSX.Element {
  const { t } = useTranslation("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = useTagSuggestions(query, focused);

  // The server answers for the debounced text; this keeps the list true to
  // what is in the field right now, and never offers a tag already chosen.
  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return suggestions.filter(
      (s) => !hasTag(value, s.name) && (!needle || s.name.toLowerCase().includes(needle))
    );
  }, [suggestions, query, value]);
  const open = focused && options.length > 0;

  const add = (incoming: string[]): void => {
    setQuery("");
    setActive(-1);
    const next = addTags(value, incoming);
    if (next.length !== value.length) onChange(next);
  };

  const remove = (tag: string): void => {
    onChange(value.filter((v) => v !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (options.length === 0) return;
        e.preventDefault();
        const last = options.length - 1;
        setFocused(true);
        setActive((i) => (e.key === "ArrowDown" ? (i >= last ? 0 : i + 1) : i <= 0 ? last : i - 1));
        return;
      }
      case "Enter":
        if (open && active >= 0 && active < options.length) {
          e.preventDefault();
          add([options[active].name]);
        } else if (query.trim()) {
          e.preventDefault();
          add([query]);
        }
        return;
      case ",":
        e.preventDefault();
        add([query]);
        return;
      case "Backspace":
        if (query === "" && value.length > 0) {
          e.preventDefault();
          remove(value[value.length - 1]);
        }
        return;
      case "Escape":
        if (open) {
          // The list closes, not the modal around it.
          e.preventDefault();
          e.stopPropagation();
          setFocused(false);
        }
        return;
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData("text");
    if (!text.includes(",")) return;
    e.preventDefault();
    add([...splitTagText(query), ...splitTagText(text)]);
  };

  const activeOption = open && active >= 0 && active < options.length ? active : -1;
  const chipStyle: CSSProperties | undefined = accent
    ? { background: `${accent}1f`, border: `1px solid ${accent}66`, color: accent }
    : undefined;

  return (
    <div className="relative">
      <div
        className={`${className} flex flex-wrap items-center gap-1.5 focus-within:ring-2 focus-within:border-(--accent)`}
        style={style}
        onMouseDown={(e) => {
          // A click on the box's padding focuses the text field, as a real input would.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm ${
              accent ? "" : "border border-border bg-(--bg-elevated) text-(--text-primary)"
            }`}
            style={chipStyle}
          >
            {tag}
            <button
              type="button"
              aria-label={t("tagInput.remove", { name: tag })}
              // The test i18n mock ignores interpolation, so every chip's label
              // reads the same there; a per-tag id is what can address one.
              data-testid={`tag-remove-${tag}`}
              onClick={() => remove(tag)}
              className="opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption >= 0 ? `${listId}-${activeOption}` : undefined}
          autoComplete="off"
          className="min-w-24 flex-1 border-0 bg-transparent p-0 text-inherit outline-hidden placeholder:text-(--text-muted) focus:ring-0"
          placeholder={value.length === 0 ? placeholder : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
            setFocused(true);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (query.trim()) add([query]);
          }}
        />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("tagInput.suggestions")}
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-(--bg-surface) shadow-lg"
        >
          {options.map((option, i) => (
            <li
              key={option.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeOption}
              // mousedown, not click: a click would blur the field first, and
              // the blur would commit the half-typed text as its own tag.
              onMouseDown={(e) => {
                e.preventDefault();
                add([option.name]);
              }}
              className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-(--text-primary) ${
                i === activeOption ? "bg-(--bg-elevated)" : "hover:bg-(--bg-elevated)"
              }`}
            >
              <span>{option.name}</span>
              <span className="text-xs text-(--text-muted)">
                {t("tagInput.usage", { count: option.usageCount })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
