import Chip from "../ui/Chip";
import type { JSX } from "react";

/** A record's tags as read-only chips (the detail pages of ferry and rental). */
export default function TagChips({ tags }: { tags: readonly string[] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <Chip key={tag} size="sm">
          #{tag}
        </Chip>
      ))}
    </div>
  );
}
