/** One side of a disagreement. Styling is identical for both sides, by design. */
export default function Side({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}): JSX.Element {
  return (
    <div
      className="rounded-lg p-3 flex-1 min-w-[150px]"
      style={{ background: "var(--bg-base)", border: "1px solid var(--color-border)" }}
    >
      <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
      {note && (
        <div className="text-xs mt-1 break-words" style={{ color: "var(--text-muted)" }}>
          {note}
        </div>
      )}
    </div>
  );
}
