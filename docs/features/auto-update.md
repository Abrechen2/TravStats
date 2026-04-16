# Automatic Flight Data Updates

## Overview

The automatic flight data update feature retrieves current flight data from external APIs (AirLabs, Aviationstack, OpenSky) automatically while flights are in progress. The proposed changes are stored in a "Pending Updates" area, where users can review, edit, approve, or reject them.

## Features

- **Automatic data retrieval**: Flight data is fetched from APIs automatically during active flights
- **Pending Updates area**: Proposed changes are kept in a holding area
- **Review & Edit**: Users can review, edit, and then approve or reject updates
- **Statistics impact**: Preview the effect on statistics before applying
- **Configurable**: All settings can be adjusted in user preferences

## User Guide

### Activation

1. Navigate to **Settings** → **Automatic Updates**
2. Enable **Activate automatic updates**
3. Configure the following options:
   - **Approval required**: When enabled, updates must be approved manually
   - **Check interval**: How often the system looks for updates (in minutes)
   - **Only during flight**: Only fetch updates while a flight is active
   - **Expiry time**: How many hours until updates expire

### Managing Pending Updates

1. Navigate to **Pending Updates** in the navigation
2. You will see a list of all pending updates with:
   - Flight information
   - Proposed changes (highlighted)
   - Statistics impact preview
   - Expiry time

3. For each update you can:
   - **Apply**: Apply the update directly to the flight
   - **Reject**: Discard the update
   - **Edit**: Adjust the update before applying it
   - **Delete**: Remove the update
   - **Preview**: Show the statistics impact

### Editing an Update

1. Click **Edit** on an update
2. In the editor you can:
   - Edit fields directly
   - See a live preview of the changes
   - See the statistics impact update in real time
3. Save the changes
4. Apply the edited update

### Filtering & Sorting

- **Filter by status**: pending, applied, rejected, expired
- **Filter by flight**: Show only updates for a specific flight
- **Sort by**: Date, status, flight number

## API Documentation

### Endpoints

#### GET `/api/v1/pending-updates`

Retrieves all pending updates for the authenticated user.

**Query parameters:**
- `status` (optional): Filter by status (pending, applied, rejected, expired)
- `flightId` (optional): Filter by flight ID

**Response:**
```json
{
  "updates": [
    {
      "id": "uuid",
      "flightId": "uuid",
      "userId": "uuid",
      "status": "pending",
      "originalData": {},
      "proposedData": {},
      "editedData": null,
      "changes": [],
      "editedChanges": null,
      "apiSource": "airlabs",
      "fetchedAt": "2025-01-20T10:00:00Z",
      "expiresAt": "2025-01-21T10:00:00Z",
      "appliedAt": null,
      "rejectedAt": null,
      "editedAt": null,
      "statisticsImpact": {},
      "createdAt": "2025-01-20T10:00:00Z",
      "updatedAt": "2025-01-20T10:00:00Z",
      "flight": {}
    }
  ]
}
```

#### GET `/api/v1/pending-updates/:id`

Retrieves a specific update.

**Response:**
```json
{
  "update": {
    "id": "uuid",
    // ... alle Update-Felder
  }
}
```

#### PUT `/api/v1/pending-updates/:id`

Updates an update with edited data.

**Request Body:**
```json
{
  "editedData": {
    "arrIata": "LGW",
    "arrLat": 51.1537,
    "arrLon": -0.1821
  },
  "editedChanges": [
    {
      "field": "arrIata",
      "oldValue": "LHR",
      "newValue": "LGW",
      "type": "changed"
    }
  ]
}
```

**Response:**
```json
{
  "update": {
    // Aktualisiertes Update
  }
}
```

#### POST `/api/v1/pending-updates/:id/apply`

Applies an update to the flight.

**Response:**
```json
{
  "update": {
    "status": "applied",
    "appliedAt": "2025-01-20T10:00:00Z"
  },
  "flight": {
    // Aktualisierter Flug
  }
}
```

#### POST `/api/v1/pending-updates/:id/reject`

Rejects an update.

**Response:**
```json
{
  "update": {
    "status": "rejected",
    "rejectedAt": "2025-01-20T10:00:00Z"
  }
}
```

#### DELETE `/api/v1/pending-updates/:id`

Deletes an update.

**Response:** 204 No Content

#### POST `/api/v1/pending-updates/:id/preview-impact`

Shows a preview of the statistics impact for an update.

**Request Body:**
```json
{
  "editedData": {
    // Optional: Bearbeitete Daten für Vorschau
  }
}
```

**Response:**
```json
{
  "impact": {
    "distance": {
      "before": 1000,
      "after": 1050,
      "change": 50
    },
    "flightTime": {
      "before": 120,
      "after": 125,
      "change": 5
    },
    "airlines": {
      "before": ["Lufthansa"],
      "after": ["Lufthansa"],
      "added": [],
      "removed": []
    },
    "airports": {
      "before": ["FRA", "LHR"],
      "after": ["FRA", "LGW"],
      "added": ["LGW"],
      "removed": ["LHR"]
    }
  }
}
```

#### GET `/api/v1/pending-updates/statistics`

Retrieves statistics about pending updates.

**Response:**
```json
{
  "statistics": {
    "totalUpdates": 10,
    "appliedUpdates": 7,
    "rejectedUpdates": 2,
    "editedUpdates": 1,
    "expiredUpdates": 0,
    "mostChangedFields": [
      { "field": "arrIata", "count": 5 },
      { "field": "departureTime", "count": 3 }
    ],
    "averageUpdateTime": 2.5
  }
}
```

