interface SkeletonCardProps {
  className?: string;
}

function SkeletonCard({ className = "" }: SkeletonCardProps): JSX.Element {
  return (
    <div
      className={`rounded-xl animate-pulse ${className}`}
      style={{ background: "var(--card-bg)", border: "1px solid var(--border)" }}
    />
  );
}

interface SkeletonTextProps {
  width?: string;
  height?: string;
}

function SkeletonText({ width = "w-full", height = "h-4" }: SkeletonTextProps): JSX.Element {
  return (
    <div
      className={`rounded-sm animate-pulse ${width} ${height}`}
      style={{ background: "var(--border)" }}
    />
  );
}

export function SkeletonAchievementGrid(): JSX.Element {
  return (
    <div className="space-y-6">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <SkeletonText width="w-32" height="h-5" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((j) => (
              <SkeletonCard key={j} className="h-32" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 8 }: { rows?: number }): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-4 px-4 py-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonText key={i} width="w-full" height="h-4" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg px-4 py-3 grid grid-cols-6 gap-4"
          style={{ background: "var(--card-bg)", border: "1px solid var(--border)" }}
        >
          {[0, 1, 2, 3, 4, 5].map((j) => (
            <SkeletonText key={j} width="w-full" height="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonStatCards(): JSX.Element {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <SkeletonCard key={i} className="h-24" />
      ))}
    </div>
  );
}
