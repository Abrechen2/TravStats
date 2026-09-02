import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import DataQualityFlagCard from "../../components/DataQuality/DataQualityFlagCard";
import type { DataQualityFlag } from "../../types/dataQuality";

/**
 * A flag is a question, not a verdict — so the card's job is to show BOTH
 * values of a disagreement and mark neither. These tests assert exactly that,
 * per kind, because the failure mode is silent: a card that renders only the
 * geocoder's answer looks fine and quietly gives a third party a veto over the
 * user's own data.
 *
 * The global setup mock makes `t` return the key, so labels assert as keys and
 * the values under test are the DATA — which is what matters here.
 */

const flagBase = {
  id: "flag-1",
  status: "open" as const,
  createdAt: "2026-09-01T10:00:00.000Z",
  resolvedAt: null,
};

const mismatchFlag: DataQualityFlag = {
  ...flagBase,
  entityType: "lodging",
  entityId: "lodging-1",
  kind: "address_country_mismatch",
  subject: { entityType: "lodging", entityId: "lodging-1", label: "Hotel Sport" },
  details: {
    claimedCountryCode: "RO",
    claimedCountryText: "Rumänien",
    addressCountryCode: "SI",
    addressCountryText: "Slovenia",
    address: "Grajska cesta 2, Otočec, Slovenia",
  },
};

const undatedFlag: DataQualityFlag = {
  ...flagBase,
  id: "flag-2",
  entityType: "country",
  entityId: "CZ",
  kind: "undated_country_evidence",
  // A country subject carries the CODE and no label — the name is localised
  // here, not on the server. The old shape put "CZ" in `label`, which made that
  // field a name for a row and a code for a country.
  subject: { entityType: "country", countryCode: "CZ" },
  details: {
    countryCode: "CZ",
    records: [
      { entityType: "lodging", entityId: "lodging-9", label: "Pension Prag" },
      { entityType: "place", entityId: "place-4", label: "Karlsbrücke" },
    ],
  },
};

const reversedFlag: DataQualityFlag = {
  ...flagBase,
  id: "flag-3",
  entityType: "lodging",
  entityId: "lodging-7",
  kind: "stay_dates_reversed",
  subject: { entityType: "lodging", entityId: "lodging-7", label: "Gasthof Alpenblick" },
  details: {
    stays: [
      {
        stayId: "stay-1",
        checkIn: "2024-09-03T00:00:00.000Z",
        checkOut: "2024-03-09T00:00:00.000Z",
      },
    ],
  },
};

function renderCard(
  flag: DataQualityFlag,
  handlers?: { resolve?: () => void; dismiss?: () => void }
) {
  return render(
    <MemoryRouter>
      <DataQualityFlagCard
        flag={flag}
        onResolve={handlers?.resolve ?? vi.fn()}
        onDismiss={handlers?.dismiss ?? vi.fn()}
      />
    </MemoryRouter>
  );
}

describe("DataQualityFlagCard — both values, neither marked correct", () => {
  it("shows the stored country AND the country read from the address", () => {
    renderCard(mismatchFlag);

    // Both codes are on screen. Neither is struck through, and there is no
    // arrow between them — that vocabulary belongs to the flight-update diff.
    expect(screen.getByText("Romania (RO)")).toBeInTheDocument();
    expect(screen.getByText("Slovenia (SI)")).toBeInTheDocument();
    // The raw text each side was read from travels too, so the user can see
    // what was read and not only what it was read as.
    expect(screen.getByText("Rumänien")).toBeInTheDocument();
    expect(screen.getByText("Slovenia")).toBeInTheDocument();
    expect(screen.getByText(/Grajska cesta 2/)).toBeInTheDocument();
  });

  it("shows the undated country against the absence of any dated record", () => {
    renderCard(undatedFlag);

    // "no dated evidence" and "2 undated records" are the two sides.
    expect(
      screen.getByText("dataQuality:kinds.undated_country_evidence.datedNone")
    ).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Pension Prag")).toBeInTheDocument();
    expect(screen.getByText("Karlsbrücke")).toBeInTheDocument();
  });

  it("shows both stay dates as stored, without reordering them", () => {
    renderCard(reversedFlag);

    expect(screen.getByText("dataQuality:kinds.stay_dates_reversed.checkIn")).toBeInTheDocument();
    expect(screen.getByText("dataQuality:kinds.stay_dates_reversed.checkOut")).toBeInTheDocument();

    // Both stored dates are on screen and they are still the two stored dates —
    // nothing was swapped into a plausible order. Formatted here the same way
    // the component formats them, because the property under test is "both
    // values are shown", not the date format, and hardcoding a rendering would
    // make the test depend on the machine's timezone.
    const asShown = (iso: string) =>
      new Date(iso).toLocaleDateString("en", { year: "numeric", month: "2-digit", day: "2-digit" });
    expect(screen.getByText(asShown("2024-09-03T00:00:00.000Z"))).toBeInTheDocument();
    expect(screen.getByText(asShown("2024-03-09T00:00:00.000Z"))).toBeInTheDocument();
  });
});

