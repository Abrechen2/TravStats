import { useTranslation } from "../../hooks/useTranslation";
import { resolveAirlineDisplay, resolveAirlineIata } from "../../lib/airlineUtils";
import AirlineLogo from "../AirlineLogo";

interface FlightLookupResult {
  flightNumber: string;
  airline: string;
  operatingAirline?: string;
  isCodeshare?: boolean;
  callsign?: string;
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
  aircraftRegistration?: string;
  distance?: number;
  status?: string;
}

export interface FlightSelectStepProps {
  lookupResults: FlightLookupResult[];
  textClass: string;
  mutedTextClass: string;
  handleSelectFlight: (flight: FlightLookupResult) => Promise<void>;
  setStep: (step: "input" | "lookup" | "select" | "complete") => void;
}

export default function FlightSelectStep({
  lookupResults,
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
          className="w-full text-left p-4 rounded-lg border-2 border-border hover:border-blue-500 bg-(--bg-surface) transition-colors"
        >
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-2">
              <AirlineLogo
                iata={resolveAirlineIata(flight)}
                flightNumber={flight.flightNumber}
                size={28}
              />
              <div>
                <div className={`font-bold ${textClass}`}>
                  {resolveAirlineDisplay(flight) || flight.airline} {flight.flightNumber}
                </div>
                <div className={`text-sm ${mutedTextClass}`}>
                  {flight.departure.iata} {t("common:labels.routeSeparator")} {flight.arrival.iata}
                </div>
                {flight.isCodeshare && flight.operatingAirline && (
                  <div className={`text-xs ${mutedTextClass} mt-1 italic`}>
                    {t("flights:lookup.operatedBy", { airline: flight.operatingAirline })}
                  </div>
                )}
                {flight.aircraftRegistration && (
                  <div className={`text-xs ${mutedTextClass} mt-1`}>
                    {t("flights:lookup.tailNumber")}:{" "}
                    <span className="font-mono">{flight.aircraftRegistration}</span>
                  </div>
                )}
                {flight.departure.scheduledTime && (
                  <div className={`text-xs ${mutedTextClass} mt-1`}>
                    {t("flights:lookup.departs")}:{" "}
                    {new Date(flight.departure.scheduledTime).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
            {flight.status && (
              <span
                className={`px-2 py-1 rounded text-xs ${
                  flight.status === "landed"
                    ? "bg-green-100 text-green-800"
                    : flight.status === "scheduled"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-(--bg-elevated) text-(--text-primary)"
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
        className="w-full text-center text-sm text-(--text-muted) hover:text-(--text-primary)"
      >
        {t("flights:lookup.backToSearch")}
      </button>
    </div>
  );
}
