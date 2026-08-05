import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useClickOutside } from "../hooks/useClickOutside";
import { RefObject } from "react";

describe("Custom Hooks", () => {
  describe("useClickOutside", () => {
    let container: HTMLDivElement;
    let innerElement: HTMLDivElement;
    let outerElement: HTMLDivElement;

    beforeEach(() => {
      // Create test DOM elements
      container = document.createElement("div");
      innerElement = document.createElement("div");
      innerElement.id = "inner";
      outerElement = document.createElement("div");
      outerElement.id = "outer";

      container.appendChild(innerElement);
      document.body.appendChild(container);
      document.body.appendChild(outerElement);
    });

    afterEach(() => {
      document.body.removeChild(container);
      document.body.removeChild(outerElement);
    });

    it("should call handler when clicking outside element", () => {
      const handler = vi.fn();
      const ref: RefObject<HTMLDivElement> = { current: innerElement };

      renderHook(() => useClickOutside(ref, handler));

      // Simulate click on outer element
      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      outerElement.dispatchEvent(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it("should not call handler when clicking inside element", () => {
      const handler = vi.fn();
      const ref: RefObject<HTMLDivElement> = { current: innerElement };

      renderHook(() => useClickOutside(ref, handler));

      // Simulate click on inner element
      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      innerElement.dispatchEvent(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should not call handler when ref is null", () => {
      const handler = vi.fn();
      const ref: RefObject<HTMLDivElement | null> = { current: null };

      renderHook(() => useClickOutside(ref, handler));

      // Simulate click anywhere
      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should handle touch events", () => {
      const handler = vi.fn();
      const ref: RefObject<HTMLDivElement> = { current: innerElement };

      renderHook(() => useClickOutside(ref, handler));

      // Simulate touch on outer element
      const event = new TouchEvent("touchstart", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "target", {
        value: outerElement,
        writable: false,
      });
      document.dispatchEvent(event);

      expect(handler).toHaveBeenCalled();
    });

    it("should not call handler for touch events inside element", () => {
      const handler = vi.fn();
      const ref: RefObject<HTMLDivElement> = { current: innerElement };

      renderHook(() => useClickOutside(ref, handler));

      // Simulate touch on inner element
      const event = new TouchEvent("touchstart", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "target", {
        value: innerElement,
        writable: false,
      });
      document.dispatchEvent(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should clean up event listeners on unmount", () => {
      const handler = vi.fn();
      const ref: RefObject<HTMLDivElement> = { current: innerElement };

      const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

      const { unmount } = renderHook(() => useClickOutside(ref, handler));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith("touchstart", expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    it("should update handler when it changes", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const ref: RefObject<HTMLDivElement> = { current: innerElement };

      const { rerender } = renderHook(({ handler }) => useClickOutside(ref, handler), {
        initialProps: { handler: handler1 },
      });

      // Click outside with first handler
      const event1 = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      outerElement.dispatchEvent(event1);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();

      // Update handler
      rerender({ handler: handler2 });

      // Click outside with second handler
      const event2 = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      outerElement.dispatchEvent(event2);

      expect(handler1).toHaveBeenCalledTimes(1); // Still 1
      expect(handler2).toHaveBeenCalledTimes(1); // Now called
    });

    it("should handle clicks on descendant elements", () => {
      const handler = vi.fn();
      const ref: RefObject<HTMLDivElement> = { current: container };

      renderHook(() => useClickOutside(ref, handler));

      // Click on child element (should not trigger handler)
      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      innerElement.dispatchEvent(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should work with multiple instances", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const ref1: RefObject<HTMLDivElement> = { current: innerElement };
      const ref2: RefObject<HTMLDivElement> = { current: container };

      renderHook(() => useClickOutside(ref1, handler1));
      renderHook(() => useClickOutside(ref2, handler2));

      // Click outside both
      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      outerElement.dispatchEvent(event);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });
});
