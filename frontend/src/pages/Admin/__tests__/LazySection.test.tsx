import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LazySection } from "../LazySection";
import {
  installFakeIntersectionObserver,
  type FakeIntersectionObserverHandle,
} from "./intersectionObserverStub";

/**
 * Wave C finding C1 (independent review, 2026-09-17): an unmounted
 * `LazySection` had height 0, so on a tab with several of them they all sat
 * at the same point and fell inside the observer's 200px root margin at
 * once — every section fetched immediately, and the deferral bought nothing.
 * These tests pin the fix: a reserved placeholder height before mount, real
 * content deciding its own height afterwards, and the existing "fires once"
 * guarantee still holding once intersections can actually be observed (jsdom
 * has no IntersectionObserver at all, so this needs the stub either way —
 * see `intersectionObserverStub.ts`).
 */
describe("LazySection", () => {
  let io: FakeIntersectionObserverHandle;

  afterEach(() => {
    io?.restore();
  });

  it("reserves a non-zero placeholder height before it has been observed", () => {
    io = installFakeIntersectionObserver();
    render(
      <LazySection id="admin-backups" ariaLabel="Backups">
        <div>real content</div>
      </LazySection>
    );

    const section = screen.getByRole("region", { name: "Backups" });
    // A non-zero reservation is the point of the fix — the exact figure is
    // an implementation detail the test does not need to pin down.
    expect(Number.parseInt(section.style.minHeight, 10)).toBeGreaterThan(0);
    expect(screen.queryByText("real content")).not.toBeInTheDocument();
  });

  it("drops the placeholder height once the section has mounted its real content", () => {
    io = installFakeIntersectionObserver();
    render(
      <LazySection id="admin-backups" ariaLabel="Backups">
        <div>real content</div>
      </LazySection>
    );

    const section = screen.getByRole("region", { name: "Backups" });
    act(() => {
      io.observerFor("admin-backups")?.trigger(true);
    });

    expect(screen.getByText("real content")).toBeInTheDocument();
    // Real content now decides the height — a leftover floor would fight it.
    expect(section.style.minHeight).toBe("");
  });

  it("calls onVisible exactly once even if the observer reports intersection again", () => {
    io = installFakeIntersectionObserver();
    const onVisible = vi.fn();
    render(
      <LazySection id="admin-backups" ariaLabel="Backups" onVisible={onVisible}>
        <div>real content</div>
      </LazySection>
    );

    const observer = io.observerFor("admin-backups");
    act(() => {
      observer?.trigger(true);
      observer?.trigger(true);
    });

    expect(onVisible).toHaveBeenCalledTimes(1);
  });
});
