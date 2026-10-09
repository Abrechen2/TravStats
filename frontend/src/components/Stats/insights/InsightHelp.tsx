import type { JSX } from "react";

import HelpIcon from "../../Help/HelpIcon";
import { useTranslation } from "../../../hooks/useTranslation";

/**
 * The help behind one insight figure (forgejo#256/#257): the short line says
 * what is counted, the expanded text the counting unit, the time and zone
 * rule, the source, the coverage and what is left out. `HelpIcon` is a real
 * button, so it opens by keyboard (Enter/Space, Escape closes) and by touch.
 *
 * `topic` names `stats:insights.help.<topic>.short` / `.long`; both languages
 * carry both, which `localeKeyParity` holds.
 */
export default function InsightHelp({ topic }: { topic: string }): JSX.Element {
  const { t } = useTranslation(["stats"]);
  return (
    <HelpIcon
      content={t(`stats:insights.help.${topic}.short`)}
      expandedContent={t(`stats:insights.help.${topic}.long`)}
      position="top"
    />
  );
}

/** A block heading with its help beside it. */
export function InsightHeading({
  id,
  title,
  topic,
}: {
  id: string;
  title: string;
  topic: string;
}): JSX.Element {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h3 id={id} className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h3>
      <InsightHelp topic={topic} />
    </div>
  );
}
