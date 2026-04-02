import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { VisModeSelector } from "../../components/VisModeSelector";

const FRAMER_PROPS = new Set([
  "initial",
  "animate",
  "exit",
  "transition",
  "whileTap",
  "whileHover",
]);

function filterFramerProps(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).filter(([k]) => !FRAMER_PROPS.has(k)));
}

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div {...filterFramerProps(rest)}>{children}</div>
    ),
    button: ({
      children,
      ...rest
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>) => (
      <button {...filterFramerProps(rest)}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const defaultProps = {
  current: "routes" as const,
  onChange: vi.fn(),
  isOpen: false,
  onOpenChange: vi.fn(),
};

describe("VisModeSelector FAB", () => {
  it("renders the FAB toggle button", () => {
    render(<VisModeSelector {...defaultProps} />);
    expect(screen.getByRole("button", { name: "map:visMode.label" })).toBeInTheDocument();
  });

  it("does not show mode list when closed", () => {
    render(<VisModeSelector {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole("button", { name: "map:visMode.heatmap" })).not.toBeInTheDocument();
  });

  it("shows all 7 mode buttons when open", () => {
    render(<VisModeSelector {...defaultProps} isOpen={true} />);
    expect(screen.getByRole("button", { name: "map:visMode.routes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.globe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.heatmap" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.hexagon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.columns" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.trips" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.contour" })).toBeInTheDocument();
  });

  it("calls onOpenChange(true) when FAB is clicked while closed", () => {
    const onOpenChange = vi.fn();
    render(<VisModeSelector {...defaultProps} isOpen={false} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "map:visMode.label" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("calls onOpenChange(false) when FAB is clicked while open", () => {
    const onOpenChange = vi.fn();
    render(<VisModeSelector {...defaultProps} isOpen={true} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "map:visMode.label" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onChange and onOpenChange(false) when a mode is selected", () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <VisModeSelector
        {...defaultProps}
        isOpen={true}
        onChange={onChange}
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "map:visMode.heatmap" }));
    expect(onChange).toHaveBeenCalledWith("heatmap");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("marks the active mode with aria-pressed=true", () => {
    render(<VisModeSelector {...defaultProps} isOpen={true} current="heatmap" />);
    expect(screen.getByRole("button", { name: "map:visMode.heatmap" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("marks inactive modes with aria-pressed=false", () => {
    render(<VisModeSelector {...defaultProps} isOpen={true} current="routes" />);
    expect(screen.getByRole("button", { name: "map:visMode.heatmap" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("calls onOpenChange(false) on Escape key when open", () => {
    const onOpenChange = vi.fn();
    render(<VisModeSelector {...defaultProps} isOpen={true} onOpenChange={onOpenChange} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
