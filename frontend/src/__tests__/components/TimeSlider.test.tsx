import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TimeSlider } from "../../components/TimeSlider";

describe("TimeSlider", () => {
  const defaultProps = {
    min: 0,
    max: 1000,
    current: 500,
    onChange: vi.fn(),
    playing: false,
    onTogglePlay: vi.fn(),
  };

  it("renders a range slider input", () => {
    render(<TimeSlider {...defaultProps} />);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("renders a play/pause button", () => {
    render(<TimeSlider {...defaultProps} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("shows play label when not playing", () => {
    render(<TimeSlider {...defaultProps} playing={false} />);
    expect(screen.getByLabelText("Play")).toBeInTheDocument();
  });

  it("shows pause label when playing", () => {
    render(<TimeSlider {...defaultProps} playing={true} />);
    expect(screen.getByLabelText("Pause")).toBeInTheDocument();
  });

  it("calls onTogglePlay when button is clicked", () => {
    const onTogglePlay = vi.fn();
    render(<TimeSlider {...defaultProps} onTogglePlay={onTogglePlay} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onTogglePlay).toHaveBeenCalledOnce();
  });

  it("calls onChange when slider value changes", () => {
    const onChange = vi.fn();
    render(<TimeSlider {...defaultProps} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "750" } });
    expect(onChange).toHaveBeenCalledWith(750);
  });
});
