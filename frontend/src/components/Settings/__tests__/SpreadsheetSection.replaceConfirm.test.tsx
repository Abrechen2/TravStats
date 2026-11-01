import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * R21: "Ersetzen" deletes what the file does not mention, on every sheet the
 * file holds rows for. It goes through the confirmation block: the button
 * names the amount, the typed word keeps it off, and nothing is sent before.
 */
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanT, germanUseTranslation } = await import("../../../__tests__/helpers/germanT");
  return {
    useTranslation: () => {
      const base = germanUseTranslation();
      return { ...base, i18n: { ...base.i18n, getFixedT: () => germanT } };
    },
  };
});
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

const sheets = (deleted: number) => [
  { key: "flights", created: 100, updated: 200, skipped: 0, errors: 0, deleted, rows: [] },
  { key: "lodgingStays", created: 40, updated: 200, skipped: 0, errors: 0, deleted: 0, rows: [] },
];
const importClient = vi.hoisted(() => ({ sendImport: vi.fn() }));
vi.mock("../../../lib/xlsx/importClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/xlsx/importClient")>();
  return {
    ...actual,
    readWorkbookForImport: vi
      .fn()
      .mockResolvedValue([{ key: "flights", rows: [{}], rowNumbers: [3] }]),
    sendImport: importClient.sendImport,
  };
});

import SpreadsheetSection from "../SpreadsheetSection";

async function previewReplace(): Promise<void> {
  render(<SpreadsheetSection part="import" />);
  await userEvent.click(screen.getByRole("radio", { name: /Ersetzen/ }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "reise-export.xlsx")] } });
  await screen.findByRole("button", { name: "Übernehmen" });
}

describe("Excel import, mode Ersetzen", () => {
  beforeEach(() => {
    importClient.sendImport.mockReset();
    importClient.sendImport.mockImplementation(async (_s: unknown, dryRun: boolean) => ({
      dryRun,
      mode: "replace",
      clean: true,
      backupId: dryRun ? null : "b1",
      sheets: sheets(312),
    }));
  });

  it("asks first, names the amount on the button and sends nothing until the word is typed", async () => {
    await previewReplace();
    expect(importClient.sendImport).toHaveBeenCalledTimes(1); // the preview only
    await userEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("312 Einträge fehlen in der Datei und werden gelöscht");
    expect(dialog).toHaveTextContent("reise-export.xlsx");
    const confirm = within(dialog).getByRole("button", { name: "312 Einträge ersetzen" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), "ersetzen");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(importClient.sendImport).toHaveBeenCalledTimes(2));
    expect(importClient.sendImport.mock.calls[1][1]).toBe(false);
    expect(importClient.sendImport.mock.calls[1][2]).toBe("replace");
  });

  it("cancelling the question writes nothing", async () => {
    await previewReplace();
    await userEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Abbrechen" })
    );
    expect(importClient.sendImport).toHaveBeenCalledTimes(1);
  });

  it("a replace that deletes nothing needs no question", async () => {
    importClient.sendImport.mockResolvedValue({
      dryRun: true,
      mode: "replace",
      clean: true,
      backupId: null,
      sheets: sheets(0),
    });
    await previewReplace();
    await userEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(importClient.sendImport).toHaveBeenCalledTimes(2));
  });
});
