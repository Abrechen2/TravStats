interface InferredBadgeProps {
  show: boolean;
  hint: string;
}

/**
 * The "!" beside a field whose value the parser inferred rather than read —
 * with its reason written out (forgejo#249). It used to say why only in a
 * `title`, which no finger and no keyboard reaches; on an iPad the review
 * showed a bare "!" and nothing else.
 */
export default function InferredBadge({ show, hint }: InferredBadgeProps): JSX.Element | null {
  if (!show) return null;
  return (
    <span className="ml-1 inline-flex items-center gap-1 align-middle">
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-(--warning) text-(--bg-surface)"
      >
        !
      </span>
      <span className="text-xs font-normal" style={{ color: "var(--warning)" }}>
        {hint}
      </span>
    </span>
  );
}
