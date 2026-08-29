import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The picker is a custom element backed by IndexedDB, which jsdom does not
// have. The double below is a REAL HTMLElement that fires the real event name
// with the real detail shape, so the thing under test — that we listen for
// `emoji-click` and read `detail.unicode` — stays honest. `mode` decides
// whether constructing it succeeds, which is how the failure path is reached
// deterministically rather than by hoping jsdom throws.
let mode: "works" | "throws" = "works";
let lastPicker: HTMLElement | null = null;
let lastOptions: Record<string, unknown> | null = null;

vi.mock("emoji-picker-element", () => ({
  Picker: class {
    constructor(options: Record<string, unknown>) {
      lastOptions = options;
      if (mode === "throws") throw new Error("IndexedDB is blocked");
      const el = document.createElement("div");
      el.setAttribute("data-testid", "picker");
      lastPicker = el;
      return el as unknown as this;
    }
  },
}));

import { EmojiPickerField, EMOJI_DATA_URLS, emojiDataFor } from "../EmojiPickerField";

beforeEach(() => {
  mode = "works";
  lastPicker = null;
  lastOptions = null;
});

/**
 * The one that matters most for a self-hosted app.
 *
 * `emoji-picker-element` fetches its database from a public CDN by default, and
 * so do most pickers. TravStats routinely runs on a LAN with no way out, where
 * a remote data source is not a slow control but a control that never opens at
 * all — and it would work perfectly on every machine a developer tests it on.
 */
describe("the emoji data is served by this instance", () => {
  it("never points at a remote host", () => {
    for (const url of Object.values(EMOJI_DATA_URLS)) {
      expect(url).toBeTruthy();
      expect(url).not.toMatch(/^https?:/i);
      expect(url).not.toMatch(/^\/\//);
      expect(url).not.toMatch(/cdn|jsdelivr|unpkg/i);
    }
  });

  it("serves German data to a German interface and English to everything else", () => {
    // German CLDR names are the reason: the fries are "Pommes frites" there and
    // findable by typing "pommes", which the English set cannot do.
    expect(emojiDataFor("de").locale).toBe("de");
    expect(emojiDataFor("de-DE").locale).toBe("de");
    expect(emojiDataFor("en").locale).toBe("en");
    expect(emojiDataFor("fr").locale).toBe("en");
    expect(emojiDataFor("de").dataSource).toBe(EMOJI_DATA_URLS.de);
    expect(emojiDataFor("en").dataSource).toBe(EMOJI_DATA_URLS.en);
  });
});

describe("EmojiPickerField", () => {
  const setup = (value = "") => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <EmojiPickerField value={value} onChange={onChange} onCommit={onCommit} label="Symbol" />
    );
    return { onChange, onCommit };
  };

  it("keeps the field usable without ever opening the picker", () => {
    // Pasting is how this worked before there was a picker, and it has to keep
    // working: the picker is a convenience layered on top, not the only way in.
    const { onChange, onCommit } = setup();
    const input = screen.getByLabelText("Symbol");
    fireEvent.change(input, { target: { value: "🍟" } });
    expect(onChange).toHaveBeenCalledWith("🍟");
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input, { target: { value: "🍟" } });
    expect(onCommit).toHaveBeenCalledWith("🍟");
  });

  it("hands a picked emoji to the caller and closes", async () => {
    const { onChange, onCommit } = setup();
    fireEvent.click(screen.getByText("common:emojiPicker.open"));
    await waitFor(() => expect(lastPicker).not.toBeNull());

    lastPicker?.dispatchEvent(
      new CustomEvent("emoji-click", { detail: { unicode: "🍟" } })
    );

    expect(onChange).toHaveBeenCalledWith("🍟");
    // A click on an emoji IS the decision — it must not wait for a blur that
    // may never come, or the choice is silently dropped.
    expect(onCommit).toHaveBeenCalledWith("🍟");
    await waitFor(() => expect(screen.queryByTestId("picker")).toBeNull());
  });

  it("ignores an event carrying no emoji", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByText("common:emojiPicker.open"));
    return waitFor(() => expect(lastPicker).not.toBeNull()).then(() => {
      lastPicker?.dispatchEvent(new CustomEvent("emoji-click", { detail: {} }));
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it("gives the picker its own translated labels, not just translated data", async () => {
    // `locale` alone only chooses the emoji DATA. Without an `i18n` object the
    // picker's search box reads "Search" inside a German interface — which is
    // exactly what a browser showed and no test had caught.
    // The harness reports English, so this pins the CONTRACT rather than the
    // German words: whatever locale is chosen, the matching label module has to
    // travel with it.
    setup();
    fireEvent.click(screen.getByText("common:emojiPicker.open"));
    await waitFor(() => expect(lastOptions).not.toBeNull());

    const locale = lastOptions?.locale as "de" | "en";
    expect(["de", "en"]).toContain(locale);

    const expected = (await import(`emoji-picker-element/i18n/${locale}`)).default;
    expect(lastOptions?.i18n).toBe(expected);
    expect((lastOptions?.i18n as { searchLabel?: string }).searchLabel).toBeTruthy();
  });

  it("says so when the picker cannot load, and leaves the field alone", async () => {
    // A private window blocks IndexedDB and a chunk can fail to arrive. Neither
    // is our fault, and neither may take the setting down with it.
    mode = "throws";
    const { onChange } = setup();
    fireEvent.click(screen.getByText("common:emojiPicker.open"));

    await waitFor(() =>
      expect(screen.getByText("common:emojiPicker.unavailable")).toBeTruthy()
    );
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "🏨" } });
    expect(onChange).toHaveBeenCalledWith("🏨");
  });

  it("offers a way to remove the symbol only once there is one", () => {
    const empty = setup("");
    expect(screen.queryByText("common:emojiPicker.clear")).toBeNull();
    empty.onChange.mockClear();

    const { onChange, onCommit } = setup("🍟");
    fireEvent.click(screen.getByText("common:emojiPicker.clear"));
    expect(onChange).toHaveBeenCalledWith("");
    expect(onCommit).toHaveBeenCalledWith("");
  });
});
