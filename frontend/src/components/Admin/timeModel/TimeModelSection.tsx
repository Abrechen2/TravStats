import type { JSX } from "react";

import TimeMigrationReport, { type ReportUser } from "./TimeMigrationReport";
import ZoneReResolve from "./ZoneReResolve";

/**
 * Admin → "Zeitmodell": what the time-model migration did (the report the
 * owner signs off before a promotion) and the deliberate way to move a frozen
 * zone later (ADR 0002, D2). Instance-wide, like every admin section.
 */
export default function TimeModelSection({ users }: { users: ReportUser[] }): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <TimeMigrationReport users={users} />
      <ZoneReResolve />
    </div>
  );
}
