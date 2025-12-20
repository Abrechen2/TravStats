import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Filters from '../components/Filters';
import { flightsApi } from '../lib/api';
import { useThemeStore } from '../store/themeStore';

vi.mock('../lib/api');
vi.mock('../store/themeStore');

describe('Filters', () => {
  const mockOnFilterChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useThemeStore as any).mockReturnValue({
      isDarkMode: false,
    });
    (flightsApi.getAll as any).mockResolvedValue({
      flights: [
        {
          id: '1',
          airline: 'Lufthansa',
          departureTime: '2024-01-15T10:00:00Z',
          status: 'flown',
        },
      ],
    });
  });

  it('should render filter button', () => {
    render(<Filters onFilterChange={mockOnFilterChange} />);

    expect(screen.getByText(/filter/i)).toBeInTheDocument();
  });

  it('should open filter panel on click', async () => {
    render(<Filters onFilterChange={mockOnFilterChange} />);

    const filterButton = screen.getByText(/filter/i);
    fireEvent.click(filterButton);

    await waitFor(() => {
      expect(screen.getByText(/filter optionen/i)).toBeInTheDocument();
    });
  });

  it('should apply year filter', async () => {
    render(<Filters onFilterChange={mockOnFilterChange} />);

    const filterButton = screen.getByText(/filter/i);
    fireEvent.click(filterButton);

    await waitFor(() => {
      const yearSelect = screen.getByText(/alle jahre/i).closest('select');
      if (yearSelect) {
        fireEvent.change(yearSelect, { target: { value: '2024' } });
      }
    });

    await waitFor(() => {
      expect(mockOnFilterChange).toHaveBeenCalled();
    });
  });
});








