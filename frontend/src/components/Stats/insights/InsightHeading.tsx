import type { JSX } from "react";

import CountingHelp from "../counting/CountingHelp";
import type { CountingEntry } from "../counting/countingEntry";

/** Where an insight topic's five counting answers live (`stats:insights.help.<topic>.*`). */
export function insightCounting(topic: string, term: string): CountingEntry {
  return { term, helpKey: `stats:insights.help.${topic}` };
}

/**
 * A block heading of the flight and cruise insights (forgejo#256/#257), with
 * the block's "How this is counted" directly beneath it. `topic` names the
 * five answers for the heading's own figure; a block whose columns carry a
 * second counting rule passes `counting` with every entry instead.
 */
export function InsightHeading({
  id,
  title,
  topic,
  counting,
}: {
  id: string;
  title: string;
  topic: string;
  counting?: readonly CountingEntry[];
}): JSX.Element {
  return (
    <div className="mb-3">
      <h3 id={id} className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h3>
      <CountingHelp entries={counting ?? [insightCounting(topic, title)]} testId={`${id}-help`} />
    </div>
  );
}
