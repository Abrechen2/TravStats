interface InferredBadgeProps {
  show: boolean;
  hint: string;
}

/** The "!" beside a field whose value the parser inferred rather than read. */
export default function InferredBadge({ show, hint }: InferredBadgeProps): JSX.Element | null {
  if (!show) return null;
  return (
    <span
      className="ml-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-yellow-400 text-yellow-900 cursor-help"
      title={hint}
      aria-label={hint}
    >
      !
    </span>
  );
}
