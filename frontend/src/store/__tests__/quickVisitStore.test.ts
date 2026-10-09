import { afterEach, describe, expect, it } from "vitest";
import { useQuickVisitStore } from "../quickVisitStore";

/** Review M4: a host going away must not close a dialog another host shows. */
describe("quickVisitStore", () => {
  afterEach(() => useQuickVisitStore.setState({ target: null, hosts: 0 }));

  it("keeps an open dialog while another host is still mounted", () => {
    const first = useQuickVisitStore.getState().register();
    const second = useQuickVisitStore.getState().register();
    useQuickVisitStore.getState().open({ id: "p1", name: "Wartburg" });

    second();
    expect(useQuickVisitStore.getState()).toMatchObject({ hosts: 1, target: { id: "p1" } });

    first();
    expect(useQuickVisitStore.getState()).toMatchObject({ hosts: 0, target: null });
  });
});
