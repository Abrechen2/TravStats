import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SimplifiedFlightFormV2 from '../components/SimplifiedFlightFormV2';
import { airportsApi } from '../lib/api';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';

vi.mock('../lib/api');
vi.mock('../store/settingsStore');
vi.mock('../store/themeStore');

describe('SimplifiedFlightFormV2', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useThemeStore as any).mockReturnValue({
      isDarkMode: false,
    });
    (useSettingsStore as any).mockReturnValue({
      units: { currency: 'EUR' },
      defaults: {
        flightCategory: 'business',
        seatClass: 'economy',
      },
    });
  });

  it('should render flight form', () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    expect(screen.getByText(/add flight/i)).toBeInTheDocument();
  });

  it('should show error when airports are missing', async () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Navigate to complete step
    const skipButton = screen.getByText(/skip and enter manually/i);
    fireEvent.click(skipButton);

    await waitFor(() => {
      const submitButton = screen.getByRole('button', { name: /flug speichern/i });
      expect(submitButton).toBeDisabled();
    });
  });

  it('should validate required fields', async () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const skipButton = screen.getByText(/skip and enter manually/i);
    fireEvent.click(skipButton);

    await waitFor(() => {
      const submitButton = screen.getByRole('button', { name: /flug speichern/i });
      expect(submitButton).toBeInTheDocument();
      // Button should be disabled when airports are missing
      expect(submitButton).toBeDisabled();
    });
  });
});

