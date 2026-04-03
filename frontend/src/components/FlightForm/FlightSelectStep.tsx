import { useTranslation } from "../../hooks/useTranslation";

interface FlightLookupResult {
  flightNumber: string;
  airline: string;
  departure: {
    iata?: string;
    name?: string;
    scheduledTime?: string;
    terminal?: string;
    gate?: string;
  };
  arrival: {
    iata?: string;
    name?: string;
    scheduledTime?: string;
    terminal?: string;
    gate?: string;
  };
  aircraft?: string;
  status?: string;
}

export interface FlightSelectStepProps {
  lookupResults: FlightLookupResult[];
  isDarkMode: boolean;
  textClass: string;
  mutedTextClass: string;
  handleSelectFlight: (flight: FlightLookupResult) => Promise<void>;
  setStep: (step: "input" | "lookup" | "select" | "complete") => void;
}

export default function FlightSelectStep({
  lookupResults,
  isDarkMode,
  textClass,
  mutedTextClass,
  handleSelectFlight,
  setStep,
}: FlightSelectStepProps): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);

  return (
    <div className="space-y-4">
      <h3 className={`font-semibold text-lg ${textClass}`}>
        {t("flights:lookup.resultsTitle", { count: lookupResults.length })}
      </h3>
      {lookupResults.map((flight, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => handleSelectFlight(flight)}
          className={`w-full text-left p-4 rounded-lg border-2 ${
            isDarkMode
              ? "border-[var(--color-border)] hover:border-blue-500 bg-[var(--bg-surface)]"
              : "border-[var(--color-border)] hover:border-blue-500 bg-[var(--bg-base)]"
          } transition-colors`}
        >
          <div className="flex justify-between items-start">
            <div>
              <div className={`font-bold ${textClass}`}>
                {flight.airline} {flight.flightNumber}
              </div>
              <div className={`text-sm ${mutedTextClass}`}>
                {flight.departure.iata} {t("common:labels.routeSeparator")} {flight.arrival.iata}
              </div>
              {flight.departure.scheduledTime && (
                <div className={`text-xs ${mutedTextClass} mt-1`}>
                  {t("flights:lookup.departs")}:{" "}
                  {new Date(flight.departure.scheduledTime).toLocaleString()}
                </div>
              )}
            </div>
            {flight.status && (
              <span
                className={`px-2 py-1 rounded text-xs ${
                  flight.status === "landed"
                    ? "bg-green-100 text-green-800"
                    : flight.status === "scheduled"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                }`}
              >
                {t("flights:status." + flight.status, { defaultValue: flight.status })}
              </span>
            )}
          </div>
        </button>
      ))}
      <button
        type="button"
        onClick={() => setStep("input")}
        className="w-full text-center text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        {t("flights:lookup.backToSearch")}
      </button>
    </div>
  );
}
