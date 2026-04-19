import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DomainPickerStep from "../../components/Setup/DomainPickerStep";

describe("DomainPickerStep", () => {
  it("renders all domains, only available are interactive", () => {
    const onChange = vi.fn();
    render(<DomainPickerStep value={["flight"]} onChange={onChange} />);
    expect(screen.getByText("domain.flight")).toBeInTheDocument();
    expect(screen.getByText("domain.cruise")).toBeInTheDocument();
  });

  it("calls onChange with new selection when a card is clicked", () => {
    const onChange = vi.fn();
    render(<DomainPickerStep value={["flight"]} onChange={onChange} />);
    const flightCard = screen.getByTestId("domain-card-flight");
    fireEvent.click(flightCard);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("locked (unavailable) cards do not trigger onChange", () => {
    const onChange = vi.fn();
    render(<DomainPickerStep value={["flight"]} onChange={onChange} />);
    const hotelCard = screen.getByTestId("domain-card-hotel");
    fireEvent.click(hotelCard);
    expect(onChange).not.toHaveBeenCalled();
  });
});
