import { act, cleanup, render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";

import { useEvidenceOpenStore } from "../../evidence/evidenceOpenStore";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";

/** Reports the search string after each click — `MemoryRouter` never touches `window.location`. */
function LocationProbe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

export interface OpenedEvidence {
  key: string;
  scope: EvidenceScopeParams | undefined;
}

/**
 * Every evidence trigger in `ui`, clicked once: the key each wrote to
 * `?evidence=` and the scope it handed the panel. `waitFor` lets a section
 * that fetches for itself draw first.
 */
export async function evidenceOpenedBy(
  ui: JSX.Element,
  waitFor?: () => Promise<unknown>
): Promise<{ opened: OpenedEvidence[]; container: HTMLElement }> {
  cleanup();
  let search = "";
  const { container } = render(
    <MemoryRouter>
      {ui}
      <LocationProbe
        onChange={(next) => {
          search = next;
        }}
      />
    </MemoryRouter>
  );
  if (waitFor) await waitFor();
  const opened: OpenedEvidence[] = [];
  const triggers = screen
    .queryAllByRole("button")
    .filter((b) => b.getAttribute("aria-haspopup") === "dialog");
  for (const trigger of triggers) {
    await act(async () => {
      trigger.click();
    });
    const raw = new URLSearchParams(search).get("evidence") ?? "";
    opened.push({
      key: raw.slice(raw.indexOf(":") + 1),
      scope: useEvidenceOpenStore.getState().scope,
    });
  }
  return { opened, container };
}
