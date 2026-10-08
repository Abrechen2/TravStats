import { describe, it, expect } from "vitest";
import { lodgingDeleteMessage } from "../lodgingDeleteMessage";
import de from "../../i18n/resources/de/lodging.json";
import en from "../../i18n/resources/en/lodging.json";

/** Echoes the key with its variables, so the assertions read as sentences. */
const t = (key: string, options?: Record<string, unknown>): string =>
  options && Object.keys(options).length > 0 ? `${key}${JSON.stringify(options)}` : key;

const house = { name: "Hotel Adlon", stayCount: 3, chain: null };

describe("lodgingDeleteMessage", () => {
  it("starts with the counted sentence while no count is known", () => {
    const message = lodgingDeleteMessage(t, house, {
      documentCount: null,
      photoCount: null,
      tripNames: [],
    });
    expect(
      message.startsWith('lodging:detail.deleteConfirmMessage{"name":"Hotel Adlon","count":3}')
    ).toBe(true);
    // No count line - an unknown count is absent, never "none".
    expect(message).not.toContain("deletePhotosNote");
    expect(message).not.toContain("deleteCascadeNote");
  });

  it("uses the no-stays sentence for a house without stays", () => {
    expect(
      lodgingDeleteMessage(
        t,
        { ...house, stayCount: 0 },
        { documentCount: null, photoCount: null, tripNames: [] }
      )
    ).toBe('lodging:detail.deleteConfirmMessageNoStays{"name":"Hotel Adlon"}');
  });

  it("adds a line for photographs and one for kept originals, only when there are any", () => {
    const message = lodgingDeleteMessage(t, house, {
      documentCount: 4,
      photoCount: 2,
      tripNames: [],
    });
    expect(message).toContain('lodging:detail.deletePhotosNote{"count":2}');
    expect(message).toContain('documents:deleteCascadeNote{"count":4}');

    const none = lodgingDeleteMessage(t, house, { documentCount: 0, photoCount: 0, tripNames: [] });
    expect(none).not.toContain("deletePhotosNote");
    expect(none).not.toContain("deleteCascadeNote");
  });

  it("names what stays: the linked trips and the chain", () => {
    const message = lodgingDeleteMessage(
      t,
      { ...house, chain: { id: 1, name: "Kempinski" } as never },
      { documentCount: null, photoCount: null, tripNames: ["Berlin 2024", "Rom"] }
    );
    expect(message).toContain("common:delete.survivors");
    expect(message).toContain("Berlin 2024, Rom");
    expect(message).toContain("lodging:detail.survivorChain");
    expect(message).toContain("Kempinski");
  });

  // forgejo#250 review: a failed trips call (or a house whose stays link none)
  // used to make the question go quiet about what stays.
  it("still says what stays when the trips cannot be named", () => {
    const message = lodgingDeleteMessage(t, house, {
      documentCount: null,
      photoCount: null,
      tripNames: [],
    });
    expect(message).toContain("common:delete.survivors");
    expect(message).toContain("lodging:detail.survivorTripsUnnamed");
  });

  it("names the chain beside the unnamed trips", () => {
    const message = lodgingDeleteMessage(
      t,
      { ...house, chain: { id: 1, name: "Kempinski" } as never },
      { documentCount: null, photoCount: null, tripNames: [] }
    );
    expect(message).toContain("lodging:detail.survivorTripsUnnamed");
    expect(message).toContain("Kempinski");
  });

  it("says nothing about survivors for a house with no stays and no chain", () => {
    expect(
      lodgingDeleteMessage(
        t,
        { ...house, stayCount: 0 },
        {
          documentCount: null,
          photoCount: null,
          tripNames: [],
        }
      )
    ).not.toContain("survivors");
  });

  // The trips are named ONCE, in the "stays" line. The counted sentence used to
  // say "Zugehörige Reisen bleiben erhalten" as well, so a house with trips said
  // it twice.
  it("keeps the trips out of the counted sentence, which would repeat the survivors line", () => {
    for (const [pattern, resource] of [
      [/Reisen/, de],
      [/[Tt]rips/, en],
    ] as const) {
      for (const key of [
        "deleteConfirmMessage",
        "deleteConfirmMessage_one",
        "deleteConfirmMessage_other",
        "deleteConfirmMessageNoStays",
      ] as const) {
        expect(resource.detail[key]).not.toMatch(pattern);
      }
    }
  });
});