describe("DataQualityFlagCard — the record is reachable and editable", () => {
  it("links a lodging flag to the lodging detail page", () => {
    renderCard(mismatchFlag);
    expect(screen.getByRole("link", { name: "Hotel Sport" }).getAttribute("href")).toBe(
      "/lodging/lodging-1"
    );
  });

  it("links every record behind a country flag, since a country has no page", () => {
    renderCard(undatedFlag);
    expect(screen.getByRole("link", { name: "Pension Prag" }).getAttribute("href")).toBe(
      "/lodging/lodging-9"
    );
    expect(screen.getByRole("link", { name: "Karlsbrücke" }).getAttribute("href")).toBe(
      "/places/place-4"
    );
  });
});

describe("DataQualityFlagCard — the subject is named, never coded", () => {
  it("localises a country subject instead of printing its ISO code", () => {
    // The whole reason a country subject carries `countryCode` and no `label`:
    // the server cannot know the reader's language, so the name is made here.
    renderCard(undatedFlag);

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Czechia");
    expect(screen.queryByRole("heading", { name: "CZ" })).toBeNull();
  });

  it("says what an unnameable code is rather than printing it bare", () => {
    // A code no name can be made from must not land on the line where a hotel
    // name would stand — "CZ" as a heading reads as a place called CZ.
    renderCard({
      ...undatedFlag,
      entityId: "not-a-code",
      subject: { entityType: "country", countryCode: "not-a-code" },
    });

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(
      "dataQuality:flag.unknownCountry"
    );
  });

  it("names a row from the label the user wrote", () => {
    renderCard(mismatchFlag);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Hotel Sport");
  });
});

describe("DataQualityFlagCard — the two answers are not synonyms", () => {
  it("labels them differently and states the different consequence of each", () => {
    renderCard(mismatchFlag);

    const resolve = screen.getByRole("button", {
      name: "dataQuality:flag.actions.resolve.label",
    });
    const dismiss = screen.getByRole("button", {
      name: "dataQuality:flag.actions.dismiss.label",
    });
    expect(resolve).not.toBe(dismiss);

    // Each button carries its own consequence as visible copy, not a tooltip.
    expect(screen.getByText("dataQuality:flag.actions.resolve.hint")).toBeInTheDocument();
    expect(screen.getByText("dataQuality:flag.actions.dismiss.hint")).toBeInTheDocument();
  });

  it("calls resolve and dismiss separately", async () => {
    const resolve = vi.fn();
    const dismiss = vi.fn();
    renderCard(mismatchFlag, { resolve, dismiss });

    await userEvent.click(
      screen.getByRole("button", { name: "dataQuality:flag.actions.resolve.label" })
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "dataQuality:flag.actions.dismiss.label" })
    );
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("offers no answer buttons on a flag that was already answered", () => {
    renderCard({ ...mismatchFlag, status: "dismissed" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/dataQuality:flag.status.dismissed/)).toBeInTheDocument();
  });
});

describe("DataQualityFlagCard — degrades instead of crashing", () => {
  it("renders a flag whose subject is missing", () => {
    const { subject: _subject, ...withoutSubject } = mismatchFlag;
    renderCard(withoutSubject as DataQualityFlag);

    // Still reachable: the path comes from the flag's own entityType/entityId,
    // so losing the name does not lose the link (design §3.4).
    const link = screen.getByRole("link", { name: "dataQuality:flag.unnamedRecord" });
    expect(link.getAttribute("href")).toBe("/lodging/lodging-1");
    expect(screen.getByText(/Grajska cesta 2/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "dataQuality:flag.actions.dismiss.label" })
    ).toBeInTheDocument();
  });

  it("renders a kind this build does not know", () => {
    // The one payload the discriminated union cannot rule out: a server running
    // a check newer than this bundle. Everything else — a `details` that does
    // not match its `kind` — is refused by the server before it is served, and
    // by the compiler here, which is why this cast has to go through `unknown`.
    renderCard({
      ...mismatchFlag,
      kind: "some_future_check",
    } as unknown as DataQualityFlag);

    expect(screen.getByText("dataQuality:flag.unreadable")).toBeInTheDocument();
    // Still answerable — an unrenderable question must not become a stuck one.
    expect(
      screen.getByRole("button", { name: "dataQuality:flag.actions.dismiss.label" })
    ).toBeInTheDocument();
  });
});
