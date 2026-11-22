import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SelfPersonPicker from "../SelfPersonPicker";

const listPeople = vi.fn();
const setSelf = vi.fn();
vi.mock("../../../lib/api/coverSuggestions", () => ({
  coverSuggestionsApi: {
    listPeople: (...a: unknown[]) => listPeople(...a),
    setSelf: (...a: unknown[]) => setSelf(...a),
  },
}));

describe("SelfPersonPicker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads nothing from the source until the button is pressed", () => {
    render(<SelfPersonPicker provider="immich" name="Immich" />);
    expect(listPeople).not.toHaveBeenCalled();
  });

  it("loads the people, preselects the stored one and saves a new choice per source", async () => {
    listPeople.mockResolvedValue({
      people: [
        { id: "p1", name: "Me" },
        { id: "p2", name: "Other" },
      ],
      selfPersonId: "p1",
    });
    setSelf.mockResolvedValue(undefined);
    render(<SelfPersonPicker provider="photoprism" name="PhotoPrism" />);
    await userEvent.click(screen.getByRole("button", { name: /selfPerson\.load/ }));
    const select = await screen.findByRole("combobox");
    expect(listPeople).toHaveBeenCalledWith("photoprism");
    expect(select).toHaveValue("p1");
    await userEvent.selectOptions(select, "p2");
    await waitFor(() => expect(setSelf).toHaveBeenCalledWith("photoprism", "p2"));
    expect(await screen.findByText("selfPerson.saved")).toBeInTheDocument();
  });

  it("clears the choice with 'not set'", async () => {
    listPeople.mockResolvedValue({ people: [{ id: "p1", name: "Me" }], selfPersonId: "p1" });
    setSelf.mockResolvedValue(undefined);
    render(<SelfPersonPicker provider="immich" name="Immich" />);
    await userEvent.click(screen.getByRole("button", { name: /selfPerson\.load/ }));
    await userEvent.selectOptions(await screen.findByRole("combobox"), "");
    await waitFor(() => expect(setSelf).toHaveBeenCalledWith("immich", null));
  });

  it("names the failure when the source cannot be read instead of showing an empty list", async () => {
    listPeople.mockRejectedValue({ response: { data: { error: "unreachable" } } });
    render(<SelfPersonPicker provider="immich" name="Immich" />);
    await userEvent.click(screen.getByRole("button", { name: /selfPerson\.load/ }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("selfPerson.loadFailed");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("puts the old choice back when saving fails", async () => {
    listPeople.mockResolvedValue({ people: [{ id: "p1", name: "Me" }], selfPersonId: null });
    setSelf.mockRejectedValue(new Error("nope"));
    render(<SelfPersonPicker provider="immich" name="Immich" />);
    await userEvent.click(screen.getByRole("button", { name: /selfPerson\.load/ }));
    const select = await screen.findByRole("combobox");
    await userEvent.selectOptions(select, "p1");
    expect(await screen.findByText("selfPerson.saveFailed")).toBeInTheDocument();
    expect(select).toHaveValue("");
  });
});
