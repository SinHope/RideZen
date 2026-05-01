# RideZen

A personal vehicle fuel consumption and maintenance tracker built with React Native + Expo.

Track fuel logs, monitor maintenance schedules, get notified before things go overdue, and automatically track your riding distance — all stored locally on-device with no account required.

---

## Features

- **Multi-vehicle garage** — scooter, manual motorcycle, car, or other
- **Fuel logs** — log refuels, track average consumption (L/100km)
- **Maintenance tracking** — per-vehicle schedule seeded automatically by vehicle type; editable intervals, remarks, and next-due dates per item
- **Two-action service logging** — "Save" (update item settings only) or "Log Service" (create a history entry)
- **Service history** — last 5 service entries per maintenance item visible on the log screen
- **Tyre pairing** — Front Tyre and Rear Tyre displayed side-by-side in compact cards
- **Status badges** — overdue / due soon / urgent / all good, driven by user-configurable thresholds
- **User-configurable reminder thresholds** — early warning (km + days) and final reminder (km + days) stored in `app_settings` and applied across the whole app
- **Reminders** — two-stage push notifications (default: 1000 km / 14 days early, 200 km / 3 days final)
- **Odometer tracking** — Manual Ride Session (tap Start/End) or Always Auto-track (background GPS)
- **PDF export** — full vehicle report (vehicle info, fuel log, maintenance schedule) generated on-device via `expo-print` and shared as a PDF file
- **Privacy policy modal** — in-app scrollable privacy policy accessible from Settings
- **Animated UI** — Reanimated spring/timing animations throughout, animated splash screen, active ride glow on vehicle cards
- **Fully offline** — SQLite on-device, no backend, no account
- **Tutorial** *(planned)* — first-launch guided walkthrough of all major features

---

## Tech Stack

| Layer | Library |
|---|---|
| Framework | Expo ~55, React Native 0.83.4 |
| Navigation | Expo Router v6 (file-based) |
| Styling | NativeWind v4 (Tailwind CSS for RN) |
| Database | expo-sqlite ~16 (sync API) |
| PDF Generation | expo-print |
| File Sharing | expo-sharing, expo-file-system |
| GPS / Location | expo-location |
| Background Tasks | expo-task-manager |
| Notifications | expo-notifications |
| Fonts | Playfair Display + Inter (Google Fonts) |
| Icons | react-native-svg (custom SVG icon set) |

---

## Project Structure

```
app/
  (tabs)/
    index.tsx          # Home — garage overview, Start/End Ride button per vehicle card
    fuel.tsx           # Fuel logs
    maintenance.tsx    # Maintenance schedule with filter pills and tyre pairing
    settings.tsx       # App settings — tracking mode, reminder thresholds, export, privacy
  vehicle/
    add.tsx            # Add vehicle (2-step flow; Step 2 placeholders adapt to vehicle type; always triggers tracking onboarding)
    [id].tsx           # Edit / delete vehicle
  fuel/
    add/[vehicleId].tsx
  maintenance/
    log/[itemId].tsx   # Log service / save item settings — two-action header

src/
  components/
    VehicleCard.tsx              # Vehicle card — nickname + make·model·plate subtitle, Start/End Ride CTA, active glow state
    RideSessionButton.tsx        # Start/End Ride button (rendered inside VehicleCard)
    TrackingOnboardingModal.tsx  # 2-step tracking mode onboarding (shown on every vehicle add)
    AutoTrackBanner.tsx          # Banner shown when background location is revoked
    MaintenanceItemCard.tsx      # Standard + compact (tyre pair) variants
    ConfirmModal.tsx
    DueStatusBadge.tsx
    ErrorBoundary.tsx
    AnimatedSplash.tsx
    icons.tsx

  db/
    client.ts          # SQLite singleton
    migrations.ts      # Schema — V1 core tables, V2 app_settings, V3 new maintenance items
    seeds.ts           # Auto-seeds maintenance items by vehicle type on vehicle create

  hooks/
    useVehicles.ts
    useFuelLogs.ts
    useMaintenance.ts
    useRideSession.ts      # Start/stop foreground GPS session, accumulates distance
    useTrackingMode.ts     # Reads/writes mode, handles permission flows, launch recheck

  notifications/
    scheduler.ts

  repositories/
    vehicleRepo.ts         # includes updateOdometer()
    fuelRepo.ts
    maintenanceRepo.ts     # logService(), updateItem(), getHistory(), getByVehicle()
    reminderRepo.ts

  services/
    trackingPreferences.ts     # SQLite read/write for tracking_mode, onboarding flag, reminder thresholds
    rideSession.ts             # Haversine distance calc + odometer update (pure, no UI)
    backgroundLocationTask.ts  # TaskManager.defineTask() — registered at bundle load via _layout.tsx import

  types/
    index.ts                   # Vehicle, FuelLog, MaintenanceItem, ServiceLogInput, StatusThresholds, etc.

  utils/
    consumption.ts
    reminderCheck.ts     # computeMaintenanceStatus() — accepts StatusThresholds, loadStatusThresholds()
    export.ts            # exportAllDataAsPdf() — HTML → PDF via expo-print
    flags.ts             # One-shot in-memory cross-screen prompts
    cn.ts
    logger.ts
```

