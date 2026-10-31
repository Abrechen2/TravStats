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

  // forgejo#348: a commit rebuilds the map's trips layers, and rAF fires at
  // 60 Hz. Commits are throttled to ~30 Hz; playback speed stays the same.
  describe("playback", () => {
    it("commits at most ~30 times a second and keeps the same speed", () => {
      const frames: ((t: number) => void)[] = [];
      vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        frames.push(cb);
        return frames.length;
      });
      vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
      const updaters: ((prev: number) => number)[] = [];
      const onChange = vi.fn((v: number | ((prev: number) => number)) => {
        if (typeof v === "function") updaters.push(v);
      });
      render(<TimeSlider {...defaultProps} max={3600} onChange={onChange} playing />);
      // One second of 60 Hz frames.
      for (let i = 0; i <= 60; i++) {
        const cb = frames.shift();
        cb?.(i * (1000 / 60));
      }
      expect(onChange.mock.calls.length).toBeGreaterThan(20);
      expect(onChange.mock.calls.length).toBeLessThanOrEqual(31);
      // 3600 units over 3600 frames: one second of playback moves ~60 units.
      const moved = updaters.reduce((v, u) => u(v), 0);
      expect(moved).toBeGreaterThan(55);
      expect(moved).toBeLessThan(65);
      vi.restoreAllMocks();
    });
  });
});
