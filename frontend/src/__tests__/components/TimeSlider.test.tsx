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

  // The accessible name is TRANSLATED copy, so these assert the key the test
  // i18n fake returns. They used to assert the literals "Play"/"Pause", which
  // pinned the defect Forgejo #7 reported one component over: an English name
  // announced to a German screen reader.
  it("names the button by its play action when not playing", () => {
    render(<TimeSlider {...defaultProps} playing={false} />);
    expect(screen.getByLabelText("common:accessibility.play")).toBeInTheDocument();
  });

  it("names the button by its pause action when playing", () => {
    render(<TimeSlider {...defaultProps} playing={true} />);
    expect(screen.getByLabelText("common:accessibility.pause")).toBeInTheDocument();
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
