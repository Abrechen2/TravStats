import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useDomainTabs } from "../../hooks/useDomainTabs";
import { useSettingsStore } from "../../store/settingsStore";
import { useToastStore } from "../../store/toastStore";
import type { DomainKey } from "../../shared/domains";

// The global setup mocks useSettingsStore — we need the real Zustand store
// so `.setState` actually updates the enabledDomains selector the hook
// depends on.
vi.unmock("../../store/settingsStore");

type TabId = "general" | "flight" | "cruise";

const TABS = [
  { id: "general" as const, label: "Allgemein" },
  { id: "flight" as const, label: "Flug", requiresDomain: "flight" as DomainKey },
  { id: "cruise" as const, label: "Kreuzfahrt", requiresDomain: "cruise" as DomainKey },
];

interface WrapperProps {
  children: ReactNode;
  initialEntry?: string;
  onLocation?: (location: { search: string }) => void;
}

function RouterWrapper({ children, initialEntry = "/", onLocation }: WrapperProps): JSX.Element {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <LocationProbe onLocation={onLocation} />
              {children}
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function LocationProbe({
  onLocation,
}: {
  onLocation?: (location: { search: string }) => void;
}): null {
  const location = useLocation();
  if (onLocation) onLocation({ search: location.search });
  return null;
}

describe("useDomainTabs", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
    useToastStore.setState({ toasts: [] });
  });

  it("filters tabs by enabledDomains", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    const { result } = renderHook(
      () => useDomainTabs<TabId>({ tabConfig: TABS, defaultTab: "general" }),
      { wrapper: ({ children }) => <RouterWrapper>{children}</RouterWrapper> }
    );
    expect(result.current.tabs.map((t) => t.id)).toEqual(["general", "flight"]);
  });

  it("always shows tabs without requiresDomain", () => {
    useSettingsStore.setState({ enabledDomains: [] });
    const { result } = renderHook(
      () => useDomainTabs<TabId>({ tabConfig: TABS, defaultTab: "general" }),
      { wrapper: ({ children }) => <RouterWrapper>{children}</RouterWrapper> }
    );
    expect(result.current.tabs.map((t) => t.id)).toEqual(["general"]);
  });

  it("reads the initial tab from the URL param", () => {
    const { result } = renderHook(
      () => useDomainTabs<TabId>({ tabConfig: TABS, defaultTab: "general" }),
      {
        wrapper: ({ children }) => (
          <RouterWrapper initialEntry="/?tab=cruise">{children}</RouterWrapper>
        ),
      }
    );
    expect(result.current.activeTab).toBe("cruise");
  });

  it("falls back to default when the URL param points to a disabled tab", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    const { result } = renderHook(
      () => useDomainTabs<TabId>({ tabConfig: TABS, defaultTab: "general" }),
      {
        wrapper: ({ children }) => (
          <RouterWrapper initialEntry="/?tab=cruise">{children}</RouterWrapper>
        ),
      }
    );
    expect(result.current.activeTab).toBe("general");
  });

  it("falls back silently for bogus ?tab values — no toast", () => {
    const { result } = renderHook(
      () => useDomainTabs<TabId>({ tabConfig: TABS, defaultTab: "general" }),
      {
        wrapper: ({ children }) => (
          <RouterWrapper initialEntry="/?tab=nonsense">{children}</RouterWrapper>
        ),
      }
    );
    expect(result.current.activeTab).toBe("general");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("drift guard bounces active tab when its domain gets disabled", () => {
    const { result } = renderHook(
      () => useDomainTabs<TabId>({ tabConfig: TABS, defaultTab: "general" }),
      {
        wrapper: ({ children }) => (
          <RouterWrapper initialEntry="/?tab=cruise">{children}</RouterWrapper>
        ),
      }
    );
    expect(result.current.activeTab).toBe("cruise");
    act(() => {
      useSettingsStore.setState({ enabledDomains: ["flight"] });
    });
    expect(result.current.activeTab).toBe("general");
  });

  it("drift emits a user-visible toast", () => {
    renderHook(() => useDomainTabs<TabId>({ tabConfig: TABS, defaultTab: "general" }), {
      wrapper: ({ children }) => (
        <RouterWrapper initialEntry="/?tab=cruise">{children}</RouterWrapper>
      ),
    });
    act(() => {
      useSettingsStore.setState({ enabledDomains: ["flight"] });
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("info");
    // The setup mocks useTranslation to return the key verbatim, so the
    // toast message is the i18n key, not the resolved string. Good enough
    // to prove the right toast fired.
    expect(toasts[0].message).toContain("domainTabs.driftFallback");
  });

  it("onDrift callback overrides the toast side effect", () => {
    const onDrift = vi.fn();
    renderHook(() => useDomainTabs<TabId>({ tabConfig: TABS, defaultTab: "general", onDrift }), {
      wrapper: ({ children }) => (
        <RouterWrapper initialEntry="/?tab=cruise">{children}</RouterWrapper>
      ),
    });
    act(() => {
      useSettingsStore.setState({ enabledDomains: ["flight"] });
    });
    expect(onDrift).toHaveBeenCalledWith("cruise", "general");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  // URL writes moved out of the hook — consumers bundle `?tab=` with
  // their own params in a single setSearchParams call to dodge the
  // react-router race where parallel functional setters clobber each
  // other. So we only verify the hook's state transitions here.
  it("setActiveTab updates activeTab synchronously", () => {
    const { result } = renderHook(
      () => useDomainTabs<TabId>({ tabConfig: TABS, defaultTab: "general" }),
      { wrapper: ({ children }) => <RouterWrapper>{children}</RouterWrapper> }
    );
    expect(result.current.activeTab).toBe("general");
    act(() => {
      result.current.setActiveTab("cruise");
    });
    expect(result.current.activeTab).toBe("cruise");
  });

  it("honours a custom paramName", () => {
    const { result } = renderHook(
      () =>
        useDomainTabs<TabId>({
          tabConfig: TABS,
          defaultTab: "general",
          paramName: "view",
        }),
      {
        wrapper: ({ children }) => (
          <RouterWrapper initialEntry="/?view=flight">{children}</RouterWrapper>
        ),
      }
    );
    expect(result.current.activeTab).toBe("flight");
  });
});
