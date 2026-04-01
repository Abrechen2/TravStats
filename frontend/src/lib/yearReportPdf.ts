import type { Flight } from "../types";
import { calculateDistance } from "./geo";

interface YearReportOptions {
  year: number;
  flights: Flight[];
  userName: string;
  units: "km" | "mi";
}

export async function generateYearReportPdf(opts: YearReportOptions): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const { year, flights, userName, units } = opts;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  // ─── Page 1: Summary ──────────────────────────────────────────────────────────

  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 64, 175);
  doc.text(`✈ ${year}`, pageW / 2, 30, { align: "center" });

  doc.setFontSize(16);
  doc.setTextColor(55, 65, 81);
  doc.text("My Flying Year", pageW / 2, 40, { align: "center" });

  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text(`${userName} · Generated on ${new Date().toLocaleDateString()}`, pageW / 2, 48, {
    align: "center",
  });

  doc.setDrawColor(209, 213, 219);
  doc.line(14, 52, pageW - 14, 52);

  // Compute summary stats
  let totalDistance = 0;
  let totalFlightTimeMin = 0;
  let totalCo2 = 0;
  const airlineCounts = new Map<string, number>();
  const routeCounts = new Map<string, number>();

  for (const f of flights) {
    const dist = calculateDistance(f.depLat ?? 0, f.depLon ?? 0, f.arrLat ?? 0, f.arrLon ?? 0);
    totalDistance += dist;
    if (f.departureTime && f.arrivalTime) {
      totalFlightTimeMin +=
        (new Date(f.arrivalTime).getTime() - new Date(f.departureTime).getTime()) / 60000;
    }
    if (f.co2Kg) totalCo2 += f.co2Kg;
    const airline = f.airline ?? "Unknown";
    airlineCounts.set(airline, (airlineCounts.get(airline) ?? 0) + 1);
    const routeKey = `${f.depIata ?? f.depIcao ?? "?"} → ${f.arrIata ?? f.arrIcao ?? "?"}`;
    routeCounts.set(routeKey, (routeCounts.get(routeKey) ?? 0) + 1);
  }

  const topAirline = [...airlineCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const topRoute = [...routeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const totalHours = Math.round(totalFlightTimeMin / 60);
  const distDisplay =
    units === "mi" ? Math.round(totalDistance * 0.621371) : Math.round(totalDistance);
  const distUnit = units === "mi" ? "mi" : "km";

  const summaryItems: [string, string][] = [
    ["Total Flights", String(flights.length)],
    ["Total Distance", `${distDisplay.toLocaleString()} ${distUnit}`],
    ["Total Flight Time", `${totalHours} h`],
    ["Most Flown Airline", topAirline],
    ["Favourite Route", topRoute],
    ...(totalCo2 > 0 ? ([["Total CO₂", `${Math.round(totalCo2)} kg`]] as [string, string][]) : []),
  ];

  doc.setFontSize(11);
  let y = 62;
  for (const [label, value] of summaryItems) {
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "normal");
    doc.text(label, 20, y);
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.text(value, 100, y);
    y += 10;
  }

  // ─── Page 2: Flight list ───────────────────────────────────────────────────────
  doc.addPage();

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 64, 175);
  doc.text("Flight Overview", 14, 20);

  const tableRows = flights.map((f) => {
    const date = f.departureTime ? new Date(f.departureTime).toLocaleDateString() : "—";
    const dep = f.depIata ?? f.depIcao ?? "?";
    const arr = f.arrIata ?? f.arrIcao ?? "?";
    const dist = Math.round(
      calculateDistance(f.depLat ?? 0, f.depLon ?? 0, f.arrLat ?? 0, f.arrLon ?? 0)
    );
    const co2 = f.co2Kg != null ? String(Math.round(f.co2Kg)) : "—";
    return [date, `${dep} → ${arr}`, f.airline ?? "—", f.flightNumber, dist.toLocaleString(), co2];
  });

  autoTable(doc, {
    head: [["Date", "Route", "Airline", "Flight", `Dist. (${distUnit})`, "CO₂ (kg)"]],
    body: tableRows,
    startY: 26,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  doc.save(`flug-jahr-${year}.pdf`);
}
