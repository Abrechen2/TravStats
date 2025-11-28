# TravStats Mobile App Strategy & Roadmap

**Erstellt**: 2025-11-28
**Ziel**: Native mobile Apps für Android & iOS entwickeln
**Timeline**: 3-4 Monate (je nach Team-Größe)

---

## Inhaltsverzeichnis

1. [Technologie-Evaluierung](#technologie-evaluierung)
2. [Empfohlener Ansatz](#empfohlener-ansatz)
3. [Repository-Struktur](#repository-struktur)
4. [Detaillierte Roadmap](#detaillierte-roadmap)
5. [Architektur](#architektur)
6. [Technischer Stack](#technischer-stack)
7. [Feature-Priorisierung](#feature-priorisierung)
8. [Testing-Strategie](#testing-strategie)
9. [Deployment-Strategie](#deployment-strategie)
10. [Ressourcen & Team](#ressourcen--team)

---

## Technologie-Evaluierung

### Option 1: React Native (⭐ EMPFOHLEN)

**Vorteile:**
- ✅ **Code-Sharing**: 70-90% Code-Wiederverwendung zwischen iOS/Android
- ✅ **Bestehende Skills**: Team kennt bereits React & TypeScript
- ✅ **Komponenten**: Viele UI-Komponenten aus Web-App übertragbar
- ✅ **API-Integration**: `lib/api.ts` kann direkt genutzt werden
- ✅ **Große Community**: Mature ecosystem, viele Libraries
- ✅ **Hot Reload**: Schnelle Entwicklung
- ✅ **Expo**: Vereinfacht Build-Prozess & Publishing

**Nachteile:**
- ⚠️ Native Modules manchmal nötig (Karten, Kamera)
- ⚠️ Performance bei sehr komplexen Animationen
- ⚠️ Build-Prozess komplexer als Web

**Geeignet für**: TravStats (mittlere Komplexität, viel UI)

### Option 2: Flutter

**Vorteile:**
- ✅ Sehr gute Performance
- ✅ Eigene Rendering-Engine (konsistentes UI)
- ✅ Single Codebase

**Nachteile:**
- ❌ Neue Sprache (Dart) lernen
- ❌ Keine Code-Wiederverwendung vom Web-Projekt
- ❌ API-Client muss neu geschrieben werden

**Geeignet für**: Neue Projekte ohne bestehende React-Basis

### Option 3: Native Apps (Swift/Kotlin)

**Vorteile:**
- ✅ Beste Performance
- ✅ Vollständiger Zugriff auf Platform APIs
- ✅ Beste UX (native Patterns)

**Nachteile:**
- ❌ Doppelter Entwicklungsaufwand
- ❌ 2 Codebases zu warten
- ❌ 2 Teams oder längere Entwicklungszeit

**Geeignet für**: Sehr komplexe Apps, große Teams

### Option 4: Progressive Web App (PWA)

**Vorteile:**
- ✅ Bestehende Web-App erweitern
- ✅ Ein Codebase
- ✅ Einfaches Deployment

**Nachteile:**
- ❌ Eingeschränkter Zugriff auf Device-Features
- ❌ Schlechtere Performance
- ❌ Nicht in App Stores
- ❌ iOS-Support eingeschränkt

**Geeignet für**: Einfache Apps, schnelle Prototypen

---

## Empfohlener Ansatz

### 🎯 **React Native mit Expo**

**Begründung:**
1. **Maximale Code-Wiederverwendung**: TypeScript-Types, API-Client, Business-Logic
2. **Schnellste Time-to-Market**: Gemeinsame Entwicklung für beide Plattformen
3. **Team-Effizienz**: Bestehende React-Kenntnisse nutzen
4. **Expo-Vorteile**:
   - Vereinfachter Build-Prozess
   - OTA-Updates (Over-The-Air) ohne App Store Review
   - Einfachere Navigation, Kamera, Location APIs
   - EAS (Expo Application Services) für CI/CD

**Wann auf Bare React Native wechseln:**
- Falls spezifische native Module benötigt werden
- Falls Expo-Einschränkungen zu limitierend sind
- (Kann später jederzeit "ejectet" werden)

---

## Repository-Struktur

### Option A: Monorepo (⭐ EMPFOHLEN)

```
TravStats/
├── backend/              # Bestehend
├── frontend/             # Bestehend
├── mobile/               # NEU: React Native App
│   ├── src/
│   ├── app.json
│   └── package.json
├── shared/               # NEU: Geteilter Code
│   ├── types/            # TypeScript Definitionen
│   ├── api/              # API Client
│   ├── utils/            # Helpers
│   └── constants/        # Konstanten
├── package.json          # Root workspace
└── README.md
```

**Vorteile:**
- ✅ Einfaches Code-Sharing
- ✅ Gemeinsame Dependencies
- ✅ Atomic Commits über alle Projekte
- ✅ Einfachere CI/CD (ein Repo)

**Setup mit Yarn Workspaces oder npm workspaces:**
```json
// package.json (root)
{
  "private": true,
  "workspaces": [
    "backend",
    "frontend",
    "mobile",
    "shared"
  ]
}
```

### Option B: Separates Repository

```
TravStats-Mobile/
├── src/
├── app.json
└── package.json
```

**Vorteile:**
- ✅ Unabhängige Releases
- ✅ Separate CI/CD Pipeline
- ✅ Kleineres Repo

**Nachteile:**
- ❌ Code-Sharing komplizierter (npm packages nötig)
- ❌ Types müssen synchronisiert werden
- ❌ Mehr Overhead

**Empfehlung**: Monorepo für maximale Produktivität

---

## Detaillierte Roadmap

### Phase 1: Setup & Foundation (Woche 1-2)

#### Woche 1: Projekt-Setup

**Ziele:**
- [ ] Entwicklungsumgebung einrichten
- [ ] Projekt-Struktur erstellen
- [ ] CI/CD Pipeline aufsetzen

**Tasks:**

```bash
# 1.1 Expo-Projekt erstellen
npx create-expo-app mobile --template blank-typescript
cd mobile

# 1.2 Navigation Setup
npm install @react-navigation/native @react-navigation/stack @react-navigation/bottom-tabs
npx expo install react-native-screens react-native-safe-area-context

# 1.3 State Management
npm install zustand

# 1.4 API Client
npm install axios

# 1.5 Styling
npm install nativewind tailwindcss
```

**Deliverables:**
- ✅ Lauffähige Expo-App mit Navigation
- ✅ Verbindung zum Backend (Health Check)
- ✅ TypeScript konfiguriert
- ✅ Git-Repository setup

#### Woche 2: Shared Code & Authentication

**Ziele:**
- [ ] Gemeinsamen Code extrahieren
- [ ] Authentication implementieren
- [ ] Basic UI-Komponenten

**Tasks:**

1. **Shared Module erstellen:**
```typescript
// shared/types/index.ts
export interface Flight {
  id: string;
  airline?: string;
  flightNumber?: string;
  // ... (aus frontend/src/types übernehmen)
}

export interface User {
  id: string;
  username: string;
}

// shared/api/client.ts
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000',
  timeout: 10000,
});

// shared/api/auth.ts
export const authApi = {
  login: async (username: string, password: string) => {
    const response = await apiClient.post('/api/v1/auth/login', {
      username,
      password,
    });
    return response.data;
  },
  register: async (username: string, password: string) => {
    const response = await apiClient.post('/api/v1/auth/register', {
      username,
      password,
    });
    return response.data;
  },
  me: async (token: string) => {
    const response = await apiClient.get('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  },
};
```

2. **Auth Store:**
```typescript
// mobile/src/store/authStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../../../shared/types';

interface AuthState {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: async (username, password) => {
        const { user, token } = await authApi.login(username, password);
        set({ user, token });
      },
      logout: () => set({ user: null, token: null }),
    }),
    {
      name: 'travstats-auth',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

3. **Login Screen:**
```typescript
// mobile/src/screens/LoginScreen.tsx
import React, { useState } from 'react';
import { View, TextInput, Button, Text } from 'react-native';
import { useAuthStore } from '../store/authStore';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const login = useAuthStore((state) => state.login);

  const handleLogin = async () => {
    try {
      await login(username, password);
    } catch (err) {
      setError('Login failed');
    }
  };

  return (
    <View className="flex-1 justify-center p-4">
      <TextInput
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        className="border p-2 mb-4"
      />
      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        className="border p-2 mb-4"
      />
      {error ? <Text className="text-red-500 mb-4">{error}</Text> : null}
      <Button title="Login" onPress={handleLogin} />
    </View>
  );
}
```

**Deliverables:**
- ✅ Login/Register funktioniert
- ✅ Token-Speicherung in AsyncStorage
- ✅ Shared Types zwischen Web & Mobile
- ✅ Basic UI-Komponenten (Button, Input, etc.)

---

### Phase 2: Core Features (Woche 3-6)

#### Woche 3: Flight List & Details

**Ziele:**
- [ ] Flüge abrufen und anzeigen
- [ ] Flight-Details Screen
- [ ] Pull-to-Refresh

**Components:**
```typescript
// mobile/src/screens/FlightListScreen.tsx
// mobile/src/screens/FlightDetailScreen.tsx
// mobile/src/components/FlightCard.tsx
```

**Features:**
- Liste aller Flüge
- Sortierung & Filterung
- Swipe-to-Delete
- Tap zum Öffnen Details

#### Woche 4: Map Integration

**Ziele:**
- [ ] Karte mit Flug-Routen
- [ ] Airport-Marker
- [ ] Interaktive Route-Linien

**Setup:**
```bash
npm install react-native-maps
npx expo install react-native-maps
```

**Implementation:**
```typescript
// mobile/src/screens/MapScreen.tsx
import MapView, { Marker, Polyline } from 'react-native-maps';

export default function MapScreen() {
  const flights = useFlightStore((state) => state.flights);

  return (
    <MapView
      style={{ flex: 1 }}
      initialRegion={{
        latitude: 50.0,
        longitude: 10.0,
        latitudeDelta: 40,
        longitudeDelta: 40,
      }}
    >
      {flights.map((flight) => (
        <>
          <Marker
            key={`dep-${flight.id}`}
            coordinate={{
              latitude: flight.departure.lat,
              longitude: flight.departure.lon,
            }}
            title={flight.departure.iata}
          />
          <Marker
            key={`arr-${flight.id}`}
            coordinate={{
              latitude: flight.arrival.lat,
              longitude: flight.arrival.lon,
            }}
            title={flight.arrival.iata}
          />
          <Polyline
            key={`route-${flight.id}`}
            coordinates={[
              {
                latitude: flight.departure.lat,
                longitude: flight.departure.lon,
              },
              {
                latitude: flight.arrival.lat,
                longitude: flight.arrival.lon,
              },
            ]}
            strokeColor="#3b82f6"
            strokeWidth={2}
          />
        </>
      ))}
    </MapView>
  );
}
```

#### Woche 5: Add/Edit Flights

**Ziele:**
- [ ] Flug hinzufügen (Formular)
- [ ] Flug bearbeiten
- [ ] Airport-Autocomplete

**Features:**
- Simplified Flight Form (ähnlich Web)
- Date/Time Picker (native)
- Airport-Suche mit Debouncing
- Validierung

**Components:**
```typescript
// mobile/src/screens/AddFlightScreen.tsx
// mobile/src/components/AirportAutocomplete.tsx
// mobile/src/components/DateTimePicker.tsx
```

#### Woche 6: Statistics & Achievements

**Ziele:**
- [ ] Statistik-Dashboard
- [ ] Achievement-Gallery
- [ ] Charts (React Native Chart Kit)

**Setup:**
```bash
npm install react-native-chart-kit react-native-svg
```

**Components:**
```typescript
// mobile/src/screens/StatsScreen.tsx
// mobile/src/screens/AchievementsScreen.tsx
// mobile/src/components/StatCard.tsx
```

**Features:**
- Gesamtstatistiken (Flüge, Distanz, CO2)
- Charts (Flüge pro Monat, Airlines)
- Achievement-Badges mit Unlock-Status

---

### Phase 3: Mobile-Specific Features (Woche 7-8)

#### Woche 7: Camera & QR Scanner

**Ziele:**
- [ ] Boarding Pass Scanner
- [ ] Receipt Upload
- [ ] Bildkompression

**Setup:**
```bash
npx expo install expo-camera expo-barcode-scanner expo-image-picker
```

**Implementation:**
```typescript
// mobile/src/screens/ScanBoardingPassScreen.tsx
import { Camera } from 'expo-camera';
import { BarCodeScanner } from 'expo-barcode-scanner';

export default function ScanBoardingPassScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    setScanned(true);
    // Parse BCBP (IATA Bar Coded Boarding Pass)
    const parsedData = parseBoardingPass(data);
    // Navigate to Add Flight with pre-filled data
    navigation.navigate('AddFlight', { initialData: parsedData });
  };

  return (
    <Camera
      style={{ flex: 1 }}
      onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
      barCodeScannerSettings={{
        barCodeTypes: [BarCodeScanner.Constants.BarCodeType.pdf417],
      }}
    />
  );
}
```

#### Woche 8: Notifications & Background Sync

**Ziele:**
- [ ] Push Notifications (Flight Reminders)
- [ ] Background Sync
- [ ] Offline-Support

**Setup:**
```bash
npx expo install expo-notifications expo-task-manager
npm install @react-native-async-storage/async-storage
```

**Features:**
- Erinnerung 24h vor Abflug
- Offline-Modus (lokale DB mit SQLite)
- Sync wenn Online

---

### Phase 4: Polish & Optimization (Woche 9-10)

#### Woche 9: UI/UX Refinement

**Ziele:**
- [ ] Design-System finalisieren
- [ ] Dark Mode
- [ ] Animationen
- [ ] Accessibility

**Tasks:**
- Einheitliche Farben & Spacing
- Smooth Transitions (React Navigation)
- Loading States & Skeletons
- Error Handling (Retry, Offline-Messages)
- Screen Reader Support

#### Woche 10: Performance & Testing

**Ziele:**
- [ ] Performance-Optimierung
- [ ] Unit Tests
- [ ] E2E Tests
- [ ] Beta Testing

**Performance:**
```typescript
// Memoization
import { memo, useMemo, useCallback } from 'react';

const FlightCard = memo(({ flight, onPress }) => {
  return <View>...</View>;
});

// Lazy Loading
import { FlatList } from 'react-native';

<FlatList
  data={flights}
  renderItem={({ item }) => <FlightCard flight={item} />}
  keyExtractor={(item) => item.id}
  initialNumToRender={10}
  maxToRenderPerBatch={10}
  windowSize={5}
/>
```

**Testing:**
```bash
npm install --save-dev @testing-library/react-native jest
npm install --save-dev detox  # E2E Testing
```

---

### Phase 5: Deployment (Woche 11-12)

#### Woche 11: App Store Vorbereitung

**iOS:**
```bash
# 1. EAS Build konfigurieren
npm install -g eas-cli
eas build:configure

# 2. App Icons & Splash Screen
npx expo install expo-splash-screen

# 3. Build erstellen
eas build --platform ios

# 4. App Store Connect Setup
# - App-ID erstellen
# - Screenshots erstellen
# - App-Beschreibung
```

**Android:**
```bash
# 1. Build erstellen
eas build --platform android

# 2. Google Play Console
# - App erstellen
# - Screenshots & Beschreibung
# - Content Rating
```

**Checklists:**
- [ ] App Icons (1024x1024)
- [ ] Splash Screen
- [ ] Screenshots (alle Bildschirmgrößen)
- [ ] App-Beschreibung (DE/EN)
- [ ] Privacy Policy
- [ ] Terms of Service
- [ ] Permissions-Begründungen

#### Woche 12: Launch & Monitoring

**Launch:**
- [ ] Beta Testing (TestFlight, Google Play Beta)
- [ ] Feedback sammeln
- [ ] Bugfixes
- [ ] Production Release

**Monitoring:**
```bash
# Analytics & Crash Reporting
npm install expo-analytics-amplitude
npx expo install expo-application

# Sentry für Error Tracking
npm install @sentry/react-native
```

**Post-Launch:**
- [ ] Sentry Dashboard überwachen
- [ ] Analytics auswerten
- [ ] User-Feedback sammeln
- [ ] Erste Updates planen

---

## Architektur

### Folder Structure (Mobile)

```
mobile/
├── src/
│   ├── screens/                 # Screen-Komponenten
│   │   ├── auth/
│   │   │   ├── LoginScreen.tsx
│   │   │   └── RegisterScreen.tsx
│   │   ├── flights/
│   │   │   ├── FlightListScreen.tsx
│   │   │   ├── FlightDetailScreen.tsx
│   │   │   ├── AddFlightScreen.tsx
│   │   │   └── EditFlightScreen.tsx
│   │   ├── map/
│   │   │   └── MapScreen.tsx
│   │   ├── stats/
│   │   │   ├── StatsScreen.tsx
│   │   │   └── AchievementsScreen.tsx
│   │   └── settings/
│   │       └── SettingsScreen.tsx
│   ├── components/              # Wiederverwendbare Komponenten
│   │   ├── ui/
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Card.tsx
│   │   │   └── LoadingSpinner.tsx
│   │   ├── flight/
│   │   │   ├── FlightCard.tsx
│   │   │   ├── FlightForm.tsx
│   │   │   └── AirportAutocomplete.tsx
│   │   └── map/
│   │       ├── FlightMarker.tsx
│   │       └── FlightRoute.tsx
│   ├── navigation/              # Navigation-Setup
│   │   ├── AppNavigator.tsx
│   │   ├── AuthNavigator.tsx
│   │   └── TabNavigator.tsx
│   ├── store/                   # Zustand Stores
│   │   ├── authStore.ts
│   │   ├── flightStore.ts
│   │   └── settingsStore.ts
│   ├── hooks/                   # Custom Hooks
│   │   ├── useFlights.ts
│   │   ├── useStats.ts
│   │   └── usePermissions.ts
│   ├── utils/                   # Utilities
│   │   ├── formatting.ts
│   │   ├── validation.ts
│   │   └── bcbpParser.ts
│   ├── constants/               # Konstanten
│   │   ├── colors.ts
│   │   └── config.ts
│   └── types/                   # TypeScript Types (local)
│       └── navigation.ts
├── app.json                     # Expo-Konfiguration
├── eas.json                     # EAS Build-Konfiguration
├── babel.config.js
├── tsconfig.json
└── package.json
```

### Navigation Structure

```
App Navigator (Stack)
├── Auth Flow (wenn nicht eingeloggt)
│   ├── Login Screen
│   └── Register Screen
└── Main Flow (wenn eingeloggt)
    └── Tab Navigator (Bottom Tabs)
        ├── Home (Stack)
        │   ├── Flight List
        │   ├── Flight Details
        │   ├── Add Flight
        │   └── Edit Flight
        ├── Map (Stack)
        │   └── Map View
        ├── Stats (Stack)
        │   ├── Stats Overview
        │   └── Achievements
        └── Profile (Stack)
            └── Settings
```

---

## Technischer Stack

### Core Dependencies

```json
{
  "dependencies": {
    // Framework
    "expo": "~50.0.0",
    "react": "18.2.0",
    "react-native": "0.73.0",

    // Navigation
    "@react-navigation/native": "^6.1.9",
    "@react-navigation/stack": "^6.3.20",
    "@react-navigation/bottom-tabs": "^6.5.11",

    // State Management
    "zustand": "^4.4.7",

    // API & Networking
    "axios": "^1.6.2",
    "@react-native-async-storage/async-storage": "^1.21.0",

    // UI Components
    "react-native-screens": "^3.29.0",
    "react-native-safe-area-context": "^4.8.2",
    "react-native-gesture-handler": "~2.14.0",

    // Maps
    "react-native-maps": "^1.10.0",

    // Charts
    "react-native-chart-kit": "^6.12.0",
    "react-native-svg": "^14.1.0",

    // Camera & Media
    "expo-camera": "~14.0.0",
    "expo-barcode-scanner": "~12.8.0",
    "expo-image-picker": "~14.7.0",

    // Notifications
    "expo-notifications": "~0.27.0",

    // Utils
    "date-fns": "^3.0.0",
    "expo-linking": "~6.2.0"
  },
  "devDependencies": {
    "@types/react": "~18.2.45",
    "@types/react-native": "~0.73.0",
    "typescript": "^5.3.0",

    // Testing
    "@testing-library/react-native": "^12.4.0",
    "jest": "^29.7.0",
    "detox": "^20.14.0"
  }
}
```

---

## Feature-Priorisierung

### Must-Have (MVP)

| Feature | Priorität | Zeitaufwand |
|---------|-----------|-------------|
| Login/Register | P0 | 2 Tage |
| Flight List | P0 | 3 Tage |
| Add/Edit Flight | P0 | 4 Tage |
| Flight Details | P0 | 2 Tage |
| Map View | P0 | 5 Tage |
| Basic Stats | P0 | 3 Tage |

**Total MVP**: ~3 Wochen

### Should-Have (v1.0)

| Feature | Priorität | Zeitaufwand |
|---------|-----------|-------------|
| Achievements | P1 | 3 Tage |
| Advanced Stats | P1 | 4 Tage |
| Boarding Pass Scanner | P1 | 5 Tage |
| Receipt Upload | P1 | 2 Tage |
| Push Notifications | P1 | 3 Tage |
| Dark Mode | P1 | 2 Tage |

**Total v1.0**: +3 Wochen (6 Wochen gesamt)

### Nice-to-Have (v1.1+)

| Feature | Priorität | Zeitaufwand |
|---------|-----------|-------------|
| Offline Mode | P2 | 1 Woche |
| Email Import | P2 | 1 Woche |
| Share Flights | P2 | 3 Tage |
| Export Data | P2 | 2 Tage |
| Calendar Integration | P2 | 5 Tage |
| Widgets (iOS/Android) | P2 | 1 Woche |

---

## Testing-Strategie

### Unit Tests

```typescript
// __tests__/utils/bcbpParser.test.ts
import { parseBoardingPass } from '../../src/utils/bcbpParser';

describe('parseBoardingPass', () => {
  it('should parse valid BCBP data', () => {
    const bcbp = 'M1DOE/JOHN            EABC123 JFKLAX...';
    const result = parseBoardingPass(bcbp);

    expect(result.passengerName).toBe('DOE/JOHN');
    expect(result.flightNumber).toBe('ABC123');
    expect(result.departure).toBe('JFK');
    expect(result.arrival).toBe('LAX');
  });
});
```

### Component Tests

```typescript
// __tests__/components/FlightCard.test.tsx
import { render } from '@testing-library/react-native';
import FlightCard from '../../src/components/flight/FlightCard';

describe('FlightCard', () => {
  const mockFlight = {
    id: '1',
    airline: 'Lufthansa',
    flightNumber: 'LH456',
    departure: { iata: 'FRA', name: 'Frankfurt' },
    arrival: { iata: 'JFK', name: 'New York' },
  };

  it('renders flight information correctly', () => {
    const { getByText } = render(<FlightCard flight={mockFlight} />);

    expect(getByText('Lufthansa')).toBeTruthy();
    expect(getByText('LH456')).toBeTruthy();
    expect(getByText('FRA')).toBeTruthy();
    expect(getByText('JFK')).toBeTruthy();
  });
});
```

### E2E Tests (Detox)

```typescript
// e2e/login.e2e.ts
describe('Login Flow', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  it('should login successfully', async () => {
    await element(by.id('username-input')).typeText('testuser');
    await element(by.id('password-input')).typeText('password123');
    await element(by.id('login-button')).tap();

    await expect(element(by.id('flight-list'))).toBeVisible();
  });
});
```

---

## Deployment-Strategie

### Development Workflow

```bash
# Local Development
npm run start              # Expo Dev Server
npm run ios                # iOS Simulator
npm run android            # Android Emulator

# Testing
npm test                   # Unit Tests
npm run test:e2e           # E2E Tests (Detox)

# Type Checking
npm run type-check         # TypeScript
```

### Build & Deploy (EAS)

```json
// eas.json
{
  "cli": {
    "version": ">= 5.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "ios": {
        "simulator": true
      }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "1234567890"
      },
      "android": {
        "serviceAccountKeyPath": "./service-account.json",
        "track": "internal"
      }
    }
  }
}
```

**Build Commands:**
```bash
# Development Build
eas build --profile development --platform all

# Preview Build (für Testing)
eas build --profile preview --platform all

# Production Build
eas build --profile production --platform all

# Submit to Stores
eas submit --platform ios
eas submit --platform android
```

### CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/mobile-ci.yml
name: Mobile CI

on:
  push:
    branches: [main, develop]
    paths:
      - 'mobile/**'
      - 'shared/**'
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          cd mobile
          npm ci

      - name: Run tests
        run: |
          cd mobile
          npm test

      - name: Type check
        run: |
          cd mobile
          npm run type-check

  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3

      - name: Setup Expo
        uses: expo/expo-github-action@v8
        with:
          expo-version: latest
          token: ${{ secrets.EXPO_TOKEN }}

      - name: Build Preview
        run: |
          cd mobile
          eas build --profile preview --platform all --non-interactive
```

### OTA Updates (Over-The-Air)

```bash
# Publish Update (ohne App Store)
eas update --branch production --message "Bug fixes"

# Automatisches Rollout
eas update:configure
```

**Vorteil**: Bugfixes & kleine Features ohne App Store Review!

---

## Ressourcen & Team

### Empfohlene Team-Größe

**Minimal (1 Person):**
- Full-Stack Developer mit React/React Native Erfahrung
- Timeline: 3-4 Monate

**Optimal (2-3 Personen):**
- 1x Mobile Developer (React Native)
- 1x Backend Developer (API-Erweiterungen)
- 1x UI/UX Designer (optional)
- Timeline: 2-3 Monate

### Skills benötigt

- ✅ React & TypeScript (Pflicht)
- ✅ React Native (kann gelernt werden)
- ✅ REST API Integration
- ✅ Git & CI/CD
- ⚠️ iOS/Android Publishing (lernbar)
- ⚠️ Native Modules (falls Expo nicht ausreicht)

### Lernressourcen

**React Native:**
- [React Native Docs](https://reactnative.dev/)
- [Expo Docs](https://docs.expo.dev/)
- [React Navigation](https://reactnavigation.org/)

**Best Practices:**
- [React Native Performance](https://reactnative.dev/docs/performance)
- [Expo Best Practices](https://docs.expo.dev/guides/best-practices/)
- [TypeScript with React Native](https://reactnative.dev/docs/typescript)

**Tutorials:**
- [Expo Tutorial](https://docs.expo.dev/tutorial/introduction/)
- [React Native School](https://www.reactnativeschool.com/)

---

## Nächste Schritte

### Sofort (Woche 1):

1. **Entscheidung treffen**: Monorepo vs. separates Repo
2. **Expo-Projekt erstellen**:
   ```bash
   npx create-expo-app mobile --template blank-typescript
   ```
3. **Shared-Module aufsetzen**:
   ```bash
   mkdir shared
   # Types, API-Client extrahieren
   ```
4. **Erste Screen erstellen**: Login-Screen
5. **Backend-Verbindung testen**: Health-Check API-Call

### Diese Woche:

- [ ] Repository-Struktur finalisieren
- [ ] Development-Setup dokumentieren
- [ ] Ersten Commit machen
- [ ] Team-Meeting: Roles & Timeline

### Nächster Monat:

- [ ] MVP-Features implementieren (Login, Flights, Map)
- [ ] Wöchentliche Testbuilds
- [ ] UI/UX Feedback einholen

---

## Budget & Kosten

### Einmalig:

| Item | Kosten |
|------|--------|
| Apple Developer Account | $99/Jahr |
| Google Play Developer Account | $25 einmalig |
| **Total Einmalig** | **~$124** |

### Laufend (Optional):

| Service | Kosten | Beschreibung |
|---------|--------|--------------|
| Expo EAS | $0 - $99/mo | Free tier: 30 Builds/mo |
| Sentry | $0 - $26/mo | Error Tracking |
| Amplitude Analytics | $0 - $49/mo | Analytics (Free bis 10M events) |
| **Total Monatlich** | **$0 - $175** | Je nach Nutzung |

**Empfehlung**: Start mit Free Tiers, später upgraden bei Bedarf.

---

## Risiken & Mitigation

### Technische Risiken:

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| Expo-Limitierungen | Mittel | Hoch | Früh testen, ggf. auf Bare React Native |
| Performance-Probleme | Niedrig | Mittel | Profiling, Optimierung (memo, useMemo) |
| iOS/Android Unterschiede | Mittel | Niedrig | Platform-specific Code, Testing auf beiden |
| App Store Rejection | Niedrig | Hoch | Guidelines früh lesen, Beta-Test |

### Projekt-Risiken:

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| Feature Creep | Hoch | Hoch | Strikte MVP-Definition |
| Zeitüberschreitung | Mittel | Mittel | Agile Sprints, regelmäßige Reviews |
| Team-Verfügbarkeit | Mittel | Hoch | Buffer einplanen, Dokumentation |

---

## Success Metrics (KPIs)

### Development Metrics:

- **Time to MVP**: < 3 Wochen
- **Test Coverage**: > 70%
- **Build Success Rate**: > 95%
- **Crash-Free Rate**: > 99%

### User Metrics (nach Launch):

- **Downloads**: 100+ in Monat 1
- **DAU/MAU Ratio**: > 20%
- **Retention (Day 7)**: > 40%
- **Rating**: > 4.0 ⭐

---

## Conclusion

### Warum React Native + Expo?

✅ **Schnellste Time-to-Market** (beide Plattformen parallel)
✅ **Maximale Code-Wiederverwendung** (70-90% shared)
✅ **Nutzt bestehendes Know-How** (React, TypeScript)
✅ **Geringste Kosten** (ein Team, ein Codebase)
✅ **Einfaches Deployment** (EAS, OTA-Updates)

### Timeline-Übersicht:

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| **Phase 1**: Setup & Auth | 2 Wochen | Lauffähige App mit Login |
| **Phase 2**: Core Features | 4 Wochen | MVP (Flights, Map, Stats) |
| **Phase 3**: Mobile Features | 2 Wochen | Scanner, Notifications |
| **Phase 4**: Polish | 2 Wochen | UI/UX, Testing |
| **Phase 5**: Deployment | 2 Wochen | App Store Launch |
| **Total** | **12 Wochen** | **v1.0 in Stores** |

### Repository-Empfehlung:

**Monorepo** ✅
```
TravStats/
├── backend/
├── frontend/
├── mobile/        ← NEU
└── shared/        ← NEU
```

**Vorteile**:
- Einfaches Code-Sharing
- Gemeinsame Types
- Ein CI/CD
- Atomic Commits

---

**Bereit zum Starten?** 🚀

Nächster Schritt:
```bash
# In TravStats Root:
npx create-expo-app mobile --template blank-typescript
cd mobile
npm install @react-navigation/native @react-navigation/stack
npx expo install react-native-screens react-native-safe-area-context
npm run start
```

**Viel Erfolg!** ✈️
