import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AirlineLogo from "../AirlineLogo";

describe("AirlineLogo", () => {
  it("requests the backend proxy with the default icon variant", () => {
    render(<AirlineLogo iata="LH" />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("/api/v1/airline-logos/LH?variant=icon");
  });

  it("passes an explicit variant through", () => {
    render(<AirlineLogo iata="LH" variant="logo-white" />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("variant=logo-white");
  });

  it("falls back to ICAO when no IATA is given", () => {
    render(<AirlineLogo icao="DLH" />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("/api/v1/airline-logos/DLH");
  });

  it("renders the letterbox fallback when the image errors", () => {
    render(<AirlineLogo iata="LH" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("LH")).toBeInTheDocument();
  });

  it("renders the letterbox immediately when no code is derivable", () => {
    render(<AirlineLogo flightNumber="12345" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("renders the custom fallback instead of the letterbox", () => {
    render(<AirlineLogo iata="LH" fallback={<em>Lufthansa</em>} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("Lufthansa")).toBeInTheDocument();
    expect(screen.queryByText("LH")).not.toBeInTheDocument();
  });
});
