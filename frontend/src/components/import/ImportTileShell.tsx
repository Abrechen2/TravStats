import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import { SettingRow } from "../ui/SettingRow";

interface ImportTileShellProps {
  title: string;
  description: string;
  /** The styled file-picker (label/input pair). */
  picker: ReactNode;
  /** Inline error block (red). Caller decides when to show. */
  errorBlock?: ReactNode;
  /** Inline status / success line. */
  statusBlock?: ReactNode;
  /** Extra content rendered below the picker but inside the tile (rare). */
  children?: ReactNode;
}

/**
 * One import route in Settings → Listen importieren, drawn as a settings row:
 * what it imports on the left, the file picker on the right, and whatever the
 * route needs to say after a run (error, status, preview) underneath.
 *
 * Round 4 lists the routes as rows. They were a grid of tiles, where the
 * descriptions pushed each picker to a different height and a two-route area
 * left an empty third of the card.
 */
export function ImportTileShell({
  title,
  description,
  picker,
  errorBlock,
  statusBlock,
  children,
}: ImportTileShellProps): JSX.Element {
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <SettingRow title={title} sub={description} control={picker} />
      {errorBlock}
      {statusBlock}
      {children}
    </div>
  );
}

interface ImportFilePickerProps {
  /** i18n'd visible label on the styled button. */
  label: string;
  /** Comma-separated MIME/extension list passed to the input's `accept` attr. */
  accept: string;
  /** Disable the picker (busy state). */
  disabled?: boolean;
  onFile: (file: File) => void;
  /** aria-label fallback if the visible label isn't descriptive enough. */
  ariaLabel?: string;
}

/**
 * Styled file picker — hidden native input, btn-secondary label. Reusable
 * across all import tiles so file-pickers look identical.
 */
export function ImportFilePicker({
  label,
  accept,
  disabled = false,
  onFile,
  ariaLabel,
}: ImportFilePickerProps): JSX.Element {
  return (
    <label
      className={`btn-secondary inline-flex cursor-pointer items-center gap-2 ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      <Icon name="upload" size={14} />
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          // Reset so picking the same file again still fires onChange
          e.target.value = "";
        }}
      />
    </label>
  );
}

interface ImportErrorBlockProps {
  message: string;
}

export function ImportErrorBlock({ message }: ImportErrorBlockProps): JSX.Element {
  return (
    <pre
      className="overflow-auto whitespace-pre-wrap rounded-md p-3 text-xs"
      style={{
        background: "color-mix(in srgb, var(--ts-bad) 10%, transparent)",
        border: "1px solid color-mix(in srgb, var(--ts-bad) 40%, transparent)",
        color: "var(--ts-bad)",
      }}
    >
      {message}
    </pre>
  );
}
