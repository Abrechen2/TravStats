import { describe, expect, it } from "vitest";
import { MAX_CONCURRENT_THUMBS, activeThumbCount, requestThumbSlot } from "./thumbQueue";

describe("thumbQueue", () => {
  it("lets only six thumbnails load at once and starts the next as one finishes", () => {
    const started: number[] = [];
    const slots = Array.from({ length: 10 }, (_, i) => requestThumbSlot(() => started.push(i)));
    expect(started).toHaveLength(MAX_CONCURRENT_THUMBS);

    slots[0].release();
    expect(started).toHaveLength(MAX_CONCURRENT_THUMBS + 1);
    // Releasing twice must not hand out a second slot.
    slots[0].release();
    expect(started).toHaveLength(MAX_CONCURRENT_THUMBS + 1);

    slots.forEach((s) => s.release());
    expect(started).toHaveLength(10);
    slots.forEach((s) => s.release());
    expect(activeThumbCount()).toBe(0);
  });

  it("drops a waiting request that was cancelled, without ever starting it", () => {
    const slots = Array.from({ length: 6 }, () => requestThumbSlot(() => undefined));
    let ran = false;
    const waiting = requestThumbSlot(() => {
      ran = true;
    });
    waiting.cancel();
    slots[0].release();
    expect(ran).toBe(false);
    slots.forEach((s) => s.release());
    expect(activeThumbCount()).toBe(0);
  });
});
