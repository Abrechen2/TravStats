import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FlightRowActions from "../FlightRowActions";
import type { Flight } from "../../types";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

const flight = { id: "f1", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 } as unknown as Flight;
const noop = () => {};

it("renders icon buttons with accessible labels and no text labels", () => {
  render(<FlightRowActions flight={flight} openDuplicateMenuFor={null}
    onToggleDuplicateMenu={noop} onEdit={noop} onDuplicate={noop} onDelete={noop} />);
  expect(screen.getByLabelText("common:buttons.edit")).toBeInTheDocument();
  expect(screen.getByLabelText("flights:table.duplicate.label")).toBeInTheDocument();
  expect(screen.getByLabelText("common:buttons.delete")).toBeInTheDocument();
  // no visible text labels anymore
  expect(screen.queryByText("common:buttons.edit")).not.toBeInTheDocument();
});

it("keeps the controlled duplicate dropdown contract", () => {
  const onToggle = vi.fn();
  render(<FlightRowActions flight={flight} openDuplicateMenuFor={null}
    onToggleDuplicateMenu={onToggle} onEdit={noop} onDuplicate={noop} onDelete={noop} />);
  fireEvent.click(screen.getByLabelText("flights:table.duplicate.label"));
  expect(onToggle).toHaveBeenCalledWith("f1");
});

it("shows the dropdown entries when open", () => {
  render(<FlightRowActions flight={flight} openDuplicateMenuFor="f1"
    onToggleDuplicateMenu={noop} onEdit={noop} onDuplicate={noop} onDelete={noop} />);
  expect(screen.getByText("flights:table.duplicate.same")).toBeInTheDocument();
  expect(screen.getByText("flights:table.duplicate.return")).toBeInTheDocument();
});
