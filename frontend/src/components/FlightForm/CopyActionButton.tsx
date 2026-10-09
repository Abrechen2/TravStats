/**
 * Small icon button next to a form label that performs a single action on
 * the adjacent field(s). Used for "copy departure date → arrival date" and
 * "estimate arrival time from departure" in flight forms.
 */
interface CopyActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title: string; // Tooltip / aria-label (same text)
  icon: "arrow-down" | "calculator";
}

export default function CopyActionButton({
  onClick,
  disabled = false,
  title,
  icon,
}: CopyActionButtonProps): JSX.Element {
  // A 20 px icon keeps its box; on a coarse pointer an invisible area 12 px
  // wider on every side (44 px) takes the tap — the RowActionButton rule
  // (forgejo#249), so the label row does not grow.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="relative inline-flex items-center justify-center w-5 h-5 rounded-sm text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-elevated) disabled:opacity-40 disabled:cursor-not-allowed transition-colors pointer-coarse:after:absolute pointer-coarse:after:-inset-3"
    >
      {icon === "arrow-down" ? (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m0 0l-6-6m6 6l6-6" />
        </svg>
      ) : (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 18l2 2 4-4" />
        </svg>
      )}
    </button>
  );
}
