import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { LoginBackdrop } from "../LoginBackdrop";
import { DEFAULT_LOGIN_BACKGROUNDS } from "../../lib/defaultLoginBackgrounds";

/**
 * The sign-in slideshow (Alex, 2026-09-21).
 *
 * What is worth pinning is mostly about the cases where the instance has
 * nothing of its own: it must fall back to the shipped pictures rather than
 * to a bare gradient, a failed fetch must be silent on the page where someone
 * is trying to sign in AND still show something, an admin's own uploads must
 * REPLACE the shipped set rather than join it, and a reader who asked for
 * less motion gets a still picture rather than a slideshow.
 */

const getLoginBackgrounds = vi.fn();
vi.mock("../../lib/api/loginBackgrounds", () => ({
  getLoginBackgrounds: () => getLoginBackgrounds(),
  loginBackgroundUrl: (name: string) => `/api/v1/login-backgrounds/${name}`,
}));

function withReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** The image layers, in render order. The scrim is the last child and has no
 *  background image, so it is excluded by that. */
function layers(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("div[style*='background-image']")];
}

beforeEach(() => {
  getLoginBackgrounds.mockReset();
  withReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LoginBackdrop", () => {
  it("shows the shipped pictures when the instance has none of its own", async () => {
    getLoginBackgrounds.mockResolvedValue([]);
    const { container } = render(<LoginBackdrop />);
    await waitFor(() => expect(layers(container)).toHaveLength(DEFAULT_LOGIN_BACKGROUNDS.length));
    expect(layers(container)[0].style.backgroundImage).toContain(DEFAULT_LOGIN_BACKGROUNDS[0]);
  });

  it("stays silent when the list cannot be fetched, and still shows the shipped ones", async () => {
    getLoginBackgrounds.mockRejectedValue(new Error("offline"));
    const { container } = render(<LoginBackdrop />);
    await waitFor(() => expect(layers(container)).toHaveLength(DEFAULT_LOGIN_BACKGROUNDS.length));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lets an admin's own pictures REPLACE the shipped ones, never join them", async () => {
    getLoginBackgrounds.mockResolvedValue(["eigenes.jpg"]);
    const { container } = render(<LoginBackdrop />);
    await waitFor(() => expect(layers(container)).toHaveLength(1));
    expect(layers(container)[0].style.backgroundImage).toContain("eigenes.jpg");
  });

  it("shows the first image and keeps the others loaded but transparent", async () => {
    getLoginBackgrounds.mockResolvedValue(["a.jpg", "b.jpg"]);
    const { container } = render(<LoginBackdrop />);
    await waitFor(() => expect(layers(container)).toHaveLength(2));
    expect(layers(container)[0].style.opacity).toBe("1");
    expect(layers(container)[1].style.opacity).toBe("0");
  });

  it("advances to the next image on its own", async () => {
    vi.useFakeTimers();
    getLoginBackgrounds.mockResolvedValue(["a.jpg", "b.jpg"]);
    const { container } = render(<LoginBackdrop />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(layers(container)[0].style.opacity).toBe("1");

    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(layers(container)[0].style.opacity).toBe("0");
    expect(layers(container)[1].style.opacity).toBe("1");
  });

  it("does not move for a reader who asked for reduced motion", async () => {
    vi.useFakeTimers();
    withReducedMotion(true);
    getLoginBackgrounds.mockResolvedValue(["a.jpg", "b.jpg"]);
    const { container } = render(<LoginBackdrop />);
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(layers(container)[0].style.opacity).toBe("1");
  });
});
