import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { noteFixture } from "../../components/notes/__tests__/noteFixture";
import { setClockForTests } from "../../shared/time";
import type { Note } from "../../lib/api/notes";

vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../hooks/useTodayZone", () => ({ useTodayZone: () => "Europe/Berlin" }));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  setPhoto: vi.fn(),
  removePhoto: vi.fn(),
}));
vi.mock("../../lib/api/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/notes")>()),
  notesApi: api,
}));

import NotesPage from "../NotesPage";

const renderPage = (): void => {
  render(
    <MemoryRouter>
      <NotesPage />
    </MemoryRouter>
  );
};

/** An axios-shaped refusal. */
const refused = (status: number, data: Record<string, unknown>): Error =>
  Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });

const page = (notes: Note[]) => ({ notes, total: notes.length });

describe("NotesPage", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    setClockForTests(new Date("2026-09-27T22:30:00Z"));
  });
  afterEach(() => setClockForTests(null));

  it("names the next step when there are no notes", async () => {
    api.list.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText("Noch keine Notizen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Erste Notiz schreiben" })).toBeTruthy();
  });

  it("says that the list failed to load instead of showing it empty", async () => {
    api.list.mockRejectedValue(refused(500, { error: "boom" }));
    renderPage();
    expect(await screen.findByText("Die Notizen konnten nicht geladen werden.")).toBeTruthy();
    expect(screen.queryByText("Noch keine Notizen")).toBeNull();
  });

  it("files each note under the day it was written on, with its own clock", async () => {
    api.list.mockResolvedValue(
      page([
        noteFixture(),
        noteFixture({
          id: "n2",
          body: "Ein Tag in Tokio",
          occurredZone: "Asia/Tokyo",
          occurredAt: "2026-09-20T01:00:00.000Z",
          times: {
            occurredAt: {
              ...noteFixture().times.occurredAt,
              local: "2026-09-20T10:00:00",
              zone: "Asia/Tokyo",
            },
            day: { date: "2026-09-20", zone: "Asia/Tokyo", precision: "day" },
          },
        }),
      ])
    );
    renderPage();
    expect(await screen.findByText("Montag, 28. September 2026")).toBeTruthy();
    expect(screen.getByText("Sonntag, 20. September 2026")).toBeTruthy();
    expect(screen.getByText("00:30")).toBeTruthy();
    // Only the note written elsewhere says where.
    expect(screen.getByText("Geschrieben in Asia/Tokyo")).toBeTruthy();
    expect(screen.queryByText("Geschrieben in Europe/Berlin")).toBeNull();
    expect(screen.getByText("2 Notizen")).toBeTruthy();
  });

  it("writes a note on the clock of the zone shown, and adds it to the list", async () => {
    api.list.mockResolvedValue(page([]));
    api.create.mockImplementation(async () => noteFixture({ id: "new", body: "Abendrot" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Neue Notiz" }));

    fireEvent.change(screen.getByLabelText("Notiz"), { target: { value: "  Abendrot " } });
    expect((screen.getByLabelText("Datum") as HTMLInputElement).value).toBe("2026-09-28");
    expect((screen.getByLabelText("Uhrzeit") as HTMLInputElement).value).toBe("00:30");
    fireEvent.click(screen.getByRole("button", { name: "Notiz speichern" }));

    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0]).toEqual({
      body: "Abendrot",
      moment: { local: "2026-09-28T00:30", zone: "Europe/Berlin" },
      placeName: null,
    });
    expect(await screen.findByText("Abendrot")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses an empty note in the form, before any request", async () => {
    api.list.mockResolvedValue(page([]));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Neue Notiz" }));
    fireEvent.click(screen.getByRole("button", { name: "Notiz speichern" }));
    expect(await screen.findByText("Bitte schreib etwas in die Notiz.")).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("says why the server refused a note, in German", async () => {
    api.list.mockResolvedValue(page([]));
    api.create.mockRejectedValue(refused(422, { error: "x", code: "TZ_UNRESOLVED" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Neue Notiz" }));
    fireEvent.change(screen.getByLabelText("Notiz"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Notiz speichern" }));
    expect(
      await screen.findByText(/Ohne Zeitzone lässt sich nicht sagen, zu welchem Tag/)
    ).toBeTruthy();
  });

  it("keeps the dialog open on the saved note when only the photo failed, and says so", async () => {
    api.list.mockResolvedValue(page([]));
    const saved = noteFixture({ id: "saved", body: "Mit Foto" });
    api.create.mockResolvedValue(saved);
    api.setPhoto.mockRejectedValue(refused(413, { error: "too large" }));
    api.update.mockResolvedValue(saved);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Neue Notiz" }));
    fireEvent.change(screen.getByLabelText("Notiz"), { target: { value: "Mit Foto" } });
    const file = new File([new Uint8Array(10)], "sunset.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Notiz speichern" }));

    expect(await screen.findByText(/Die Notiz ist gespeichert, das Foto nicht/)).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    // Now editing the saved note: a second press edits, it does not write a copy.
    expect(within(dialog).getByText("Notiz bearbeiten")).toBeTruthy();
    expect(api.create).toHaveBeenCalledTimes(1);
    // The note is in the list behind the dialog all the same.
    expect(screen.getAllByText("Mit Foto").length).toBeGreaterThan(0);
  });

  it("refuses a file that is not an image before uploading anything", async () => {
    api.list.mockResolvedValue(page([]));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Neue Notiz" }));
    const pdf = new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(await screen.findByText(/Nur Bilder .* können an eine Notiz\.$/)).toBeTruthy();
  });

  it("deletes a note only after the question, and keeps it when the delete fails", async () => {
    api.list.mockResolvedValue(page([noteFixture()]));
    api.remove.mockRejectedValueOnce(refused(503, { error: "x", code: "DB_UNAVAILABLE" }));
    api.remove.mockResolvedValueOnce(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Notiz löschen" }));
    expect(api.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(await screen.findByText(/Die Datenbank ist gerade nicht erreichbar/)).toBeTruthy();
    expect(screen.getByText("Erster Schnee auf dem Wendelstein.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    await waitFor(() =>
      expect(screen.queryByText("Erster Schnee auf dem Wendelstein.")).toBeNull()
    );
    expect(api.remove).toHaveBeenCalledWith("n1");
  });

  it("reaches every note past the first page, keeps a day split by the page one day, and says when it is the end", async () => {
    // 150 notes, one per hour, newest first: 2026-09-10 00:00 UTC backwards.
    const all = Array.from({ length: 150 }, (_, i) => {
      const utc = new Date(Date.UTC(2026, 8, 10) - i * 3_600_000).toISOString();
      return noteFixture({
        id: `n${String(i).padStart(3, "0")}`,
        body: `Notiz ${i}`,
        occurredAt: utc,
        occurredZone: "UTC",
        times: {
          occurredAt: {
            ...noteFixture().times.occurredAt,
            utc,
            zone: "UTC",
            offset: "+00:00",
            local: utc.slice(0, 19),
          },
          day: { date: utc.slice(0, 10), zone: "UTC", precision: "day" },
        },
      });
    });
    api.list.mockImplementation(async (offset = 0) => ({
      notes: all.slice(offset, offset + 100),
      total: all.length,
    }));
    renderPage();
    expect(await screen.findByText("100 von 150 Notizen")).toBeTruthy();
    expect(screen.queryByText("Notiz 120")).toBeNull();
    // Note 99 and note 100 sit on the same day (2026-09-05) across the boundary.
    expect(screen.getAllByText("Samstag, 5. September 2026")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Ältere laden" }));
    expect(await screen.findByText("Das ist alles – alle 150 Notizen sind geladen.")).toBeTruthy();
    expect(api.list).toHaveBeenLastCalledWith(100);
    expect(screen.getByText("Notiz 149")).toBeTruthy();
    expect(screen.getAllByTestId("note-card")).toHaveLength(150);
    expect(screen.getAllByText("Samstag, 5. September 2026")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Ältere laden" })).toBeNull();
  }, 60_000);

  it("says when older notes failed to load, and keeps what is shown", async () => {
    api.list
      .mockResolvedValueOnce({ notes: [noteFixture()], total: 2 })
      .mockRejectedValueOnce(refused(503, { error: "x", code: "DB_UNAVAILABLE" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Ältere laden" }));
    expect(await screen.findByText(/Die Datenbank ist gerade nicht erreichbar/)).toBeTruthy();
    expect(screen.getByText("Erster Schnee auf dem Wendelstein.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ältere laden" })).toBeTruthy();
  });
});
