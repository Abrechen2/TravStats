import { format } from 'date-fns';
import type { Flight } from '../types';

interface FlightListProps {
  flights: Flight[];
  selectedFlightId?: string;
  onFlightClick: (flightId: string) => void;
  onDeleteFlight: (flightId: string) => void;
}

export default function FlightList({
  flights,
  selectedFlightId,
  onFlightClick,
  onDeleteFlight,
}: FlightListProps) {
  const getStatusBadge = (status: string) => {
    const colors = {
      scheduled: 'bg-blue-100 text-blue-800',
      flown: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status as keyof typeof colors]}`}>
        {status}
      </span>
    );
  };

  if (flights.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No flights found. Add your first flight!
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {flights.map((flight) => (
        <div
          key={flight.id}
          className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
            selectedFlightId === flight.id
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-gray-300 bg-white'
          }`}
          onClick={() => onFlightClick(flight.id)}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-lg">
                  {flight.airline} {flight.flightNumber}
                </h3>
                {getStatusBadge(flight.status)}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">From</p>
                  <p className="font-medium">
                    {flight.depIata || flight.depIcao}
                    {flight.depName && (
                      <span className="text-gray-600 ml-1">- {flight.depName}</span>
                    )}
                  </p>
                  <p className="text-gray-600">
                    {format(new Date(flight.departureTime), 'MMM dd, yyyy HH:mm')}
                  </p>
                </div>

                <div>
                  <p className="text-gray-500">To</p>
                  <p className="font-medium">
                    {flight.arrIata || flight.arrIcao}
                    {flight.arrName && (
                      <span className="text-gray-600 ml-1">- {flight.arrName}</span>
                    )}
                  </p>
                  <p className="text-gray-600">
                    {format(new Date(flight.arrivalTime), 'MMM dd, yyyy HH:mm')}
                  </p>
                </div>
              </div>

              {flight.aircraft && (
                <p className="text-sm text-gray-600 mt-2">
                  Aircraft: {flight.aircraft}
                </p>
              )}

              {flight.notes && (
                <p className="text-sm text-gray-600 mt-2 italic">
                  {flight.notes}
                </p>
              )}
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this flight?')) {
                  onDeleteFlight(flight.id);
                }
              }}
              className="text-red-600 hover:text-red-800 ml-4"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
