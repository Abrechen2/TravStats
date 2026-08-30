// A text field for one emoji, with a picker behind a button.
//
// Two things about this are deliberate and load-bearing.
//
// THE DATA IS SELF-HOSTED. `emoji-picker-element` defaults to fetching its
// emoji database from a public CDN, and most pickers do the same. TravStats is
// self-hosted and routinely runs on a LAN with no way out — a CDN default would
// be a control that simply never opens, on exactly the installations this
// project exists for. The JSON ships with the bundle instead, imported as an
// asset so Vite fingerprints it; a test pins that the URL is local.
//
// THE TEXT FIELD STAYS. The picker is a custom element loaded on demand and
// backed by IndexedDB, and both of those can fail for reasons that have nothing
// to do with us: a private window blocks IndexedDB, a chunk fails to arrive.
// Pasting an emoji into the input has to keep working, or a failure in the
// convenience takes the whole setting with it.

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

// German gets CLDR's native names — "Pommes frites", searchable as "pommes"
// and "fritten". English gets emojibase, which is the richer set there.
import deDataUrl from "emoji-picker-element-data/de/cldr-native/data.json?url";
import enDataUrl from "emoji-picker-element-data/en/emojibase/data.json?url";

/** Exported so a test can assert these never become a remote host. */
export const EMOJI_DATA_URLS: Readonly<Record<"de" | "en", string>> = {
  de: deDataUrl,
  en: enDataUrl,
};

export function emojiDataFor(language: string): { locale: "de" | "en"; dataSource: string } {
  const locale = language.toLowerCase().startsWith("de") ? "de" : "en";
  return { locale, dataSource: EMOJI_DATA_URLS[locale] };
}

export interface EmojiPickerFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** Fired when editing is finished (blur), never per keystroke. Picking from
   *  the picker counts as finished — that click IS the decision. */
  onCommit?: (next: string) => void;
  label: string;
  placeholder?: string;
  /** Shown next to the field; the caller owns the wording. */
  hint?: string;
}

type PickerElement = HTMLElement & { locale?: string; dataSource?: string };

export function EmojiPickerField({
  value,
  onChange,
  onCommit,
  label,
  placeholder,
  hint,
}: EmojiPickerFieldProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const choose = useCallback(
    (glyph: string) => {
      onChange(glyph);
      onCommit?.(glyph);
      setOpen(false);
    },
    [onChange, onCommit]
  );

  // Mount the custom element only while the panel is open, and import the
  // module the first time that happens — the picker and its database are the
  // heaviest thing on this page and most visits never open it.
  useEffect(() => {
    if (!open) return;
    const host = hostRef.current;
    if (!host) return;

    let picker: PickerElement | null = null;
    let cancelled = false;

    const onPick = (event: Event): void => {
      const detail = (event as CustomEvent<{ unicode?: string }>).detail;
      if (detail?.unicode) choose(detail.unicode);
    };

    void (async () => {
      try {
        const { locale, dataSource } = emojiDataFor(i18n.language || "de");
        // The picker's own labels ship with it. `locale` alone only picks the
        // emoji DATA, so without this the search box reads "Search" in a German
        // interface — caught in a browser, not by any test.
        const [{ Picker }, strings] = await Promise.all([
          import("emoji-picker-element"),
          locale === "de" ? import("emoji-picker-element/i18n/de") : import("emoji-picker-element/i18n/en"),
        ]);
        if (cancelled) return;
        picker = new Picker({
          locale,
          dataSource,
          i18n: strings.default,
        }) as unknown as PickerElement;
        // The app is dark throughout; without this the picker follows the OS
        // and can come up as a white slab on a dark page.
        picker.classList.add("dark");
        picker.addEventListener("emoji-click", onPick);
        host.appendChild(picker);
      } catch {
        // A blocked IndexedDB or a chunk that never arrived. Say so and leave
        // the input alone — it is still a working way to set the value.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      picker?.removeEventListener("emoji-click", onPick);
      picker?.remove();
    };
  }, [open, i18n.language, choose]);

  // Escape closes; a click outside closes. Both only while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
        aria-label={label}
        placeholder={placeholder}
        maxLength={16}
        className="rounded-lg px-3 py-2 text-center text-lg"
        style={{
          width: 68,
          background: "var(--bg-elevated)",
          border: "1px solid var(--color-border)",
          color: "var(--text-primary)",
        }}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("common:emojiPicker.open")}
        className="rounded-lg px-2 py-2 text-sm"
        style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
      >
        {t("common:emojiPicker.open")}
      </button>
      {value.trim().length > 0 && (
        <button
          type="button"
          onClick={() => choose("")}
          className="rounded-lg px-2 py-2 text-xs"
          style={{ border: "1px solid var(--color-border)", color: "var(--text-muted)" }}
        >
          {t("common:emojiPicker.clear")}
        </button>
      )}
      {hint && (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      )}

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2"
          style={{ filter: "drop-shadow(0 12px 32px rgba(0,0,0,0.55))" }}
        >
          {failed ? (
            <div
              className="rounded-lg px-3 py-2 text-xs"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--text-muted)",
                maxWidth: 260,
              }}
            >
              {t("common:emojiPicker.unavailable")}
            </div>
          ) : (
            <div ref={hostRef} />
          )}
        </div>
      )}
    </div>
  );
}
