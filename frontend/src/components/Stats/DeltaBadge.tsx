interface DeltaBadgeProps {
  current: number;
  compare: number;
}

export default function DeltaBadge({ current, compare }: DeltaBadgeProps): JSX.Element {
  const delta = current - compare;
  const pct = compare !== 0 ? Math.round((delta / compare) * 100) : 0;
  const positive = delta >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded ${
        positive
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
      }`}
    >
      {positive ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}