---

## Database Schema

### Migration history

| Version | Changes |
|---|---|
| V1 | Core tables: `vehicles`, `fuel_logs`, `maintenance_items`, `maintenance_logs`, `reminder_settings` |
| V2 | `app_settings` key-value table (tracking mode, onboarding flag) |
| V3 | Inserts Front Fork Servicing + Vehicle Wash into all existing vehicles |

### app_settings keys

| Key | Values | Description |
|---|---|---|
| `tracking_mode` | `manual` / `auto` | Current odometer tracking mode |
| `onboarding_tracking_shown` | `true` | Whether tracking onboarding has been shown at least once |
| `early_warning_km` | number (default: 1000) | km before due to trigger "due soon" status |
| `early_warning_days` | number (default: 14) | days before due to trigger "due soon" status |
| `final_reminder_km` | number (default: 200) | km before due to trigger "urgent" status |
| `final_reminder_days` | number (default: 3) | days before due to trigger "urgent" status |
| `auto_track_vehicle_id` | number | Vehicle ID currently assigned to auto-track mode |
| `bg_last_lat` / `bg_last_lon` | float | Last known GPS coordinate (persists background task restarts) |

---

## Maintenance Screen — Architecture

### Item status computation

`computeMaintenanceStatus(item, currentOdometer, thresholds?)` in `src/utils/reminderCheck.ts`:

- Accepts an optional `StatusThresholds` object `{ earlyKm, earlyDays, finalKm, finalDays }`
- If not provided, `loadStatusThresholds()` reads live values from `app_settings` (with hardcoded fallbacks)
- Status hierarchy: `overdue > urgent > due > ok`
- Both km-based and date-based triggers are evaluated; the higher severity wins

### Service log vs. save-only

The `maintenance/log/[itemId].tsx` screen has two distinct actions:

| Action | What it does |
|---|---|
| **Save** | Updates `maintenance_items` only (interval, next due date, remarks). No history entry created. |
| **Log Service** | Inserts a row into `maintenance_logs` AND updates `maintenance_items` (recalculates next due based on current odometer + interval). |

Both actions show a confirmation dialog before executing.

### Tyre pairing

When both `Front Tyre` and `Rear Tyre` exist in the same status section, `groupSectionItems()` in `maintenance.tsx` renders them side-by-side using compact card variants. If only one tyre exists in a section, it renders full-width.

### Seeded items by vehicle type

| Category | Scooter | Manual Bike | Car | Universal |
|---|---|---|---|---|
| Engine Oil | ✓ | ✓ | ✓ | |
| Air Filter | ✓ | ✓ | ✓ | |
| Spark Plug | ✓ | ✓ | ✓ | |
| Brake Fluid | ✓ | ✓ | ✓ | |
| Battery | ✓ | ✓ | ✓ | |
| Coolant | ✓ | | ✓ | |
| Chain Lubrication | | ✓ | | |
| Chain Adjustment | | ✓ | | |
| Chain Replacement | | ✓ | | |
| Clutch Cable | | ✓ | | |
| Front Tyre | ✓ | ✓ | ✓ | |
| Rear Tyre | ✓ | ✓ | ✓ | |
| Front Fork Servicing | | | | ✓ |
| Vehicle Wash | | | | ✓ |

