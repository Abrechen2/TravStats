import type { JSX } from "react";
import { Link } from "react-router-dom";

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
        height: "100%",
        // A guard renders this under the app chrome with no grid around it, so
        // it needs its own breathing room rather than relying on a parent's.
        padding: "48px 16px",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          padding: 32,
          textAlign: "center",
          background: "rgba(15, 23, 42, 0.85)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
        }}
      >
        <div aria-hidden style={{ fontSize: 48, marginBottom: 16 }}>
          {glyph}
        </div>
        <h2 style={{ margin: "0 0 8px", color: "var(--text-primary)" }}>{title}</h2>
        <p style={{ color: "var(--text-muted)", margin: action ? "0 0 24px" : 0 }}>{body}</p>
        {action && (
          <Link
            to={action.to}
            style={{
              display: "inline-block",
              padding: "10px 20px",
              background: "var(--accent)",
              color: "#0d1117",
              borderRadius: 10,
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
