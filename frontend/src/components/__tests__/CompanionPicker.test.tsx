import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../lib/api", () => ({ companionsApi: { list: mocks.list } }));

import CompanionPicker from "../CompanionPicker";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([
    { id: "1", name: "Anna", usageCount: 12 },
    { id: "2", name: "Jonas", usageCount: 3 },
  ]);
});

describe("CompanionPicker", () => {
  it("suggests known companions", async () => {
    render(<CompanionPicker value={[]} onChange={() => {}} />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await userEvent.type(screen.getByRole("combobox"), "An");
    expect(await screen.findByText("Anna")).toBeInTheDocument();
  });

  it("still accepts a name that is not in the list", async () => {
    const onChange = vi.fn();
    render(<CompanionPicker value={[]} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "Neue Person{Enter}");
    expect(onChange).toHaveBeenCalledWith(["Neue Person"]);
  });

  it("renders the current value as removable chips", async () => {
    const onChange = vi.fn();
    render(<CompanionPicker value={["Anna"]} onChange={onChange} />);
    // The global react-i18next mock doesn't interpolate `t(key, options)`, so
    // the rendered aria-label can't be queried by translated text here.
    // A per-name test id identifies the correct chip's remove button even
    // when several chips are rendered side by side.
    await userEvent.click(screen.getByTestId("companion-remove-Anna"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("targets the correct chip's remove button when several are rendered", async () => {
    const onChange = vi.fn();
    render(<CompanionPicker value={["Anna", "Jonas"]} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("companion-remove-Jonas"));
    expect(onChange).toHaveBeenCalledWith(["Anna"]);
  });

  // A failed suggestion fetch must not block typing.
  it("stays usable when the suggestion list fails to load", async () => {
    mocks.list.mockRejectedValue(new Error("offline"));
    const onChange = vi.fn();
    render(<CompanionPicker value={[]} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "Anna{Enter}");
    expect(onChange).toHaveBeenCalledWith(["Anna"]);
  });
});
