import type { JSX } from "react";

/** A record's tags as read-only chips (the detail pages of ferry and rental). */
export default function TagChips({ tags }: { tags: readonly string[] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full border px-2.5 py-0.5 text-xs"
          style={{ borderColor: "var(--ts-border)", color: "var(--ts-muted)" }}
        >
          #{tag}
        </span>
      ))}
    </div>
  );
}
