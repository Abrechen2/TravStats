import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import WorkshopJumpLink, { workshopDocumentOf } from "./WorkshopJumpLink";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Landing(): JSX.Element {
  const state = useLocation().state;
  return <p data-testid="landed">{workshopDocumentOf(state)?.name ?? "nothing"}</p>;
}

const renderLink = (props: Parameters<typeof WorkshopJumpLink>[0]): void => {
  render(
    <MemoryRouter initialEntries={["/somewhere"]}>
      <Routes>
        <Route path="/somewhere" element={<WorkshopJumpLink {...props} />} />
        <Route path="/parser" element={<Landing />} />
      </Routes>
    </MemoryRouter>
  );
};

describe("WorkshopJumpLink (forgejo#330)", () => {
  it("jumps to /parser carrying the document itself", () => {
    renderLink({ file: new File(["x"], "ticket.eml", { type: "message/rfc822" }) });
    fireEvent.click(screen.getByRole("button", { name: "parser:handoff.link" }));
    expect(screen.getByTestId("landed")).toHaveTextContent("ticket.eml");
  });

  it("turns pasted text into a text file", () => {
    renderLink({ text: "Fahrschein Probestadt" });
    fireEvent.click(screen.getByRole("button", { name: "parser:handoff.link" }));
    expect(screen.getByTestId("landed")).toHaveTextContent("parser:handoff.textName");
  });

  it("offers nothing without a document, and nothing for a PDF the workshop cannot read", () => {
    renderLink({ text: "   " });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers nothing for a PDF", () => {
    renderLink({ file: new File(["%PDF"], "ticket.pdf", { type: "application/pdf" }) });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads no document out of a location without one", () => {
    expect(workshopDocumentOf(null)).toBeNull();
    expect(workshopDocumentOf({ workshopDocument: "not a file" })).toBeNull();
  });
});
