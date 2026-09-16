import type { CSSProperties, ReactNode } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import type { DomainKey } from "../../shared/domains";
import { alpha, DOMAIN_TOKEN, token } from "./tokens";

interface DetailHeaderProps {
  /** Where the back link goes, and what it is called. Always both. */
  backTo: string;
  backLabel: string;
  /** Which domain this entry belongs to — decides the mark's colour. */
  domain: DomainKey;
  /** The mark's glyph. One character; the tile is drawn here. */
  icon: ReactNode;
  title: string;
  /** Under the title: what this thing is. A line or two, never a paragraph. */
  subtitle?: ReactNode;
  /** The status pill. One per entry, and it carries text, never colour alone. */
  status?: ReactNode;
  /**
   * Short facts that belong beside the status rather than under the title —
   * a date range, a count. Each renders in the same box, which is the point:
   * the cruise page invented this shape and was the only page with it.
   */
  facts?: ReactNode[];
  /** The entry's own actions. Two is the norm, three the maximum. */
  actions?: ReactNode;
  /** One muted line of facts under the subtitle: a date, a type, a code. */
  meta?: ReactNode;
  /**
   * The entry at a glance, under a hairline inside the same card — a
   * flight's route strip. Round 4 (E6) calls it the Kennzahlen-Streifen.
   */
  hero?: ReactNode;
}

const factStyle: CSSProperties = {
  borderRadius: "var(--ts-radius-button)",
  border: "1px solid var(--ts-border)",
  background: "var(--ts-surface2)",
  color: "var(--ts-muted)",
  padding: "4px 10px",
  fontSize: 12,
  whiteSpace: "nowrap",
};

/**
 * One head for a flight, a cruise, a stay and a place.
 *
 * The four had drifted into four answers to the same question, which is the
 * finding (D-08) this round was handed: "the switch to the detail brings a
 * different head, extra metadata boxes and several differently weighted
 * section titles". Measured before this component existed:
 *
 * - The flight, cruise and lodging heads sat in a bordered card; the place
 *   head sat on the page with no frame at all.
 * - Three pages capped at `max-w-6xl`, the place page at `max-w-[1100px]`.
 * - Three drew a 48px domain tile; the place page put its icon inside the h1.
 * - The cruise page drew three bordered metadata boxes that existed nowhere
 *   else, and the lodging page carried no status at all.
 * - Edit was an accent button on two pages, an outline button on the third,
 *   and sat beside a hardcoded near-black on domain colour on the fourth.
 * - Back was a `<button>` in the accent colour three times and a muted
 *   `<Link>` once — the only one a middle click could open in a new tab.
 *
 * None of those differences was asked for by the content, which is the test
 * the handoff sets: a difference has to be explained by what the page is
 * showing. So the frame, the mark, the order and the back link are fixed
 * here, and what stays free is what genuinely differs — the subtitle lines,
 * which facts are worth a box, and which actions the entry offers.
 */
export default function DetailHeader({
  backTo,
  backLabel,
  domain,
  icon,
  title,
  subtitle,
  status,
  facts,
  actions,
  meta,
  hero,
}: DetailHeaderProps): JSX.Element {
  const hue = token(DOMAIN_TOKEN[domain]);

  return (
    <div style={{ marginBottom: "var(--ts-space-xl)" }}>
      {/* A real link, not a button: back is a destination, so a middle click
          and "open in new tab" have to work. Three of the four pages used a
          button and silently took that away. */}
      <Link
        to={backTo}
        className="ts-back-link"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          marginBottom: "var(--ts-space-md)",
          fontSize: 13,
          color: "var(--ts-muted)",
          textDecoration: "none",
        }}
      >
        <span aria-hidden>←</span>
        {backLabel}
      </Link>

      <div
        className="flex flex-col"
        style={{
          gap: "var(--ts-space-lg)",
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
          padding: "var(--ts-space-lg)",
        }}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start" style={{ gap: "var(--ts-space-lg)" }}>
            <span
              aria-hidden
              className="flex items-center justify-center"
              style={{
                flexShrink: 0,
                width: 48,
                height: 48,
                borderRadius: "var(--ts-radius-tile)",
                background: alpha(hue, 12),
                color: hue,
                fontSize: 22,
                lineHeight: 1,
              }}
            >
              {icon}
            </span>
            <div className="min-w-0">
              {/* The status beside the title, as round 4 draws the head: what
                this is and what state it is in are read together. */}
              <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
                <h1 className="t-screen-title">{title}</h1>
                {status}
              </div>
              {subtitle ? (
                <div
                  style={{ marginTop: 2, fontSize: 14, color: "var(--ts-muted)" }}
                  className="flex flex-col gap-0.5"
                >
                  {subtitle}
                </div>
              ) : null}
              {meta ? (
                <div className="t-caption" style={{ marginTop: 4 }}>
                  {meta}
                </div>
              ) : null}
            </div>
          </div>

          <div
            className="flex flex-wrap items-center md:justify-end"
            style={{ gap: "var(--ts-space-sm)" }}
          >
            {facts?.map((fact, index) => (
              <span key={index} style={factStyle}>
                {fact}
              </span>
            ))}
            {actions}
          </div>
        </div>
        {hero ? (
          <div
            style={{ borderTop: "1px solid var(--ts-border)", paddingTop: "var(--ts-space-lg)" }}
          >
            {hero}
          </div>
        ) : null}
      </div>
    </div>
  );
}
