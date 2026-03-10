import { useRef } from "react";
import html2canvas from "html2canvas";
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

async function downloadCertificate(ref: React.RefObject<HTMLDivElement | null>): Promise<void> {
  if (!ref.current) return;
  const canvas = await html2canvas(ref.current, {
    backgroundColor: null,
    scale: 2,
    useCORS: true,
  });
  const link = document.createElement("a");
  link.download = "flight-certificate.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export function FlightCertificate({
  stats,
  onDownload,
  onClose,
}: FlightCertificateProps): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const cardRef = useRef<HTMLDivElement>(null);

  const generatedDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const yearsLabel =
    stats.yearsActive.length > 0 ? [...stats.yearsActive].sort((a, b) => a - b).join(", ") : "—";

  const totalFlightTimeRounded = Math.round(stats.totalFlightTime);
  const totalDistanceRounded = Math.round(stats.totalDistance).toLocaleString();

  return (
    /* Modal overlay */
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.75)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        overflowY: "auto",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Action buttons above card */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "16px",
          alignSelf: "center",
        }}
      >
        <button
          onClick={() => {
            void downloadCertificate(cardRef);
            onDownload?.();
          }}
          style={{
            backgroundColor: "#d4af37",
            color: "#0a1628",
            border: "none",
            borderRadius: "8px",
            padding: "10px 24px",
            fontSize: "15px",
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: "0.04em",
          }}
        >
          ⬇ {t("stats:certificate.download")}
        </button>
        <button
          onClick={onClose}
          style={{
            backgroundColor: "transparent",
            color: "#ffffff",
            border: "2px solid rgba(255,255,255,0.4)",
            borderRadius: "8px",
            padding: "10px 24px",
            fontSize: "15px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("stats:certificate.close")}
        </button>
      </div>

      {/* Certificate card — ref attached here for html2canvas */}
      <div
        ref={cardRef}
        style={{
          width: "800px",
          maxWidth: "100%",
          backgroundColor: "#0a1628",
          borderRadius: "16px",
          overflow: "hidden",
          fontFamily: "'Georgia', 'Times New Roman', serif",
          boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
          border: "2px solid #d4af37",
          position: "relative",
        }}
      >
        {/* Top decorative bar */}
        <div
          style={{
            height: "6px",
            background: "linear-gradient(90deg, #d4af37, #f5e07a, #d4af37)",
          }}
        />

        {/* Header section */}
        <div
          style={{
            padding: "40px 48px 28px",
            textAlign: "center",
            borderBottom: "1px solid rgba(212,175,55,0.3)",
          }}
        >
          {/* Airplane icon */}
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>✈</div>

          <div
            style={{
              fontSize: "11px",
              letterSpacing: "0.3em",
              color: "#d4af37",
              textTransform: "uppercase",
              marginBottom: "8px",
              fontFamily: "'Arial', sans-serif",
            }}
          >
            TravStats
          </div>

          <h1
            style={{
              fontSize: "32px",
              fontWeight: 700,
              color: "#ffffff",
              margin: "0 0 4px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {t("stats:certificate.headline")}
          </h1>

          {/* Decorative line */}
          <div
            style={{
              width: "80px",
              height: "2px",
              background: "linear-gradient(90deg, transparent, #d4af37, transparent)",
              margin: "14px auto",
            }}
          />

          <p
            style={{
              fontSize: "18px",
              color: "#c8d6e8",
              margin: 0,
              fontStyle: "italic",
            }}
          >
            {stats.userName}
          </p>
        </div>

        {/* Stats grid */}
        <div
          style={{
            padding: "32px 48px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "24px",
          }}
        >
          {/* Total Flights */}
          <StatCell
            value={String(stats.totalFlights)}
            label={t("stats:certificate.totalFlights")}
          />

          {/* Total Distance */}
          <StatCell
            value={`${totalDistanceRounded} km`}
            label={t("stats:certificate.totalDistance")}
          />

          {/* Total Flight Time */}
          <StatCell
            value={`${totalFlightTimeRounded} h`}
            label={t("stats:certificate.totalFlightTime")}
          />

          {/* Top Airline */}
          <StatCell value={stats.topAirline ?? "—"} label={t("stats:certificate.topAirline")} />

          {/* Favorite Route */}
          <StatCell
            value={stats.favoriteRoute ?? "—"}
            label={t("stats:certificate.favoriteRoute")}
          />

          {/* Years Active */}
          <StatCell value={yearsLabel} label={t("stats:certificate.years")} />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "20px 48px 32px",
            borderTop: "1px solid rgba(212,175,55,0.3)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <p
            style={{
              fontSize: "12px",
              color: "rgba(200,214,232,0.6)",
              margin: 0,
              fontFamily: "'Arial', sans-serif",
              fontStyle: "italic",
            }}
          >
            {t("stats:certificate.generatedOn", { date: generatedDate })}
          </p>
          <p
            style={{
              fontSize: "12px",
              color: "rgba(212,175,55,0.7)",
              margin: 0,
              fontFamily: "'Arial', sans-serif",
              letterSpacing: "0.04em",
            }}
          >
            {t("stats:certificate.poweredBy")}
          </p>
        </div>

        {/* Bottom decorative bar */}
        <div
          style={{
            height: "6px",
            background: "linear-gradient(90deg, #d4af37, #f5e07a, #d4af37)",
          }}
        />
      </div>
    </div>
  );
}

interface StatCellProps {
  value: string;
  label: string;
}

function StatCell({ value, label }: StatCellProps): JSX.Element {
  return (
    <div
      style={{
        backgroundColor: "rgba(255,255,255,0.04)",
        borderRadius: "10px",
        padding: "16px 20px",
        border: "1px solid rgba(212,175,55,0.15)",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontSize: "22px",
          fontWeight: 700,
          color: "#d4af37",
          margin: "0 0 6px",
          fontFamily: "'Arial', sans-serif",
          lineHeight: 1.2,
          wordBreak: "break-word",
        }}
      >
        {value}
      </p>
      <p
        style={{
          fontSize: "11px",
          color: "rgba(200,214,232,0.7)",
          margin: 0,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontFamily: "'Arial', sans-serif",
        }}
      >
        {label}
      </p>
    </div>
  );
}
