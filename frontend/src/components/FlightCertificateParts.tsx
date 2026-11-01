import { PAPER } from "../lib/paperPalette";

const INK = PAPER.ink;
const INK_SOFT = PAPER.inkSoft;
const BRONZE = PAPER.accent;
const STAMP_RED = PAPER.stamp;
// The certificate's small parts: the big-number block, the notable line, the
// postmark and the compass rose. Split from `FlightCertificate.tsx`
// (forgejo#386, REF-16); markup unchanged.

// ─── Helpers ───────────────────────────────────────────────────────────────

interface BigStatProps {
  value: string;
  label: string;
  suffix?: string;
  withDivider?: boolean;
}

export function BigStat({ value, label, suffix, withDivider }: BigStatProps): JSX.Element {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "0 14px",
        borderLeft: withDivider ? `1px solid ${INK}` : "none",
        position: "relative",
      }}
    >
      <div
        style={{
          fontFamily: "'Big Shoulders Display', sans-serif",
          fontSize: "72px",
          fontWeight: 800,
          color: INK,
          lineHeight: 0.9,
          letterSpacing: "-0.01em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
        {suffix && (
          <span
            style={{
              fontSize: "30px",
              color: BRONZE,
              marginLeft: "2px",
              fontWeight: 600,
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      <div
        style={{
          marginTop: "10px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "9px",
          color: INK_SOFT,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    </div>
  );
}

interface NotableLineProps {
  label: string;
  value: string;
}

export function NotableLine({ label, value }: NotableLineProps): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "16px",
        padding: "10px 0",
        borderBottom: `1px dotted rgba(28,42,61,0.25)`,
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "10px",
          color: INK_SOFT,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          flex: "0 0 200px",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          height: "1px",
          borderTop: `1px dashed rgba(28,42,61,0.2)`,
          alignSelf: "center",
        }}
      />
      <div
        style={{
          fontFamily: "'Fraunces', serif",
          fontSize: "22px",
          fontWeight: 800,
          fontStyle: "italic",
          color: INK,
          letterSpacing: "-0.01em",
          textAlign: "right",
        }}
      >
        {value}
      </div>
    </div>
  );
}

interface PostmarkProps {
  date: string;
  flights: number;
}

export function Postmark({ date, flights }: PostmarkProps): JSX.Element {
  // Diagonal stamp anchored to bottom-left so it doesn't compete with the
  // headline. SVG text-on-path gives the round-stamp feel without a font dep.
  return (
    <div
      style={{
        position: "absolute",
        right: "44px",
        bottom: "120px",
        width: "150px",
        height: "150px",
        transform: "rotate(-12deg)",
        opacity: 0.78,
        zIndex: 3,
        pointerEvents: "none",
      }}
    >
      <svg viewBox="0 0 200 200" width="150" height="150">
        <defs>
          <path
            id="postmark-curve"
            d="M 100,100 m -76,0 a 76,76 0 1,1 152,0 a 76,76 0 1,1 -152,0"
          />
        </defs>
        {/* Outer ring */}
        <circle
          cx="100"
          cy="100"
          r="90"
          fill="none"
          stroke={STAMP_RED}
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        {/* Inner ring */}
        <circle cx="100" cy="100" r="60" fill="none" stroke={STAMP_RED} strokeWidth="2" />
        {/* Wing-line through the centre to evoke an airmail postmark */}
        <line x1="6" y1="100" x2="194" y2="100" stroke={STAMP_RED} strokeWidth="1.5" />
        <line x1="20" y1="92" x2="180" y2="92" stroke={STAMP_RED} strokeWidth="0.8" opacity="0.6" />
        <line
          x1="20"
          y1="108"
          x2="180"
          y2="108"
          stroke={STAMP_RED}
          strokeWidth="0.8"
          opacity="0.6"
        />
        {/* Curved top text */}
        <text
          fill={STAMP_RED}
          fontFamily="'JetBrains Mono', monospace"
          fontSize="12"
          fontWeight="700"
          letterSpacing="3"
        >
          <textPath href="#postmark-curve" startOffset="14%">
            ✦ VERIFIED FLIGHT LOG ✦
          </textPath>
        </text>
        {/* Curved bottom text — same path, mirrored offset */}
        <text
          fill={STAMP_RED}
          fontFamily="'JetBrains Mono', monospace"
          fontSize="11"
          fontWeight="500"
          letterSpacing="2"
        >
          <textPath href="#postmark-curve" startOffset="64%">
            {date.toUpperCase()}
          </textPath>
        </text>
        {/* Centre — flight count */}
        <text
          x="100"
          y="74"
          fill={STAMP_RED}
          fontFamily="'JetBrains Mono', monospace"
          fontSize="10"
          fontWeight="500"
          textAnchor="middle"
          letterSpacing="2"
        >
          FLIGHTS
        </text>
        <text
          x="100"
          y="138"
          fill={STAMP_RED}
          fontFamily="'Big Shoulders Display', sans-serif"
          fontSize="56"
          fontWeight="800"
          textAnchor="middle"
        >
          {flights}
        </text>
      </svg>
    </div>
  );
}

export function CompassRose(): JSX.Element {
  return (
    <div
      style={{
        position: "absolute",
        top: "150px",
        right: "44px",
        width: "120px",
        height: "120px",
        opacity: 0.18,
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <svg viewBox="0 0 120 120" width="120" height="120">
        {/* Outer circle */}
        <circle cx="60" cy="60" r="58" fill="none" stroke={INK} strokeWidth="0.8" />
        {/* Tick marks */}
        {Array.from({ length: 32 }).map((_, i) => {
          const angle = (i / 32) * 2 * Math.PI;
          const long = i % 4 === 0;
          const r1 = 58;
          const r2 = long ? 50 : 54;
          const x1 = 60 + Math.cos(angle) * r1;
          const y1 = 60 + Math.sin(angle) * r1;
          const x2 = 60 + Math.cos(angle) * r2;
          const y2 = 60 + Math.sin(angle) * r2;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={INK}
              strokeWidth={long ? 1 : 0.5}
            />
          );
        })}
        {/* Star */}
        <polygon points="60,8 66,60 60,52 54,60" fill={INK} />
        <polygon points="60,112 54,60 60,68 66,60" fill={INK} opacity="0.7" />
        <polygon points="8,60 60,54 52,60 60,66" fill={INK} opacity="0.7" />
        <polygon points="112,60 60,66 68,60 60,54" fill={INK} opacity="0.7" />
        <text
          x="60"
          y="22"
          textAnchor="middle"
          fill={INK}
          fontFamily="'JetBrains Mono', monospace"
          fontSize="9"
          fontWeight="700"
        >
          N
        </text>
      </svg>
    </div>
  );
}
