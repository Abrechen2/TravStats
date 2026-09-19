import type { JSX } from "react";
import { Link } from "react-router-dom";
import { token } from "./tokens";

/**
 * The card a route draws instead of a page the reader may not see.
 *
 * Three routes need exactly this and used to answer differently: a disabled
 * domain's dashboard tab explained itself, while `/cruises` and `/admin`
 * bounced to the dashboard without a word (forgejo#88, findings 6 and 7). A
 * silent redirect is the worst of the options — the reader followed a link,
 * landed somewhere else, and has no way to learn whether the address was wrong,
 * the feature is off, or their account is not allowed.
 *
 * Presentational only: it knows nothing about domains, roles or routing rules.
 * Each caller brings its own glyph, copy and one way forward.
 *
 * Every colour here reads a token. The card was lifted out of
 * `DomainDisabledNotice`, which painted its own surface as a raw translucent
 * navy and wrote the accent-text value out by hand as a hex literal — a colour
 * nobody decided, beside one that already had a name. Living under
 * `components/ui/` is what surfaced both: the primitives carry an ABSOLUTE
 * no-hex rule rather than a frozen baseline, so the move turned two inherited
 * literals into a failing build instead of two more entries on a list. Which
 * also means: do not quote a hex value in this comment. The warden reads the
 * whole file, and it is right to — a literal in prose is how the next one gets
 * copied back into code.
 */
export function RouteNotice({
  glyph,
  title,
  body,
  action,
}: {
  glyph: string;
  title: string;
  body: string;
  /** The one way forward. Omitted when there is nothing useful to offer. */
  action?: { to: string; label: string };
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // A guard renders this under the app chrome with no grid around it, so
        // it needs its own breathing room rather than relying on a parent's.
        // No `height: 100%` — the parent is an auto-height flow box, so it
        // resolved to the content height and centred nothing.
        padding: "48px 16px",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          padding: "var(--ts-space-xxl)",
          textAlign: "center",
          background: token("surface"),
          border: `1px solid ${token("border")}`,
          borderRadius: "var(--ts-radius-card)",
        }}
      >
        <div aria-hidden style={{ fontSize: 48, marginBottom: "var(--ts-space-xl)" }}>
          {glyph}
        </div>
        <h2 style={{ margin: "0 0 var(--ts-space-sm)", color: token("text-bright") }}>{title}</h2>
        <p
          style={{
            color: token("muted"),
            margin: action ? "0 0 var(--ts-space-xxl)" : 0,
          }}
        >
          {body}
        </p>
        {action && (
          <Link
            to={action.to}
            style={{
              display: "inline-block",
              padding: "10px 20px",
              background: token("accent"),
              color: token("accent-text"),
              borderRadius: "var(--ts-radius-button)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}
