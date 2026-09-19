import type { ReactNode } from "react";
import type { DomainKey } from "../../shared/domains";
import { DASHED_STATUSES, DOMAIN_TOKEN, STATUS_TOKEN, alpha, token } from "./tokens";

interface PillProps {
  children: ReactNode;
  /** Any CSS colour expression — in practice always a token reference. */
  color: string;
  /** Provisional. The only thing a dash ever means. */
  dashed?: boolean;
  title?: string;
}

/**
 * The one pill recipe, from `tokens.json → statusPill`.
 *
 * Colour as text, background at 12 %, border at 45 %, radius 999, 11px bold
 * uppercase with 0.6px tracking — and **never mono**. The web painted these at
 * 15 % with no border and no capitals, which is why a status read as a label
 * rather than a state.
 */
export default function Pill({ children, color, dashed = false, title }: PillProps): JSX.Element {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        color,
        background: alpha(color, 12),
        border: `1px ${dashed ? "dashed" : "solid"} ${alpha(color, 45)}`,
        borderRadius: "var(--ts-radius-pill)",
        padding: "4px 10px",
        fontFamily: "var(--ts-font-ui)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.6px",
        textTransform: "uppercase",
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

interface StatusPillProps {
  status: string;
  /** The label. Callers translate; this primitive never invents copy. */
  children: ReactNode;
}

/**
 * A status is always a pill, never plain text, and there is one per row.
 *
 * An unknown status renders in the historical grey rather than falling into
 * the cancelled red — a state nobody has styled yet is not a failure. That was
 * a real defect: the flights table's catch-all else branch painted a 2019
 * flight the same red as one that never took off.
 */
export function StatusPill({ status, children }: StatusPillProps): JSX.Element {
  const name = STATUS_TOKEN[status] ?? "status-historical";
  return (
    <Pill color={token(name)} dashed={DASHED_STATUSES.has(status)}>
      {children}
    </Pill>
  );
}

interface DomainPillProps {
  domain: DomainKey | "tour";
  children: ReactNode;
}

/**
 * The domain pill. It is what a row shows when the status is `flown` — at
 * which point the status has stopped being news and the domain is the more
 * useful thing to say. Any other status displaces it.
 */
export function DomainPill({ domain, children }: DomainPillProps): JSX.Element {
  return <Pill color={token(DOMAIN_TOKEN[domain])}>{children}</Pill>;
}
