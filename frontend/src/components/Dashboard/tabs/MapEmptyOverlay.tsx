import type { JSX } from "react";

/**
 * The "nothing here yet" card a dashboard tab floats over its map.
 *
 * It was written three times — flights, cruises, lodging — byte-identical
 * but for the emoji, the three keys and the link target, and the two tabs
 * added later (places, tours) got a bare line of muted text instead, which
 * is what a tester saw as the card "missing" on those two (Alex,
 * 2026-09-20). One component so the fourth and fifth surface cannot drift
 * from the first three again.
 *
 * `pointerEvents` is split on purpose: the full-size backdrop lets clicks
 * through to the map underneath, the card itself takes them, so an empty
 * tab is still a usable map.
 */
interface MapEmptyOverlayProps {
  emoji: string;
  title: string;
  body: string;
  ctaLabel: string;
  onCta(): void;
}

export function MapEmptyOverlay({
  emoji,
  title,
  body,
  ctaLabel,
  onCta,
}: MapEmptyOverlayProps): JSX.Element {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          maxWidth: 420,
          textAlign: "center",
          padding: "28px 32px",
          borderRadius: 16,
          background: "rgba(22,27,34,0.92)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>
          {emoji}
        </div>
        <h2 style={{ margin: "0 0 8px", color: "var(--text-primary)", fontSize: 18 }}>{title}</h2>
        <p style={{ margin: "0 0 20px", color: "var(--text-muted)", fontSize: 14 }}>{body}</p>
        <button
          type="button"
          onClick={onCta}
          style={{
            padding: "10px 20px",
            background: "var(--accent)",
            // Always dark: `:root` has no light variant (index.css), so the
            // accent button keeps a legible foreground without a hex here.
            color: "var(--bg-base)",
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
