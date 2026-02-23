import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DarkModeToggle from "../components/DarkModeToggle";
import { useThemeStore } from "../store/themeStore";

// Mock the theme store
vi.mock("../store/themeStore", () => ({
  useThemeStore: vi.fn(),
}));

const mockUseThemeStore = vi.mocked(useThemeStore);

describe("DarkModeToggle", () => {
  const mockToggleDarkMode = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render sun icon when dark mode is active", () => {
    mockUseThemeStore.mockReturnValue({
      isDarkMode: true,
      toggleDarkMode: mockToggleDarkMode,
      setDarkMode: vi.fn(),
    });

    render(<DarkModeToggle />);

    const button = screen.getByRole("button", { name: /theme\.toggle/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("title", "theme.enableLight");
  });

  it("should render moon icon when dark mode is inactive", () => {
    mockUseThemeStore.mockReturnValue({
      isDarkMode: false,
      toggleDarkMode: mockToggleDarkMode,
      setDarkMode: vi.fn(),
    });

    render(<DarkModeToggle />);

    const button = screen.getByRole("button", { name: /theme\.toggle/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("title", "theme.enableDark");
  });

  it("should call toggleDarkMode when clicked", () => {
    mockUseThemeStore.mockReturnValue({
      isDarkMode: false,
      toggleDarkMode: mockToggleDarkMode,
      setDarkMode: vi.fn(),
    });

    render(<DarkModeToggle />);

    const button = screen.getByRole("button", { name: /theme\.toggle/i });
    fireEvent.click(button);

    expect(mockToggleDarkMode).toHaveBeenCalledTimes(1);
  });
});