### Settings Endpoints

#### GET `/api/v1/settings`

Retrieves user settings, including auto-update settings.

**Response:**
```json
{
  "settings": {
    "autoUpdateEnabled": true,
    "autoUpdateRequireApproval": true,
    "autoUpdateCheckInterval": 15,
    "autoUpdateOnlyDuringFlight": true,
    "autoUpdateExpiryHours": 24
  }
}
```

#### PUT `/api/v1/settings`

Updates user settings.

**Request Body:**
```json
{
  "autoUpdateEnabled": true,
  "autoUpdateRequireApproval": true,
  "autoUpdateCheckInterval": 15,
  "autoUpdateOnlyDuringFlight": true,
  "autoUpdateExpiryHours": 24
}
```

## Admin Documentation

### Database Schema

#### PendingFlightUpdate

```prisma
model PendingFlightUpdate {
  id               String    @id @default(uuid())
  flightId         String
  userId           String
  status           String    @default("pending") // "pending" | "applied" | "rejected" | "expired" | "edited"
  originalData     Json
  proposedData     Json
  editedData       Json?
  changes          Json
  editedChanges    Json?
  apiSource        String
  fetchedAt        DateTime
  expiresAt        DateTime
  appliedAt        DateTime?
  rejectedAt       DateTime?
  editedAt         DateTime?
  statisticsImpact Json?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  flight Flight @relation(fields: [flightId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([flightId])
  @@index([userId])
  @@index([status])
  @@index([expiresAt])
}
```

#### PendingUpdateStatistics

```prisma
model PendingUpdateStatistics {
  id                  String    @id @default(uuid())
  userId              String    @unique
  totalUpdates        Int       @default(0)
  appliedUpdates      Int       @default(0)
  rejectedUpdates     Int       @default(0)
  editedUpdates       Int       @default(0)
  expiredUpdates      Int       @default(0)
  mostChangedFields   Json      @default("[]")
  averageUpdateTime   Float?
  lastUpdated         DateTime  @updatedAt
  createdAt           DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

#### UserSettings (extended)

```prisma
model UserSettings {
  // ... bestehende Felder ...
  autoUpdateEnabled         Boolean   @default(false)
  autoUpdateRequireApproval Boolean   @default(true)
  autoUpdateCheckInterval   Int       @default(15) // in Minuten
  autoUpdateOnlyDuringFlight Boolean  @default(true)
  autoUpdateExpiryHours     Int       @default(24) // in Stunden
}
```

### Scheduler

The `flightUpdateScheduler` runs as a cron job and checks regularly for active flights:

- **Run interval**: Every minute
- **Logic**:
  1. Retrieves all users with auto-update enabled
  2. For each user, identifies active flights
  3. For each active flight, performs API queries
  4. If changes are found, creates a pending update

### Services

#### flightAutoUpdate.ts

- `isFlightActive(flight)`: Checks whether a flight is currently active
- `calculateChanges(originalData, proposedData)`: Calculates differences between original and proposed data
- `checkAndUpdateFlights(userId, options)`: Main function for checking and creating updates

#### pendingUpdateService.ts

- `getPendingUpdates(userId, filters)`: Retrieves pending updates
- `applyPendingUpdate(id, userId)`: Applies an update
- `rejectPendingUpdate(id, userId)`: Rejects an update
- `updatePendingUpdate(id, userId, editedData, editedChanges)`: Updates an update
- `calculateStatisticsImpact(flightId, userId, proposedData, originalData)`: Calculates statistics impact
- `cleanupExpiredUpdates()`: Marks expired updates as "expired"

### Configuration

#### Environment Variables

No new environment variables required. The feature uses the existing API configurations (AirLabs, Aviationstack, OpenSky).

#### Rate Limiting

The feature uses the existing rate-limiting mechanisms for external API calls.

### Maintenance

#### Cleaning Up Expired Updates

The `cleanupExpiredUpdates()` service should be run regularly (e.g. daily) to mark expired updates. This can be done via a cron job or manually.

#### Updating Statistics

`PendingUpdateStatistics` are updated automatically whenever updates are applied, rejected, or edited.

## Troubleshooting

### Updates are not being created

1. Check that auto-update is enabled in settings
2. Check that the flight is considered "active" (during flight time + buffer)
3. Check the API configurations (API keys, rate limits)
4. Check the server logs for errors

### Updates expire

- By default, updates expire after 24 hours
- This can be adjusted in the settings
- Expired updates can no longer be applied

### Statistics impact is inaccurate

- The impact is calculated based on all of the user's flights
- Make sure all flight data is correct
- The impact is recalculated on every edit

## Best Practices

1. **Review regularly**: Review pending updates regularly before they expire
2. **Edit before applying**: Use the edit function to adjust updates before applying them
3. **Check the statistics impact**: Always check the statistics impact before applying
4. **Tune the interval**: Adjust the check interval to your needs (more frequent checks = more API calls)

## Technical Details

### Change Detection

Changes are detected when:
- Fields are added or removed
- Field values change
- Timestamps differ by more than 5 minutes (configurable)

### Statistics Calculation

The statistics impact calculation takes into account:
- Total distance (based on coordinates)
- Total flight time
- Distinct airlines
- Distinct airports

### API Sources

The feature supports several API sources:
- AirLabs API
- Aviationstack API
- OpenSky Network API

The source is stored on every update and can be displayed in the UI.
