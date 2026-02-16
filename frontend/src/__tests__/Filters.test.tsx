import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Filters from '../components/Filters';
import { flightsApi } from '../lib/api';
import { useThemeStore } from '../store/themeStore';
import type { Flight } from '../types';

vi.mock('../lib/api');
vi.mock('../store/themeStore');

const mockUseThemeStore = vi.mocked(useThemeStore);

describe('Filters', () => {
  const mockOnFilterChange = vi.fn();

  const mockFlight: Flight = {
    id: '1',
    userId: 'user-1',
    airline: 'Lufthansa',
    flightNumber: 'LH100',
    depIata: 'FRA',
    depName: 'Frankfurt Airport',
    depLat: 50.0333,
    depLon: 8.5706,
    arrIata: 'MUC',
    arrName: 'Munich Airport',
    arrLat: 48.3538,
    arrLon: 11.7861,
    departureTime: '2024-01-15T10:00:00Z',
    arrivalTime: '2024-01-15T12:00:00Z',
    status: 'flown',
    createdAt: '2024-01-15T08:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseThemeStore.mockImplementation((selector?: unknown) => {
      const state = {
        isDarkMode: false,
        toggleDarkMode: vi.fn(),
        setDarkMode: vi.fn(),
      };
      if (typeof selector === 'function') {
        return (selector as (s: typeof state) => unknown)(state);
      }
      return state;
    });
    vi.mocked(flightsApi.getAll).mockResolvedValue({
      flights: [mockFlight],
      total: 1,
      limit: 500,
      offset: 0,
    });
  });

  it('should render filter button', () => {
    render(<Filters onFilterChange={mockOnFilterChange} />);

    // Button text is i18n key: map:filters.title
    expect(screen.getByText(/map:filters\.title/i)).toBeInTheDocument();
  });

  it('should open filter panel on click', async () => {
    render(<Filters onFilterChange={mockOnFilterChange} />);

    const filterButton = screen.getByText(/map:filters\.title/i);
    fireEvent.click(filterButton);

    await waitFor(() => {
      // The panel opens and shows filter-specific content like allYears
      expect(screen.getByText(/map:filters\.allYears/i)).toBeInTheDocument();
    });
  });

  it('should apply year filter', async () => {
    render(<Filters onFilterChange={mockOnFilterChange} />);

    const filterButton = screen.getByText(/map:filters\.title/i);
    fireEvent.click(filterButton);

    await waitFor(() => {
      // The default option in year select is map:filters.allYears
      const allYearsOption = screen.getByText(/map:filters\.allYears/i);
      const yearSelect = allYearsOption.closest('select');
      if (yearSelect) {
        fireEvent.change(yearSelect, { target: { value: '2024' } });
      }
    });

    await waitFor(() => {
      expect(mockOnFilterChange).toHaveBeenCalled();
    });
  });
});
