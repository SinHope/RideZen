# RideZen

A personal vehicle fuel consumption and maintenance tracker built with React Native + Expo.

Track fuel logs, monitor maintenance schedules, get notified before things go overdue, and automatically track your riding distance — all stored locally on-device with no account required.

---

## Features

- **Multi-vehicle garage** — scooter, manual motorcycle, car, or other
- **Fuel logs** — log refuels, track average consumption (L/100km)
- **Maintenance tracking** — per-vehicle schedule seeded automatically by vehicle type (engine oil, chain, tyres, etc.)
- **Status badges** — overdue / due soon / all good at a glance
- **Reminders** — two-stage push notifications (1000km/14 days early, 200km/3 days final)
- **Odometer tracking** — Manual Ride Session (tap Start/End) or Always Auto-track (background GPS)
- **Animated UI** — Reanimated spring/timing animations throughout, animated splash screen, active ride glow on vehicle cards
- **Fully offline** — SQLite on-device, no backend, no account

---

## Tech Stack

| Layer | Library |
|---|---|
| Framework | Expo ~54, React Native 0.81.5 |
| Navigation | Expo Router v4 (file-based) |
| Styling | NativeWind v4 (Tailwind CSS for RN) |
| Animations | react-native-reanimated ~4.1.1 |
| Database | expo-sqlite ~16 (sync API) |
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
    maintenance.tsx    # Maintenance schedule
    settings.tsx       # App settings (includes Odometer Tracking section)
  vehicle/
    add.tsx            # Add vehicle (2-step flow, triggers tracking onboarding on first vehicle)
    [id].tsx           # Edit / delete vehicle
  fuel/add/[vehicleId].tsx
  maintenance/log/[itemId].tsx

src/
  components/
    VehicleCard.tsx          # Vehicle card — includes Start/End Ride CTA + active glow state
    RideSessionButton.tsx    # Start/End Ride button (rendered inside VehicleCard)
    TrackingOnboardingModal.tsx  # 2-step first-vehicle tracking mode onboarding
    AutoTrackBanner.tsx      # Banner shown when background location is revoked
    MaintenanceItemCard.tsx
    ConfirmModal.tsx
    ErrorBoundary.tsx
    AnimatedSplash.tsx
    icons.tsx

  db/
    client.ts          # SQLite singleton
    migrations.ts      # Schema — 5 business tables + app_settings (V2)
    seeds.ts           # Auto-seeds maintenance items by vehicle type

  hooks/
    useVehicles.ts
    useFuelLogs.ts
    useMaintenance.ts
    useRideSession.ts      # Start/stop foreground GPS session, accumulates distance
    useTrackingMode.ts     # Reads/writes mode, handles permission flows, launch recheck

  notifications/
    scheduler.ts

  repositories/
    vehicleRepo.ts       # includes updateOdometer()
    fuelRepo.ts
    maintenanceRepo.ts
    reminderRepo.ts

  services/
    trackingPreferences.ts     # SQLite read/write for tracking_mode + onboarding flag
    rideSession.ts             # Haversine distance calc + odometer update (pure, no UI)
    backgroundLocationTask.ts  # TaskManager.defineTask() — registered at bundle load via _layout.tsx import

  types/
    index.ts

  utils/
    consumption.ts
    reminderCheck.ts
    export.ts
    flags.ts       # One-shot in-memory cross-screen prompts
    cn.ts
    logger.ts
```

---

## Odometer Tracking — Architecture

### How it works

The app offers two odometer tracking modes, chosen by the user on first vehicle add:

| Mode | How | Battery |
|---|---|---|
| Manual Ride Session | Tap Start before riding, tap End when done. GPS runs only during session. | Low |
| Auto-track always | GPS background task accumulates distance silently. Odometer updates without any user action. | Higher |

### Tracking mode storage

Mode and onboarding flag are stored in the `app_settings` SQLite table (migration V2):

| Key | Values |
|---|---|
| `tracking_mode` | `'manual'` (default) or `'auto'` |
| `onboarding_tracking_shown` | `'true'` |

### What connects to what

```
trackingPreferences.ts (SQLite app_settings)
  ← read/written by: useTrackingMode.ts
  ← read by: backgroundLocationTask.ts (verify mode is still 'auto' before accumulating)
  ← read by: app/_layout.tsx (launch permission recheck)

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
  ← consumed by: RideSessionButton.tsx (rendered inside VehicleCard per vehicle)

useTrackingMode.ts
  ← uses: trackingPreferences.ts, expo-location permissions, expo-task-manager
  ← consumed by: settings.tsx, TrackingOnboardingModal.tsx, app/_layout.tsx

