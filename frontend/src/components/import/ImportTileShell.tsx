import type { ReactNode } from "react";

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
 * Visual shell shared by every Settings → Import tile. Matches the rest of
 * the Settings UI: rounded card on the elevated background, border, padded,
 * column-flex so descriptions push the picker to the bottom.
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
    <div
      className="flex h-full flex-col gap-3 rounded-lg p-4"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h3>
      <p className="grow text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {description}
      </p>
      <div className="flex flex-wrap items-center gap-2">{picker}</div>
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
 * Styled file picker — hidden native input, btn-primary label. Reusable
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
      className={`btn-primary inline-flex cursor-pointer items-center gap-2 ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      <span aria-hidden="true">📁</span>
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
        background: "rgba(239, 68, 68, 0.1)",
        border: "1px solid rgba(239, 68, 68, 0.4)",
        color: "rgb(252, 165, 165)",
      }}
    >
      {message}
    </pre>
  );
}
