import type { Dispatch, SetStateAction } from "react";
import type { Flight } from "./types";

interface BoardingPassFlightFieldsProps {
  flights: Flight[];
  setFlights: Dispatch<SetStateAction<Flight[]>>;
}

/** The ground-truth flight form the OCR fills in and the annotator corrects. */
export function BoardingPassFlightFields({
  flights,
  setFlights,
}: BoardingPassFlightFieldsProps): JSX.Element {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-(--text-primary)">Flight Data (Ground Truth)</h3>
        <p className="text-xs text-(--text-muted)">
          Felder werden automatisch durch OCR ausgefüllt
        </p>
      </div>
      <div className="p-4 border border-border rounded-lg bg-(--bg-base)">
        {flights.map((flight, index) => (
          <div key={index} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">
                  Flight Number
                </label>
                <input
                  type="text"
                  value={flight.flightNumber || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = {
                      ...updatedFlights[index],
                      flightNumber: e.target.value,
                    };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                  placeholder="LH103"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">PNR</label>
                <input
                  type="text"
                  value={flight.pnr || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = { ...updatedFlights[index], pnr: e.target.value };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                  placeholder="ABC123"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">
                  Departure Code
                </label>
                <input
                  type="text"
                  value={flight.departureCode || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = {
                      ...updatedFlights[index],
                      departureCode: e.target.value.toUpperCase(),
                    };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                  placeholder="MUC"
                  maxLength={3}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">
                  Arrival Code
                </label>
                <input
                  type="text"
                  value={flight.arrivalCode || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = {
                      ...updatedFlights[index],
                      arrivalCode: e.target.value.toUpperCase(),
                    };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                  placeholder="FRA"
                  maxLength={3}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">
                  Departure Date
                </label>
                <input
                  type="date"
                  value={flight.departureDate || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = {
                      ...updatedFlights[index],
                      departureDate: e.target.value,
                    };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">
                  Departure Time
                </label>
                <input
                  type="time"
                  value={flight.departureTime || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = {
                      ...updatedFlights[index],
                      departureTime: e.target.value,
                    };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">
                  Arrival Date
                </label>
                <input
                  type="date"
                  value={flight.arrivalDate || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = {
                      ...updatedFlights[index],
                      arrivalDate: e.target.value,
                    };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">
                  Arrival Time
                </label>
                <input
                  type="time"
                  value={flight.arrivalTime || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = {
                      ...updatedFlights[index],
                      arrivalTime: e.target.value,
                    };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">Seat</label>
                <input
                  type="text"
                  value={flight.seat || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = { ...updatedFlights[index], seat: e.target.value };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                  placeholder="16F"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">Gate</label>
                <input
                  type="text"
                  value={flight.gate || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = { ...updatedFlights[index], gate: e.target.value };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                  placeholder="A12"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">
                  Terminal
                </label>
                <input
                  type="text"
                  value={flight.terminal || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = {
                      ...updatedFlights[index],
                      terminal: e.target.value,
                    };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                  placeholder="2"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-(--text-primary) mb-1">
                  Aircraft Type
                </label>
                <input
                  type="text"
                  value={flight.aircraftType || ""}
                  onChange={(e) => {
                    const updatedFlights = [...flights];
                    updatedFlights[index] = {
                      ...updatedFlights[index],
                      aircraftType: e.target.value,
                    };
                    setFlights(updatedFlights);
                  }}
                  className="input w-full"
                  placeholder="A320, Boeing 737"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
