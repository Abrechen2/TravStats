import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { PAPER } from "../lib/paperPalette";
import { useTranslation } from "../hooks/useTranslation";

export interface FlightCertificateStats {
  totalFlights: number;
  totalDistance: number;
  totalFlightTime: number;
  topAirline: string | null;
  favoriteRoute: string | null;
  yearsActive: number[];
  userName: string;
}

interface FlightCertificateProps {
  stats: FlightCertificateStats;
  onDownload?: () => void;
  onClose: () => void;
}

const PARCHMENT = PAPER.sheet; // one paper colour — see lib/paperPalette.ts
const INK = PAPER.ink;
const INK_SOFT = PAPER.inkSoft;
const BRONZE = PAPER.accent;
const STAMP_RED = PAPER.stamp;
const PAPER_SHADOW = PAPER.shadow;

// Earth's equatorial circumference (km), used for the "around the Earth"
// shareable comparison.
const EARTH_CIRCUMFERENCE_KM = 40075;

// Average Earth–Moon distance (km), used for the "to the Moon" comparison.
const EARTH_MOON_DISTANCE_KM = 384400;

const FONT_HREF =
  "https://fonts.googleapis.com/css2?" +
  "family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,800;1,9..144,500;1,9..144,800&" +
  "family=Big+Shoulders+Display:wght@600;800;900&" +
  "family=JetBrains+Mono:wght@400;500;700&display=swap";

// Subtle paper warmth — radial gradients instead of an SVG noise filter.
// html2canvas does not render SVG `feTurbulence` filters consistently and
// produced solid black vertical bands in the exported PNG. Layered radial
// gradients give the parchment depth without the rasteriser hazard.
const PAPER_GRAIN_DATA_URI =
  "radial-gradient(ellipse at 25% 15%, rgba(255,243,210,0.65) 0%, transparent 55%), " +
  "radial-gradient(ellipse at 80% 90%, rgba(170,130,80,0.08) 0%, transparent 60%)";