RideSessionButton.tsx
  ← uses: useRideSession.ts
  ← rendered by: VehicleCard.tsx (one button per card, Option A design)
  ← visible only when mode = 'manual'

TrackingOnboardingModal.tsx
  ← uses: useTrackingMode.ts, trackingPreferences.ts
  ← rendered by: app/(tabs)/index.tsx
  ← triggered by: setMaintenancePromptPending-style flag after first vehicle save in vehicle/add.tsx

AutoTrackBanner.tsx
  ← rendered by: app/(tabs)/index.tsx
  ← shown when: useTrackingMode detects background permission was revoked on launch

app/_layout.tsx
  ← imports backgroundLocationTask.ts (side-effect registers task before navigation)
  ← runs launch recheck: if saved mode = 'auto', verify permission + task still registered

app/vehicle/add.tsx
  ← after first vehicle save: set flag to show TrackingOnboardingModal on Home
```

### Background task explained

`backgroundLocationTask.ts` defines a named task that the OS calls every time the phone moves 10+ metres. When auto-track mode is enabled:

1. User rides. Phone GPS detects movement.
2. OS wakes up the app's background task (even with screen off).
3. The task calculates distance from last known coordinate (haversine formula).
4. Distance is added to the vehicle's odometer in SQLite.
5. Task sleeps until the next GPS update.

The task must be defined at **module top-level** (not inside a component or hook). The OS may attempt to wake the task before React mounts. If the handler isn't registered yet, the update is silently dropped. Importing `backgroundLocationTask.ts` in `_layout.tsx` ensures registration happens the moment the JS bundle loads.

### Expo managed workflow — important build notes

- Background location requires `expo-location` and `expo-task-manager` added to dependencies
- `app.json` must be updated with:
  - `ios.infoPlist`: `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocationAlwaysUsageDescription`, `NSLocationWhenInUseUsageDescription`
  - `ios.infoPlist.UIBackgroundModes`: `["location"]`
  - `android.permissions`: `["ACCESS_BACKGROUND_LOCATION"]`
- These config changes require a **new EAS dev build** — `npx expo start --dev-client` alone is not enough

### Permission flow

**iOS:** Two separate OS dialogs. `requestForegroundPermissionsAsync()` first (grants "While Using"). Then `requestBackgroundPermissionsAsync()` separately (upgrades to "Always"). Cannot be batched.

**Android 12+ hibernation:** Android may reset permissions if app isn't used for months. On every launch, re-check both permission status (`getBackgroundPermissionsAsync()`) AND task registration status (`TaskManager.isTaskRegisteredAsync()`). If permission is granted but task is not running, restart the task silently.

**iOS silent revocation:** Apple can silently downgrade "Always Allow" after extended non-use. Detected on launch — fall back to Manual with `AutoTrackBanner.tsx`.

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

### Vehicle card — Start/End Ride design

**Idle (Start Ride button):**
- Full-width pill inside card, below stats row, height 44px
- `backgroundColor: rgba(255,255,255,0.95)`, text color = card's own `cardColor`
- Inter SemiBold 13px + route icon left

**Active tracking (card glow):**
- Border: `2.5px solid #22C55E`, opacity pulsing `0.55 ↔ 1.0`, 1400ms ease-in-out
- Shadow: `shadowColor: #22C55E`, opacity pulsing `0.25 ↔ 0.65`, 1400ms
- Live counter row: pulsing green dot + "LIVE" label + `+X.X km` (Inter SemiBold 17px, `#22C55E`)
- End Ride button: `backgroundColor: #E53E3E`, white text, spring entrance from scale 0.85

---

## Getting Started

### Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo`)
- Android Studio + Android SDK (for Android builds)
- EAS CLI (`npm install -g eas-cli`) — required for cloud builds on Windows

### Install

```bash
npm install --legacy-peer-deps
```

### Run (requires a dev build — Expo Go is not supported)

First-time setup: build the dev client APK via EAS:

```bash
eas build --profile development --platform android
```

Once the APK is installed on your device:

```bash
npx expo start --dev-client
```

> **Windows users:** This project's native dependencies exceed the 260-character MAX_PATH limit.
> Use EAS cloud builds instead of `npx expo run:android`.

---

## Building for Production

```bash
eas build --profile production --platform android
```

---

## Notes

- All data is stored locally in SQLite — uninstalling the app deletes all data
- Maintenance items are auto-seeded when a vehicle is created, based on its type
- `src/utils/flags.ts` handles one-shot cross-screen prompts (maintenance setup prompt, tracking onboarding trigger)
- Background location tracking requires a fresh EAS dev build after `app.json` permission entries are added
- GPS distance accuracy vs. wheel odometer: ~2-5% drift per trip using `Accuracy.Balanced` — acceptable for maintenance interval tracking
