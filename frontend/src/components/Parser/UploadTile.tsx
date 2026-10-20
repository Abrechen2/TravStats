import { useRef } from "react";
import { Icon } from "../ui/Icon";

interface UploadTileProps {
  /** The file input's `accept` list — also what a test finds the input by. */
  accept: string;
  icon: "mail" | "image";
  title: string;
  formats: string;
  onFile: (file: File) => void;
}

/** One upload choice of the workshop: a hidden file input behind a dashed tile. */
export default function UploadTile({
  accept,
  icon,
  title,
  formats,
  onFile,
}: UploadTileProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so choosing the same file again after a refusal fires again.
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center gap-2 rounded-[var(--ts-radius-card)] border border-dashed border-[var(--ts-border)] p-6 text-center transition-colors hover:border-[var(--ts-accent)]"
      >
        <span style={{ color: "var(--ts-accent)" }}>
          <Icon name={icon} size={24} />
        </span>
        <div style={{ fontWeight: 700, color: "var(--ts-text-bright)" }}>{title}</div>
        <div className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
          {formats}
        </div>
      </button>
    </div>
  );
}