// ─── Component ─────────────────────────────────────────────────────────────
export function FlightCertificate({
  stats,
  onDownload,
  onClose,
}: FlightCertificateProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats"]);
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  // Inject the Google Fonts stylesheet exactly once per modal mount.
  useEffect(() => {
    const existing = document.head.querySelector(`link[data-cert-fonts]`);
    if (existing) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    link.dataset.certFonts = "true";
    document.head.appendChild(link);
    return () => {
      if (link.parentNode) link.parentNode.removeChild(link);
    };
  }, []);

  const generatedDate = new Date().toLocaleDateString(i18n.language, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const handleDownload = async (): Promise<void> => {
    if (!cardRef.current || downloading) return;
    setDownloading(true);
    try {
      // html2canvas misses webfonts unless they're loaded first.
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: PARCHMENT,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      const safeName = stats.userName.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase();
      link.download = `travstats-${safeName || "aviator"}-certificate.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      onDownload?.();
    } finally {
      setDownloading(false);
    }
  };

  // ─── Derived display values ──────────────────────────────────────────────
  const totalDistanceKm = Math.round(stats.totalDistance);
  const totalFlightHours = Math.round(stats.totalFlightTime);
  const earthLaps = stats.totalDistance / EARTH_CIRCUMFERENCE_KM;
  const moonPercent = (stats.totalDistance / EARTH_MOON_DISTANCE_KM) * 100;

  const earthLapsLabel =
    earthLaps >= 0.05
      ? t("stats:certificate.earthLaps", { count: earthLaps.toFixed(earthLaps >= 10 ? 0 : 1) })
      : null;
  const moonProgressLabel =
    moonPercent >= 0.5 && moonPercent < 100
      ? t("stats:certificate.moonProgress", { percent: moonPercent.toFixed(1) })
      : null;

  const yearsLabel =
    stats.yearsActive.length > 0
      ? (() => {
          const sorted = [...stats.yearsActive].sort((a, b) => a - b);
          const first = sorted[0];
          const last = sorted[sorted.length - 1];
          return first === last ? String(first) : `${first}–${last}`;
        })()
      : "—";

  const yearsCount = stats.yearsActive.length || 1;

  // Big-number formatter — locale-aware with thin spaces between thousands.
  const fmt = (n: number): string => n.toLocaleString(i18n.language).replace(/,/g, "\u202F");

  // Issue serial — deterministic from the user's name + total km, so re-issuing
  // the same cert produces the same number and can be quoted.
  const issueSerial = (() => {
    let h = 5381;
    const seed = `${stats.userName}-${totalDistanceKm}`;
    for (let i = 0; i < seed.length; i++) {
      h = ((h << 5) + h + seed.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(h).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
  })();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(8,15,26,0.86)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        overflowY: "auto",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Action toolbar */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          marginBottom: "20px",
          alignSelf: "center",
        }}
      >
        <button
          onClick={() => {
            void handleDownload();
          }}
          disabled={downloading}
          style={{
            background: BRONZE,
            color: PARCHMENT,
            border: "none",
            borderRadius: "999px",
            padding: "11px 28px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "11px",
            fontWeight: 700,
            cursor: downloading ? "wait" : "pointer",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: downloading ? 0.6 : 1,
            transition: "transform 0.15s ease, background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            if (!downloading) e.currentTarget.style.background = PAPER.accentHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = BRONZE;
          }}
        >
          ↓ {t("stats:certificate.download")}
        </button>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            color: PARCHMENT,
            border: "1px solid rgba(241,231,205,0.4)",
            borderRadius: "999px",
            padding: "11px 28px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "11px",
            fontWeight: 500,
            cursor: "pointer",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          {t("stats:certificate.close")}
        </button>
      </div>

      {/* Certificate card */}
      <div
        ref={cardRef}
        style={{
          width: "800px",
          maxWidth: "100%",
          minHeight: "1180px",
          background: PARCHMENT,
          backgroundImage: PAPER_GRAIN_DATA_URI,
          color: INK,
          position: "relative",
          fontFamily: "'Fraunces', 'Georgia', serif",
          boxShadow: "0 30px 80px rgba(0,0,0,0.5), inset 0 0 80px rgba(60,40,20,0.05)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Deckle ink border — outer */}
        <div
          style={{
            position: "absolute",
            inset: "20px",
            border: `1px solid ${INK}`,
            opacity: 0.65,
            pointerEvents: "none",
          }}
        />
        {/* Deckle ink border — inner hairline */}
        <div
          style={{
            position: "absolute",
            inset: "26px",
            border: `1px solid ${BRONZE}`,
            opacity: 0.45,
            pointerEvents: "none",
          }}
        />

        {/* ─── Top brand bar ──────────────────────────────────────── */}
        <div
          style={{
            padding: "44px 56px 0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "10px",
              letterSpacing: "0.32em",
              color: INK,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            ✦ TRAV·STATS · LOG &amp; LEGEND
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "10px",
              letterSpacing: "0.18em",
              color: INK_SOFT,
              textAlign: "right",
            }}
          >
            <div>N° {issueSerial}</div>
            <div style={{ marginTop: "2px", color: BRONZE }}>{generatedDate}</div>
          </div>
        </div>

        {/* ─── Editorial headline ─────────────────────────────────── */}
        <div
          style={{
            padding: "48px 56px 0",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "11px",
              letterSpacing: "0.4em",
              color: BRONZE,
              textTransform: "uppercase",
              fontWeight: 700,
              marginBottom: "8px",
            }}
          >
            {t("stats:certificate.eyebrow")}
          </div>
          <h1
            style={{
              fontFamily: "'Fraunces', 'Georgia', serif",
              fontSize: "78px",
              fontWeight: 800,
              fontStyle: "italic",
              lineHeight: 0.95,
              margin: 0,
              color: INK,
              fontVariationSettings: "'opsz' 144",
            }}
          >
            {t("stats:certificate.headlineLineOne")}
            <br />
            <span style={{ color: BRONZE, fontStyle: "italic" }}>
              {t("stats:certificate.headlineLineTwo")}
            </span>
          </h1>
          <div
            style={{
              marginTop: "26px",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "11px",
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: INK_SOFT,
            }}
          >
            {t("stats:certificate.awardedTo")}
          </div>
          <div
            style={{
              marginTop: "8px",
              fontFamily: "'Fraunces', 'Georgia', serif",
              fontSize: "44px",
              fontWeight: 500,
              fontStyle: "italic",
              color: INK,
              lineHeight: 1.05,
              borderBottom: `1px solid ${INK}`,
              paddingBottom: "12px",
              fontVariationSettings: "'opsz' 144",
            }}
          >
            {stats.userName}
          </div>
        </div>

        {/* ─── Hero distance ──────────────────────────────────────── */}
        <div
          style={{
            padding: "44px 56px 0",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "10px",
              letterSpacing: "0.32em",
              color: INK_SOFT,
              textTransform: "uppercase",
              marginBottom: "6px",
            }}
          >
            {t("stats:certificate.distanceTraveled")}
          </div>
          <div
            style={{
              fontFamily: "'Big Shoulders Display', 'Arial Narrow', sans-serif",
              fontSize: "180px",
              fontWeight: 900,
              lineHeight: 0.85,
              color: INK,
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmt(totalDistanceKm)}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "16px",
              marginTop: "4px",
            }}
          >
            <span
              style={{
                fontFamily: "'Big Shoulders Display', sans-serif",
                fontSize: "32px",
                fontWeight: 600,
                color: BRONZE,
                letterSpacing: "0.05em",
              }}
            >
              KILOMETER
            </span>
            <span
              style={{
                flex: 1,
                height: "1px",
                background: INK,
                opacity: 0.4,
              }}
            />
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "10px",
                color: INK_SOFT,
                letterSpacing: "0.18em",
              }}
            >
              {fmt(totalFlightHours)} H · AIR
            </span>
          </div>

          {/* Equivalences — story-telling translations of raw km */}
          {(earthLapsLabel || moonProgressLabel) && (
            <div
              style={{
                marginTop: "24px",
                padding: "18px 22px",
                background: "rgba(28,42,61,0.045)",
                border: `1px dashed ${INK}`,
                fontFamily: "'Fraunces', serif",
                fontStyle: "italic",
                fontSize: "17px",
                lineHeight: 1.5,
                color: INK,
              }}
            >
              <span style={{ color: BRONZE, marginRight: "8px" }}>◯</span>
              {earthLapsLabel || moonProgressLabel}
            </div>
          )}
        </div>

        {/* ─── Stat triplet ───────────────────────────────────────── */}
        <div
          style={{
            padding: "40px 56px 0",
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "0",
            position: "relative",
            zIndex: 2,
          }}
        >
          <BigStat value={fmt(stats.totalFlights)} label={t("stats:certificate.totalFlights")} />
          <BigStat
            value={fmt(totalFlightHours)}
            label={t("stats:certificate.totalFlightTime")}
            suffix="h"
            withDivider
          />
          <BigStat
            value={String(yearsCount)}
            label={t("stats:certificate.yearsActive")}
            withDivider
          />
        </div>

        {/* ─── Notable section ───────────────────────────────────── */}
        <div
          style={{
            padding: "44px 56px 0",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "10px",
              letterSpacing: "0.32em",
              color: BRONZE,
              textTransform: "uppercase",
              marginBottom: "14px",
              fontWeight: 700,
            }}
          >
            ── {t("stats:certificate.ofNote")} ──
          </div>
          <NotableLine label={t("stats:certificate.topAirline")} value={stats.topAirline ?? "—"} />
          <NotableLine
            label={t("stats:certificate.favoriteRoute")}
            value={stats.favoriteRoute ?? "—"}
          />
          <NotableLine label={t("stats:certificate.years")} value={yearsLabel} />
        </div>

        {/* ─── Postmark stamp ─────────────────────────────────────── */}
        <Postmark date={generatedDate} flights={stats.totalFlights} />

        {/* ─── Compass rose, top right behind everything ─────────── */}
        <CompassRose />

        {/* Spacer pushes the footer to the bottom in the flex column */}
        <div style={{ flex: 1, minHeight: "60px" }} />

        {/* ─── Footer ─────────────────────────────────────────────── */}
        <div
          style={{
            padding: "0 56px 56px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'Fraunces', serif",
                fontSize: "20px",
                fontWeight: 800,
                fontStyle: "italic",
                color: INK,
                letterSpacing: "-0.01em",
              }}
            >
              trav·stats
            </div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "9px",
                color: INK_SOFT,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                marginTop: "2px",
              }}
            >
              {t("stats:certificate.tagline")}
            </div>
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "9px",
              color: INK_SOFT,
              letterSpacing: "0.2em",
              textAlign: "right",
              textTransform: "uppercase",
            }}
          >
            <div>{t("stats:certificate.issuedBy")}</div>
            <div style={{ marginTop: "2px", color: BRONZE }}>{generatedDate}</div>
          </div>
        </div>

        {/* ─── Bottom bronze hairline ─────────────────────────────── */}
        <div
          style={{
            position: "absolute",
            bottom: "26px",
            left: "26px",
            right: "26px",
            height: "3px",
            background: `linear-gradient(90deg, transparent, ${BRONZE} 20%, ${BRONZE} 80%, transparent)`,
            opacity: 0.55,
            pointerEvents: "none",
          }}
        />

        {/* Subtle vignette to deepen edges */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `radial-gradient(ellipse at 50% 40%, transparent 50%, ${PAPER_SHADOW} 100%)`,
          }}
        />
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

interface BigStatProps {
  value: string;
  label: string;
  suffix?: string;
  withDivider?: boolean;
}

function BigStat({ value, label, suffix, withDivider }: BigStatProps): JSX.Element {
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

function NotableLine({ label, value }: NotableLineProps): JSX.Element {
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

function Postmark({ date, flights }: PostmarkProps): JSX.Element {
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

function CompassRose(): JSX.Element {
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
