import { Icon } from "../ui/Icon";
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
        <Icon name="arrow-down" size={14} />
      ) : (
        <Icon name="history" size={14} />
      )}
    </button>
  );
}
