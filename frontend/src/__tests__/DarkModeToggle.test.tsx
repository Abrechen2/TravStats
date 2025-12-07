import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DarkModeToggle from '../components/DarkModeToggle';
import { useThemeStore } from '../store/themeStore';

// Mock the theme store
vi.mock('../store/themeStore', () => ({
  useThemeStore: vi.fn(),
}));

describe('DarkModeToggle', () => {
  const mockToggleDarkMode = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render sun icon when dark mode is active', () => {
    (useThemeStore as any).mockReturnValue({
      isDarkMode: true,
      toggleDarkMode: mockToggleDarkMode,
    });

    render(<DarkModeToggle />);

    const button = screen.getByRole('button', { name: /toggle dark mode/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Light Mode aktivieren');
  });

  it('should render moon icon when dark mode is inactive', () => {
    (useThemeStore as any).mockReturnValue({
      isDarkMode: false,
      toggleDarkMode: mockToggleDarkMode,
    });

    render(<DarkModeToggle />);

    const button = screen.getByRole('button', { name: /toggle dark mode/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Dark Mode aktivieren');
  });

  it('should call toggleDarkMode when clicked', () => {
    (useThemeStore as any).mockReturnValue({
      isDarkMode: false,
      toggleDarkMode: mockToggleDarkMode,
    });

    render(<DarkModeToggle />);

    const button = screen.getByRole('button', { name: /toggle dark mode/i });
    fireEvent.click(button);

    expect(mockToggleDarkMode).toHaveBeenCalledTimes(1);
  });
});


