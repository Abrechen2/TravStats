import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const linkVisitPhotosToImmich = vi.fn();
vi.mock("../../../lib/api/places", () => ({
  linkVisitPhotosToImmich: () => linkVisitPhotosToImmich(),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}:${JSON.stringify(o)}` : key),
  }),
}));
let poiEnabled = true;
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => poiEnabled }),
}));

import { JobFailedError, JobLostError } from "../../../lib/api/jobs";
import VisitPhotoImmichLink from "../VisitPhotoImmichLink";

const run = async () => userEvent.click(screen.getByRole("button", { name: "visitPhotos.run" }));

describe("VisitPhotoImmichLink (forgejo#397)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poiEnabled = true;
  });

  it("shows nothing without a connection or without the places domain", () => {
    const { container, rerender } = render(<VisitPhotoImmichLink connected={false} />);
    expect(container).toBeEmptyDOMElement();
    poiEnabled = false;
    rerender(<VisitPhotoImmichLink connected />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reports how many photos were checked and linked", async () => {
    linkVisitPhotosToImmich.mockResolvedValue({ checked: 5, linked: 2 });
    render(<VisitPhotoImmichLink connected />);
    await run();
    expect(await screen.findByRole("status")).toHaveTextContent('"linked":2');
  });

  it("names Immich's failure kind when the job fails", async () => {
    linkVisitPhotosToImmich.mockRejectedValue(new JobFailedError("auth", 502));
    render(<VisitPhotoImmichLink connected />);
    await run();
    expect(await screen.findByRole("status")).toHaveTextContent("errors.auth");
  });

  it("says 'unknown' rather than 'failed' when the job was lost", async () => {
    linkVisitPhotosToImmich.mockRejectedValue(new JobLostError());
    render(<VisitPhotoImmichLink connected />);
    await run();
    expect(await screen.findByRole("status")).toHaveTextContent("visitPhotos.lost");
  });

  it("reads a 409 notConfigured refusal from the response body", async () => {
    linkVisitPhotosToImmich.mockRejectedValue({
      response: { status: 409, data: { error: "notConfigured" } },
    });
    render(<VisitPhotoImmichLink connected />);
    await run();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("errors.notConfigured")
    );
  });

  it("gives an unclassified failure its own sentence", async () => {
    linkVisitPhotosToImmich.mockRejectedValue(new Error("boom"));
    render(<VisitPhotoImmichLink connected />);
    await run();
    expect(await screen.findByRole("status")).toHaveTextContent("visitPhotos.failed");
  });
});
