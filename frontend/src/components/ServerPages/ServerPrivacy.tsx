import type { JSX } from "react";
import PushRows from "../Services/PushRows";
import UsageStatsRows from "../Services/UsageStatsRows";

/**
 * Server › Datenschutz (settings v3 S5): what leaves the server — the anonymous
 * usage statistics and the push service. Both were cards of the service
 * catalogue.
 */
export default function ServerPrivacy({ part }: { part: "stats" | "push" }): JSX.Element {
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {part === "stats" ? <UsageStatsRows /> : <PushRows />}
    </div>
  );
}
