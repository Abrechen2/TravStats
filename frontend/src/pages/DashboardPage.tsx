import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { flightsApi, analyticsApi, settingsApi } from '../lib/api';
import { useToastStore } from '../store/toastStore';
import { logger } from '../lib/logger';
import MapContainer3D from '../components/MapContainer3D';
import SimplifiedFlightFormV2 from '../components/SimplifiedFlightFormV2';
import FlightEditModal from '../components/FlightEditModal';
import Stats from '../components/Stats';
import Filters from '../components/Filters';
import ErrorBoundary from '../components/ErrorBoundary';
import DarkModeToggle from '../components/DarkModeToggle';
import AchievementPopup from '../components/AchievementPopup';
import OnboardingGuide from '../components/Onboarding/OnboardingGuide';
import HelpIcon from '../components/Help/HelpIcon';
import { useClickOutside } from '../hooks/useClickOutside';
import type { Flight, FlightInput, FlightFilters, GeoJSONFeature, OnboardingState } from '../types';
import { useSettingsStore } from '../store/settingsStore';
import { API_LIMITS, UI_CONFIG, STORAGE_KEYS } from '../lib/constants';
import { toCsv, escapeXml, downloadBlob } from '../lib/export';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function DashboardPage() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [flights, setFlights] = useState<Flight[]>([]); // Filtered flights for map
  const [recentFlights, setRecentFlights] = useState<Flight[]>([]); // Unfiltered recent flights for sidebar
  const [totalFlightsCount, setTotalFlightsCount] = useState(0); // Total number of all flights
  const [geoFlights, setGeoFlights] = useState<GeoJSONFeature[]>([]);
  const [selectedFlightId, setSelectedFlightId] = useState<string>();
  const [showFlightForm, setShowFlightForm] = useState(false);
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [filters, setFilters] = useState<FlightFilters>({});
  const [loadingMap, setLoadingMap] = useState(true); // Loading indicator for map
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [is3DView, setIs3DView] = useState(true);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingState>({
    flightAdded: false,
    usedFilter: false,
    exported: false,
    mapExplored: false,
    statsViewed: false,
    achievementsViewed: false,
    dismissed: false,
  });

  // Load onboarding state from server (with localStorage fallback)
  useEffect(() => {
    const loadOnboardingState = async () => {
      try {
        const serverState = await settingsApi.getOnboardingState();
        setOnboarding(serverState);
        // Also sync to localStorage for offline access
        localStorage.setItem(STORAGE_KEYS.ONBOARDING_CHECKLIST, JSON.stringify(serverState));
      } catch (error) {
        // Fallback to localStorage if server request fails
        logger.warn('Failed to load onboarding state from server, using localStorage:', error);
        const saved = localStorage.getItem(STORAGE_KEYS.ONBOARDING_CHECKLIST);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setOnboarding({
              flightAdded: parsed.flightAdded || false,
              usedFilter: parsed.usedFilter || false,
              exported: parsed.exported || false,
              mapExplored: parsed.mapExplored || false,
              statsViewed: parsed.statsViewed || false,
              achievementsViewed: parsed.achievementsViewed || false,
              dismissed: parsed.dismissed || false,
            });
          } catch (e) {
            logger.error('Failed to parse localStorage onboarding state:', e);
          }
        }
      } finally {
        setLoadingOnboarding(false);
      }
    };
    loadOnboardingState();
  }, []);
  const settings = useSettingsStore();
  const addToast = useToastStore((state) => state.addToast);
  const [newAchievements, setNewAchievements] = useState<any[]>([]);
  const [loadingOnboarding, setLoadingOnboarding] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const [_importing, setImporting] = useState(false);

  // Close export menu when clicking outside
  useClickOutside(exportMenuRef, () => {
    if (showExportMenu) {
      setShowExportMenu(false);
    }
  });

  // Load recent flights and total count (unfiltered) once on mount
  const loadRecentFlights = async () => {
    try {
      setLoadingRecent(true);
      const data = await flightsApi.getAll({ limit: API_LIMITS.RECENT_FLIGHTS, offset: 0 });
      setRecentFlights(data.flights);
      setTotalFlightsCount(data.total); // Store total count
    } catch (error) {
      logger.error('Failed to load recent flights:', error);
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    loadRecentFlights();
  }, []);

  useEffect(() => {
    loadFlights();
  }, [filters]);

  // Auto-detect onboarding steps
  useEffect(() => {
    // Check if flights have been added
    if (totalFlightsCount > 0 && !onboarding.flightAdded) {
      setOnboarding((prev) => ({ ...prev, flightAdded: true }));
    }

    // Check if filters are being used
    const hasActiveFilters = Object.keys(filters).length > 0 && (
      (Array.isArray(filters.airline) ? filters.airline.length > 0 : !!filters.airline) ||
      !!filters.departureAirport ||
      !!filters.arrivalAirport ||
      (filters.tags && filters.tags.length > 0) ||
      !!filters.fromDate ||
      !!filters.toDate ||
      !!filters.category
    );
    if (hasActiveFilters && !onboarding.usedFilter) {
      setOnboarding((prev) => ({ ...prev, usedFilter: true }));
    }
  }, [totalFlightsCount, filters, onboarding.flightAdded, onboarding.usedFilter]);

  // Detect map exploration (2D/3D toggle or map interaction)
  const handleMapToggle = () => {
    setIs3DView((prev) => {
      const newValue = !prev;
      if (!onboarding.mapExplored) {
        setOnboarding((prevOnboarding) => ({ ...prevOnboarding, mapExplored: true }));
      }
      return newValue;
    });
  };

  // Save onboarding state to server and localStorage whenever it changes
  useEffect(() => {
    if (!loadingOnboarding) {
      // Save to localStorage immediately for fast access
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_CHECKLIST, JSON.stringify(onboarding));
      
      // Save to server (async, don't block UI)
      settingsApi.updateOnboardingState(onboarding).catch((error) => {
        logger.warn('Failed to save onboarding state to server:', error);
        // Continue with localStorage only if server fails
      });
    }
  }, [onboarding, loadingOnboarding]);

  useEffect(() => {
    // Only open sidebars by default on XL screens
    if (typeof window !== 'undefined' && window.innerWidth >= UI_CONFIG.XL_BREAKPOINT) {
      setLeftOpen(true);
      setRightOpen(true);
    }
  }, []);

  useEffect(() => {
    // Check if user has training access (admin or canTrainLLM)
    const hasTrainingAccess = user?.isAdmin || (user as any)?.canTrainLLM || false;
    
    if (hasTrainingAccess) {
      settingsApi
        .getDeveloperMode()
        .then((data) => {
          setDeveloperModeEnabled(data.enabled);
        })
        .catch((error) => {
          logger.error('Failed to load developer mode status:', error);
        });
    }
  }, [user]);

  const loadFlights = async () => {
    try {
      setLoadingMap(true);
      const { minRouteCount, ...apiFilters } = filters as any;

      // Load all flights by pagination
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = API_LIMITS.MAX_PAGE_SIZE;

      while (true) {
        const data = await flightsApi.getAll({ ...apiFilters, limit, offset });
        allFlights = [...allFlights, ...data.flights];

        // If we received fewer flights than the limit, we've reached the end
        if (data.flights.length < limit) {
          break;
        }

        offset += limit;
      }

      // Load all GeoJSON features by pagination
      let allGeoFeatures: GeoJSONFeature[] = [];
      offset = 0;

      while (true) {
        const geoData = await flightsApi.getGeoJSON({ ...apiFilters, limit, offset });
        allGeoFeatures = [...allGeoFeatures, ...geoData.features];

        // If we received fewer features than the limit, we've reached the end
        if (geoData.features.length < limit) {
          break;
        }

        offset += limit;
      }

      setFlights(allFlights);
      setGeoFlights(allGeoFeatures);
    } catch (error) {
      logger.error('Failed to load flights:', error);
    } finally {
      setLoadingMap(false);
    }
  };

  const handleAddFlight = async (flight: FlightInput) => {
    try {
      const result: any = await flightsApi.create(flight);
      setShowFlightForm(false);
      loadFlights();

      // Reload recent flights and total count for sidebar
      const recentData = await flightsApi.getAll({ limit: API_LIMITS.RECENT_FLIGHTS, offset: 0 });
      setRecentFlights(recentData.flights);
      setTotalFlightsCount(recentData.total);

      setOnboarding((prev: any) => ({ ...prev, flightAdded: true }));

      // Show achievement popup if new achievements were unlocked
      if (result.newAchievements && result.newAchievements.length > 0) {
        setNewAchievements(result.newAchievements);
      }

      if (settings.privacy.analyticsOptIn) {
        analyticsApi.track('flight_created', { method: 'simplified_form' });
      }
    } catch (error) {
      logger.error('Failed to add flight:', error);
      alert('Fehler beim Hinzufügen des Fluges. Bitte versuchen Sie es erneut.');
      throw error;
    }
  };


  const handleEditFlight = (flight: Flight) => {
    setEditingFlight(flight);
  };

  const handleUpdateFlight = async (id: string, updates: Partial<Flight>) => {
    try {
      const result: any = await flightsApi.update(id, updates);
      setEditingFlight(null);
      loadFlights();

      // Reload recent flights and total count for sidebar
      const recentData = await flightsApi.getAll({ limit: API_LIMITS.RECENT_FLIGHTS, offset: 0 });
      setRecentFlights(recentData.flights);
      setTotalFlightsCount(recentData.total);

      // Show achievement popup if new achievements were unlocked
      if (result.newAchievements && result.newAchievements.length > 0) {
        setNewAchievements(result.newAchievements);
      }

      if (settings.privacy.analyticsOptIn) {
        analyticsApi.track('flight_updated', { flightId: id });
      }
    } catch (error) {
      logger.error('Failed to update flight:', error);
      alert('Fehler beim Aktualisieren des Fluges. Bitte versuchen Sie es erneut.');
      throw error;
    }
  };

  const handleFilterChange = (newFilters: FlightFilters) => {
    setFilters(newFilters);
    setOnboarding((prev) => ({ ...prev, usedFilter: true }));
    if (settings.privacy.analyticsOptIn) {
      analyticsApi.track('filter_applied', { filters: newFilters });
    }
  };

  const handleExport = async (format: 'csv' | 'geojson' | 'pdf' | 'kml') => {
    try {
      setOnboarding((prev) => ({ ...prev, exported: true }));
      if (settings.privacy.analyticsOptIn) {
        analyticsApi.track('export', { format });
      }
      if (format === 'geojson') {
        const { minRouteCount, ...apiFilters } = filters as any;
        const geoData = await flightsApi.getGeoJSON(apiFilters);
        const blob = new Blob([JSON.stringify(geoData, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flights-${new Date().toISOString()}.geojson`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // CSV/PDF/KML export
        const { minRouteCount, ...apiFilters } = filters as any;
        const data = await flightsApi.getAll(apiFilters);

        // Build rows with proper structure (not pre-joined)
        const rowsData = [
          [
            'Airline',
            'Flight Number',
            'Departure Airport',
            'Arrival Airport',
            'Departure Time',
            'Arrival Time',
            'Status',
            'Aircraft',
            'Category',
            'Tags',
            'Price',
            'Currency',
            'Taxes',
            'Fees',
          ],
          ...data.flights.map((f) => [
            f.airline,
            f.flightNumber,
            f.depIata || f.depIcao || '',
            f.arrIata || f.arrIcao || '',
            f.departureTime,
            f.arrivalTime,
            f.status,
            f.aircraft || '',
            f.category || '',
            f.tags?.join('|') || '',
            f.price ?? '',
            f.currency || '',
            f.taxes ?? '',
            f.fees ?? '',
          ]),
        ];

        if (format === 'csv') {
          // Use proper CSV escaping
          const csvContent = toCsv(rowsData);
          const blob = new Blob([csvContent], { type: 'text/csv' });
          downloadBlob(blob, `flights-${new Date().toISOString()}.csv`);
        } else if (format === 'pdf') {
          // Generate real PDF using jsPDF
          const doc = new jsPDF('landscape');
          
          // Add title
          doc.setFontSize(18);
          doc.text('TravStats Flight Report', 14, 15);
          
          // Add export date and total flights
          doc.setFontSize(10);
          doc.text(`Exported: ${new Date().toLocaleString()}`, 14, 22);
          doc.text(`Total Flights: ${data.flights.length}`, 14, 27);
          
          // Prepare table data
          const tableData = rowsData.slice(1).map(row => 
            row.map(cell => String(cell || ''))
          );
          
          // Generate table
          autoTable(doc, {
            head: [rowsData[0].map(h => String(h))],
            body: tableData,
            startY: 32,
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [66, 139, 202], textColor: 255, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [245, 245, 245] },
            margin: { top: 32, left: 14, right: 14 },
            tableWidth: 'auto',
          });
          
          // Save PDF
          doc.save(`flights-${new Date().toISOString()}.pdf`);
        } else if (format === 'kml') {
          const placemarks = data.flights
            .map((f) => {
              if (!f.depLat || !f.depLon || !f.arrLat || !f.arrLon) return '';
              const name = escapeXml(`${f.airline || ''} ${f.flightNumber || ''}`.trim());
              const desc = escapeXml(`${f.depIata || f.depIcao || ''} -> ${f.arrIata || f.arrIcao || ''}`);
              return `
                <Placemark>
                  <name>${name}</name>
                  <description>${desc}</description>
                  <LineString>
                    <coordinates>
                      ${f.depLon},${f.depLat},0
                      ${f.arrLon},${f.arrLat},0
                    </coordinates>
                  </LineString>
                </Placemark>
              `;
            })
            .join('\n');
          const kml = `<?xml version="1.0" encoding="UTF-8"?>
            <kml xmlns="http://www.opengis.net/kml/2.2">
              <Document>
                <name>TravStats Flights</name>
                ${placemarks}
              </Document>
            </kml>`;
          const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
          downloadBlob(blob, `flights-${new Date().toISOString()}.kml`);
        }
      }
    } catch (error) {
      logger.error('Failed to export:', error);
    }
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result;
        if (!content || typeof content !== 'string') {
          addToast('error', 'Datei konnte nicht gelesen werden');
          return;
        }

        let parsed: any[] = [];
        if (file.name.endsWith('.json')) {
          parsed = JSON.parse(content);
        } else {
          // naive CSV parser
          const lines = content.split('\n').filter(Boolean);
          const header = lines.shift()?.split(',') || [];
          parsed = lines.map((line) => {
            const cells = line.split(',');
            return header.reduce((acc, key, idx) => {
              acc[key.trim()] = cells[idx]?.trim();
              return acc;
            }, {} as Record<string, string>);
          });
        }

        if (parsed.length === 0) {
          addToast('warning', 'Keine Datensätze in der Datei gefunden');
          return;
        }

        // Convert parsed data to FlightInput format and import
        let successCount = 0;
        let errorCount = 0;

        for (const item of parsed) {
          try {
            // Map CSV/JSON fields to FlightInput
            const flightInput: FlightInput = {
              airline: item.airline || item.Airline || '',
              flightNumber: item.flightNumber || item['Flight Number'] || item.flight_number || '',
              departure: {
                iata: item.depIata || item['Departure Airport'] || item.departure_airport || '',
                icao: item.depIcao || item.departure_icao || '',
                name: item.depName || item.departure_name || '',
                lat: item.depLat || item.departure_lat || 0,
                lon: item.depLon || item.departure_lon || 0,
              },
              arrival: {
                iata: item.arrIata || item['Arrival Airport'] || item.arrival_airport || '',
                icao: item.arrIcao || item.arrival_icao || '',
                name: item.arrName || item.arrival_name || '',
                lat: item.arrLat || item.arrival_lat || 0,
                lon: item.arrLon || item.arrival_lon || 0,
              },
              departureTime: item.departureTime || item['Departure Time'] || item.departure_time || '',
              arrivalTime: item.arrivalTime || item['Arrival Time'] || item.arrival_time || '',
              status: (item.status || item.Status || 'flown') as 'scheduled' | 'flown' | 'cancelled',
              aircraft: item.aircraft || item.Aircraft || '',
            };

            await flightsApi.create(flightInput);
            successCount++;
          } catch (err) {
            errorCount++;
            logger.error('Failed to import flight:', err);
          }
        }

        if (successCount > 0) {
          addToast('success', `${successCount} Flug${successCount !== 1 ? 'e' : ''} erfolgreich importiert${errorCount > 0 ? `, ${errorCount} Fehler` : ''}`);
          // Reload flights
          loadRecentFlights();
          loadFlights();
        } else {
          addToast('error', `Import fehlgeschlagen: ${errorCount} Fehler`);
        }

        if (settings.privacy.analyticsOptIn) {
          analyticsApi.track('import', { count: parsed.length, success: successCount, errors: errorCount });
        }
      } catch (err) {
        logger.error('Import failed:', err);
        addToast('error', 'Import fehlgeschlagen. Bitte gültige CSV oder JSON Datei verwenden.');
      } finally {
        setImporting(false);
        if (importInputRef.current) {
          importInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <input
        type="file"
        accept=".csv,.json"
        ref={importInputRef}
        onChange={handleImportFile}
        className="hidden"
      />
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700">
        <div className="px-4 xl:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile/Tablet Menu Button */}
            <button
              onClick={() => setNavOpen(!navOpen)}
              className="xl:hidden p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <img src="/logo.png" alt="TravStats Logo" className="h-8 xl:h-10 w-auto" />
            <h1 className="text-xl xl:text-2xl font-bold text-gray-900 dark:text-white">TravStats</h1>
          </div>
          <div className="flex items-center gap-2 xl:gap-4">

            {/* Desktop Navigation Links (only on xl screens) */}
            <Link
              to="/achievements"
              className="hidden xl:flex px-3 xl:px-4 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white rounded-lg font-semibold transition-all shadow-sm hover:shadow-md text-sm xl:text-base"
            >
              🏆 Achievements
            </Link>

            <button
              onClick={() => navigate('/stats')}
              className="hidden xl:block px-3 xl:px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              Erweiterte Statistiken
            </button>

            <Link
              to="/settings"
              className="hidden xl:flex px-3 xl:px-4 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              ⚙️ Einstellungen
            </Link>

            <span className="hidden xl:inline text-sm xl:text-base text-gray-600 dark:text-gray-300">Welcome, {user?.username}!</span>
            <DarkModeToggle />
            <button onClick={logout} className="btn-secondary text-sm xl:text-base px-3 xl:px-4">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden relative">
        {/* Mobile/Tablet Overlay Backdrop */}
        {(navOpen || leftOpen || rightOpen) && (
          <div
            className="xl:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => {
              setNavOpen(false);
              setLeftOpen(false);
              setRightOpen(false);
            }}
          />
        )}

        {/* Navigation Overlay (Mobile/Tablet) */}
        {navOpen && (
          <div className="xl:hidden fixed inset-y-0 left-0 w-80 bg-white dark:bg-gray-800 z-50 flex flex-col shadow-xl">
            <div className="p-4 border-b dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Navigation</h2>
                <button
                  onClick={() => setNavOpen(false)}
                  className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  aria-label="Close navigation"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                <button
                  onClick={() => { setShowFlightForm(true); setNavOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors shadow-sm"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Flug hinzufügen
                </button>

                <div className="border-t dark:border-gray-700 my-3"></div>

                <Link
                  to="/achievements"
                  onClick={() => setNavOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-yellow-500 to-yellow-600 text-white rounded-lg font-semibold hover:from-yellow-600 hover:to-yellow-700 transition-all shadow-sm"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  Achievements
                </Link>
                <button
                  onClick={() => { navigate('/stats'); setNavOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-700 rounded-lg font-semibold transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Erweiterte Statistiken
                </button>
                <Link
                  to="/settings"
                  onClick={() => setNavOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Einstellungen
                </Link>

                <div className="border-t dark:border-gray-700 my-3"></div>

                <button
                  onClick={() => { setLeftOpen(true); setNavOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                  Flugliste anzeigen
                </button>

                <button
                  onClick={() => { setRightOpen(true); setNavOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Statistiken anzeigen
                </button>
              </div>
            </div>

            <div className="p-4 border-t dark:border-gray-700">
              <button
                onClick={() => { logout(); setNavOpen(false); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </div>
          </div>
        )}

        {/* Left Sidebar - Flights List */}
        <div className={`
          ${leftOpen ? 'translate-x-0' : '-translate-x-full'}
          xl:translate-x-0
          fixed xl:relative
          inset-y-0 left-0
          w-80 xl:w-96
          bg-white dark:bg-gray-800
          border-r dark:border-gray-700
          flex flex-col
          z-50 xl:z-auto
          transition-transform duration-300 ease-in-out
          ${!leftOpen && 'xl:hidden'}
        `}>
          <div className="p-4 border-b dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Flugliste</h2>
              <button
                onClick={() => setLeftOpen(false)}
                className="xl:hidden p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                aria-label="Close flight list"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <button onClick={() => setShowFlightForm(true)} className="btn-primary w-full">
              + Add Flight
            </button>
            
            {/* Training Button - Only visible when Developer Mode is enabled */}
            {developerModeEnabled && (
              <Link
                to="/training"
                className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg font-semibold transition-all shadow-sm hover:shadow-md"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                LLM Training
              </Link>
            )}
          </div>

          {!onboarding.dismissed && (
            <div className="p-4 border-b dark:border-gray-700">
              <OnboardingGuide
                onboarding={onboarding}
                onUpdate={(updates) => setOnboarding((prev) => ({ ...prev, ...updates }))}
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">Total Flights</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalFlightsCount}</p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">Filtered</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {flights.length}
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-2">
              <Link
                to="/flights"
                className="btn-secondary w-full text-sm flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                View All Flights
              </Link>
            </div>

            {/* Recent Flights */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Recent Flights</h3>
              {loadingRecent ? (
                <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">Loading...</div>
              ) : recentFlights.slice(0, 5).length === 0 ? (
                <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
                  No flights yet
                </div>
              ) : (
                <div className="space-y-2">
                  {recentFlights.slice(0, 5).map((flight) => (
                    <div
                      key={flight.id}
                      onClick={() => setSelectedFlightId(flight.id)}
                      className={`card cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all ${selectedFlightId === flight.id ? 'ring-2 ring-blue-500' : ''
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                            {flight.airline || 'Unknown'} {flight.flightNumber}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            {flight.depIata || flight.depIcao} → {flight.arrIata || flight.arrIcao}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditFlight(flight);
                            }}
                            className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 rounded"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center - Map & Roadmap MVP highlights */}
        <div className="flex-1 p-4 flex flex-col gap-4 min-w-0 overflow-auto relative z-0">
          <div className="flex items-center justify-between flex-wrap gap-3">
            {/* Desktop Toggle Buttons (only on xl screens) */}
            <div className="hidden xl:flex items-center gap-2">
              <button
                onClick={() => setLeftOpen(prev => !prev)}
                className="p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title={leftOpen ? 'Liste ausblenden' : 'Liste anzeigen'}
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {leftOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  )}
                </svg>
              </button>
              <button
                onClick={() => setRightOpen(prev => !prev)}
                className="p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title={rightOpen ? 'Stats ausblenden' : 'Stats anzeigen'}
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {rightOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  )}
                </svg>
              </button>
            </div>

            {/* Mobile/Tablet Toggle Buttons */}
            <div className="xl:hidden flex items-center gap-2">
              <button
                onClick={() => setLeftOpen(prev => !prev)}
                className="p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title="Flugliste anzeigen"
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </button>
              <button
                onClick={() => setRightOpen(prev => !prev)}
                className="p-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title="Statistiken anzeigen"
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-3 flex-1">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Flugkarte</h2>
              <div className="relative">
                <Filters onFilterChange={handleFilterChange} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Export Menu */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="
                    inline-flex items-center gap-2 px-4 py-2
                    bg-white dark:bg-gray-800
                    text-gray-800 dark:text-gray-100
                    border border-gray-300 dark:border-gray-600
                    rounded-lg shadow-sm
                    hover:bg-gray-50 dark:hover:bg-gray-700
                    transition-colors font-semibold text-sm
                  "
                  title="Daten exportieren"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="hidden sm:inline">Export</span>
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-xl z-50 border border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => {
                        handleExport('csv');
                        setShowExportMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t-lg text-gray-900 dark:text-white text-sm"
                    >
                      📊 Export als CSV
                    </button>
                    <button
                      onClick={() => {
                        handleExport('geojson');
                        setShowExportMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    >
                      🗺️ Export als GeoJSON
                    </button>
                    <button
                      onClick={() => {
                        handleExport('pdf');
                        setShowExportMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    >
                      📄 Export als PDF (Beta)
                    </button>
                    <button
                      onClick={() => {
                        handleExport('kml');
                        setShowExportMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    >
                      🌐 Export als KML
                    </button>
                    <button
                      onClick={() => {
                        handleImport();
                        setShowExportMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 border-t border-gray-200 dark:border-gray-700 rounded-b-lg text-gray-900 dark:text-white text-sm"
                    >
                      📥 Import CSV/JSON (Beta)
                    </button>
                  </div>
                )}
              </div>

              {/* 2D/3D Toggle */}
              <div className="inline-flex items-center gap-2">
                <button
                  onClick={handleMapToggle}
                  className="
                    inline-flex items-center gap-2 px-4 py-2
                    bg-white dark:bg-gray-800
                    text-gray-800 dark:text-gray-100
                    border border-gray-300 dark:border-gray-600
                    rounded-lg shadow-sm
                    hover:bg-gray-50 dark:hover:bg-gray-700
                    transition-colors font-semibold text-sm
                  "
                  title={is3DView ? 'Zur 2D-Karte wechseln' : 'Zum 3D-Globus wechseln'}
                >
                {is3DView ? (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                      />
                    </svg>
                    <span className="hidden sm:inline">2D-Karte</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span className="hidden sm:inline">3D-Globus</span>
                  </>
                )}
                </button>
                <HelpIcon
                  content={is3DView ? 'Wechseln Sie zur 2D-Kartenansicht für eine flache, klassische Kartenansicht.' : 'Wechseln Sie zum 3D-Globus für eine interaktive 3D-Ansicht Ihrer Flugrouten.'}
                  expandedContent="Die 2D-Karte zeigt Ihre Flugrouten auf einer flachen Karte an. Der 3D-Globus bietet eine interaktive 3D-Ansicht, in der Sie die Kugel drehen und zoomen können. Beide Ansichten zeigen Ihre Flugrouten und Airport-Marker an."
                  position="bottom"
                />
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-[420px] relative" style={{ touchAction: 'none', overflow: 'hidden' }}>
            {loadingMap && (
              <div className="absolute inset-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center z-10 rounded-lg">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto mb-2"></div>
                  <p className="text-gray-600 dark:text-gray-300 text-sm">Karte wird geladen...</p>
                </div>
              </div>
            )}
            <ErrorBoundary
              fallback={
                <div className="h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg">
                  <div className="text-center">
                    <p className="text-gray-600 dark:text-gray-300 mb-2">Unable to display map</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Please check your flight data</p>
                  </div>
                </div>
              }
            >
              <MapContainer3D
                flights={geoFlights}
                selectedFlightId={selectedFlightId}
                onFlightClick={setSelectedFlightId}
                is3D={is3DView}
                minRouteCount={(filters as any).minRouteCount ?? 1}
              />
            </ErrorBoundary>
          </div>

          {/* Jahresübersicht entfernt */}
        </div>

        {/* Right Sidebar - Stats */}
        <div className={`
          ${rightOpen ? 'translate-x-0' : 'translate-x-full'}
          xl:translate-x-0
          fixed xl:relative
          inset-y-0 right-0
          w-80
          bg-white dark:bg-gray-800
          border-l dark:border-gray-700
          flex flex-col
          z-50 xl:z-auto
          transition-transform duration-300 ease-in-out
          overflow-y-auto
          ${!rightOpen && 'xl:hidden'}
        `}>
          <div className="p-4 flex items-center justify-between border-b dark:border-gray-700 xl:border-0">
            <h2 className="text-xl font-bold dark:text-white">Statistics</h2>
            <button
              onClick={() => setRightOpen(false)}
              className="xl:hidden p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              aria-label="Close statistics"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4 pt-0 xl:pt-4">
            <ErrorBoundary>
              <Stats filters={filters} />
            </ErrorBoundary>
          </div>
        </div>
      </div>

      {/* Flight Form Modal */}
      {showFlightForm && (
        <SimplifiedFlightFormV2
          onSubmit={handleAddFlight}
          onCancel={() => setShowFlightForm(false)}
        />
      )}

      {/* Flight Edit Modal */}
      {editingFlight && (
        <FlightEditModal
          flight={editingFlight}
          isOpen={!!editingFlight}
          onClose={() => setEditingFlight(null)}
          onSave={handleUpdateFlight}
        />
      )}

      {/* Achievement Popup */}
      {newAchievements.length > 0 && (
        <AchievementPopup
          achievements={newAchievements}
          onClose={() => setNewAchievements([])}
        />
      )}
    </div>
  );
}


