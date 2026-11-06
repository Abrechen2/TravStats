import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RouteCell from "../RouteCell";
import type { Flight } from "../../../types";

const flight = {
  id: "1",
  depIata: "MUC",
  arrIata: "DXB",
  depCountry: "DE",
  arrCountry: "AE",
  depName: "Munich Airport",
  arrName: "Dubai International",
  depLat: 0,
  depLon: 0,
  arrLat: 0,
  arrLon: 0,
} as unknown as Flight;

it("renders SVG flags, codes and the names line", () => {
  const { container } = render(<RouteCell flight={flight} />);
  expect(container.querySelector('img[src*="/flags/de.svg"]')).not.toBeNull();
  expect(container.querySelector('img[src*="/flags/ae.svg"]')).not.toBeNull();
  expect(screen.getByText("MUC")).toBeInTheDocument();
  expect(screen.getByText("DXB")).toBeInTheDocument();
  expect(screen.getByText(/Munich Airport/)).toBeInTheDocument();
});

it("omits flags gracefully when countries are missing", () => {
  const { container } = render(
    <RouteCell flight={{ ...flight, depCountry: null, arrCountry: null } as unknown as Flight} />
  );
  expect(container.querySelector('img[src*="/flags/"]')).toBeNull();
  expect(screen.getByText("MUC")).toBeInTheDocument();
});
