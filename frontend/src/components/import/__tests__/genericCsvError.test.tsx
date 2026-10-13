import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { GenericCsvImportTile } from "../GenericCsvImportTile";

const preview = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/import", () => ({ postImportPreview: preview }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

const CSV =
  "date,from,to,depTimeLocal,arrTimeLocal,flight\n2025-07-10,MUC,CDG,10:00,12:00:00,QA1020";
async function upload(container: HTMLElement, text: string) {
  const file = new File([text], "flights.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  return within(await screen.findByRole("dialog"));
}

beforeEach(() => preview.mockReset());
describe("generic CSV rejection (forgejo#296)", () => {
  it("shows the row error in the wizard, blocks repeated failure and allows replacement", async () => {
    const { container } = render(<GenericCsvImportTile />);
    const wizard = await upload(container, CSV);
    fireEvent.click(
      wizard.getByRole("button", { name: "settings:import.preview.wizard.continue" })
    );
    expect(await wizard.findByTestId("wizard-submit-error")).toHaveTextContent(
      "settings:import.parserErrors.invalidTime"
    );
    expect(wizard.getByTestId("wizard-submit-error")).toHaveTextContent('"line":2');
    expect(
      wizard.getByRole("button", { name: "settings:import.preview.wizard.continue" })
    ).toBeDisabled();
    expect(preview).not.toHaveBeenCalled();
    fireEvent.click(wizard.getByRole("button", { name: "common:buttons.close" }));
    preview.mockResolvedValue({
      rows: [],
      summary: { ok: 1, problems: 0, duplicates: 0, unresolvable: 0 },
    });
    const next = await upload(
      container,
      "\uFEFF" + CSV.replace(/,/g, ";").replace("10:00;", "10:00:00;")
    );
    fireEvent.click(next.getByRole("button", { name: "settings:import.preview.wizard.continue" }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(preview.mock.calls[0][0]).toHaveLength(1);
  });
});