---

## Odometer Tracking — Architecture

### How it works

| Mode | How | Battery |
|---|---|---|
| Manual Ride Session | Tap Start before riding, tap End when done. GPS runs only during session. | Low |
| Auto-track always | GPS background task accumulates distance silently. Odometer updates without any user action. | Higher |

### Tracking mode storage

Mode and related preferences stored in the `app_settings` SQLite table (migration V2). See [app_settings keys](#app_settings-keys) above.

### What connects to what

```
trackingPreferences.ts (SQLite app_settings)
  ← read/written by: useTrackingMode.ts, settings.tsx
  ← read by: backgroundLocationTask.ts (verify mode is still 'auto' before accumulating)

rideSession.ts (pure service — haversine + odometer update)
  ← uses: vehicleRepo.updateOdometer()
  ← called by: useRideSession.ts (foreground Manual mode)
  ← called by: backgroundLocationTask.ts (background Auto mode)
  NOTE: Must be a plain service, not a hook — background tasks have no React context

backgroundLocationTask.ts
  ← uses: trackingPreferences.ts, rideSession.ts
  ← MUST be imported by: app/_layout.tsx at module level
    (the import itself registers the task before any screen renders)

useRideSession.ts
  ← uses: rideSession.ts, expo-location watchPositionAsync
  ← consumed by: VehicleCard (via props from HomeScreen)

useTrackingMode.ts
  ← uses: trackingPreferences.ts, expo-location permissions, expo-task-manager
  ← consumed by: settings.tsx, TrackingOnboardingModal.tsx

TrackingOnboardingModal.tsx
  ← triggered by: setTrackingOnboardingPending() in vehicle/add.tsx on EVERY vehicle save
  ← resets to Step 1 each time it opens (useEffect on visible prop)
  ← after completion: maintenance prompt is shown if pending

AutoTrackBanner.tsx
  ← shown when: useTrackingMode detects background permission revoked on launch
```

### Background task explained

`backgroundLocationTask.ts` defines a named task the OS calls every 10+ metres of movement. When auto-track is enabled:

1. User rides. Phone GPS detects movement.
2. OS wakes the app's background task (even with screen off).
3. Task calculates distance from last known coordinate (haversine).
4. Distance added to the vehicle's odometer in SQLite.
5. Task sleeps until the next GPS update.

The task must be defined at **module top-level** — not inside a component or hook. Importing `backgroundLocationTask.ts` in `_layout.tsx` ensures registration happens the moment the JS bundle loads.

### Permission flow

**iOS:** Two separate OS dialogs. `requestForegroundPermissionsAsync()` first, then `requestBackgroundPermissionsAsync()`.

**Android 12+ hibernation:** Permissions may be reset after months of non-use. On every launch: re-check permission status AND task registration. If permission is granted but task is not running, restart silently.

**iOS silent revocation:** Apple can silently downgrade "Always Allow". Detected on launch — fall back to Manual with `AutoTrackBanner.tsx`.

---

## PDF Export

`exportAllDataAsPdf(vehicleId, vehicleNickname)` in `src/utils/export.ts`:

1. Fetches vehicle info, all fuel logs, all maintenance items and their full service histories concurrently
2. Builds an HTML string with inline CSS (vehicle stats grid, fuel log table, maintenance schedule table)
3. Calls `expo-print`'s `printToFileAsync({ html })` to generate a `.pdf` file
4. Moves the file to `expo-file-system`'s cache directory with a dated filename
5. Shares via `expo-sharing`'s native share sheet
6. Deletes the temp file after sharing

---

## Settings Screen

| Setting | Behaviour |
|---|---|
| Odometer Tracking | Card selector — Manual Ride Session vs Auto-track Always. Handles full permission flow. |
| Push notifications | Toggle (Switch). Enables/disables scheduled reminders. |
| Default early warning | Opens edit modal. Saves `early_warning_km` + `early_warning_days` to `app_settings`. Displayed as current values in sub-text. |
| Default final reminder | Opens edit modal. Saves `final_reminder_km` + `final_reminder_days` to `app_settings`. |
| Export data | Calls `exportAllDataAsPdf()`. Shows "Generating PDF…" while in progress. |
| Privacy | Opens full in-app scrollable privacy policy modal. |
| RideZen Pro | Coming Soon badge. |

Reminder threshold changes take effect immediately on next maintenance list load (no app restart needed).

---

## Planned Features

### First-Launch Tutorial

A guided walkthrough shown once on first app open (before any vehicle is added), controlled by a `tutorial_shown` flag in `app_settings`.

**Proposed format:** Full-screen swipeable slides (4–5 screens) with a "Skip" link on every slide.

**Proposed slides:**

| Slide | Title | Content |
|---|---|---|
| 1 | Welcome to RideZen | App overview — offline, private, no account needed |
| 2 | My Garage | Multi-vehicle overview, odometer, maintenance status at a glance |
| 3 | Odometer Tracking | Manual Ride Session vs Auto-track — when to use each |
| 4 | Maintenance | Status badges, due soon / overdue, logging a service |
| 5 | Fuel Log *(optional)* | Logging refuels, tracking L/100km and monthly spend |
| Final | Let's add your first vehicle | CTA to `/vehicle/add`, Skip lands on empty home screen |

**Behaviour:**
- Skippable at any point via small "Skip for now" link
- Swipeable left/right with dot indicator
- After completion or skip: `tutorial_shown = true` in `app_settings`, never shown again
- Runs before the "Add vehicle" flow, not inside it

---

## Design System

| Token | Value | Usage |
|---|---|---|
| zen-primary | `#1B6CA8` | Primary blue — headers, buttons |
| zen-secondary | `#2D6A4F` | Green — confirm actions, OK status |
| zen-gold | `#F4A035` | Gold — cancel actions, warnings |
| zen-bg | `#F0F8FF` | Background |
| Danger | `#E53E3E` | Destructive actions, End Ride button |
| Tracking active | `#22C55E` | Live ride glow, distance counter, LIVE dot |

Fonts: **Playfair Display** (headings) + **Inter** (body)

### Maintenance status colours

| Status | Colour |
|---|---|
| overdue | `#CC0000` |
| urgent | `#B45309` |
| due | `#C45E0A` |
| ok | `#1B6CA8` |

---

## Getting Started

### Prerequisites

- Node.js 20 (pinned via Volta — `volta pin node@20` in project root)
- Expo CLI (`npm install -g expo`)
- EAS CLI (`npm install -g eas-cli`)
- Android Studio + Android SDK (for local emulator)
- Visual C++ 2015–2022 Redistributable x64 (Windows — required for `lightningcss` native binary)

### Environment setup (Windows)

Add to `~/.bashrc`:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="/c/Users/<you>/AppData/Local/Android/Sdk"
```

After every `npx expo prebuild --clean`, recreate `android/local.properties`:

```
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

### Install

```bash
npm install
```

### Run on emulator (day-to-day development)

Start Android Studio emulator, then:

```bash
npx expo start
# press 'a' to open on Android emulator
```

> Only run `npx expo run:android` when native config changes (new native modules, `app.json` plugin changes). Metro hot-reload handles all JS/TS changes.

### First-time or after native config changes

```bash
npx expo run:android
```

---

## Building for Production

```bash
eas build --profile production --platform android
```

---

## Notes

- All data is stored locally in SQLite — uninstalling the app deletes everything permanently
- Maintenance items are auto-seeded on vehicle create (`src/db/seeds.ts`) based on vehicle type
- `src/utils/flags.ts` handles one-shot cross-screen prompts (maintenance setup prompt, tracking onboarding)
- Reminder threshold changes in Settings take effect on the next maintenance list load
- GPS accuracy vs. wheel odometer: ~2–5% drift per trip using `Accuracy.Balanced` — acceptable for maintenance interval tracking
- Background location requires a fresh EAS dev build after `app.json` permission entries are added
