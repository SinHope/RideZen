# RideZen

A personal vehicle fuel consumption and maintenance tracker built with React Native + Expo.

Track fuel logs, monitor maintenance schedules, and get notified before things go overdue — all stored locally on-device with no account required.

---

## Features

- **Multi-vehicle garage** — scooter, manual motorcycle, car, or other
- **Fuel logs** — log refuels, track average consumption (L/100km)
- **Maintenance tracking** — per-vehicle schedule seeded automatically by vehicle type (engine oil, chain, tyres, etc.)
- **Status badges** — overdue / due soon / all good at a glance
- **Reminders** — two-stage push notifications (1000km/14 days early, 200km/3 days final)
- **Animated UI** — Reanimated spring/timing animations throughout, animated splash screen
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
| Notifications | expo-notifications |
| Fonts | Playfair Display + Inter (Google Fonts) |
| Icons | react-native-svg (custom SVG icon set) |

---

## Project Structure

```
app/
  (tabs)/
    index.tsx          # Home — garage overview
    fuel.tsx           # Fuel logs
    maintenance.tsx    # Maintenance schedule
    settings.tsx       # App settings
  vehicle/
    add.tsx            # Add vehicle (2-step flow)
    [id].tsx           # Edit / delete vehicle
  fuel/add/[vehicleId].tsx
  maintenance/log/[itemId].tsx

src/
  components/          # VehicleCard, MaintenanceItemCard, ConfirmModal, icons, etc.
  db/                  # SQLite client, migrations, seeds
  hooks/               # useVehicles, useFuelLogs, useMaintenance
  notifications/       # Reminder scheduler
  repositories/        # vehicleRepo, fuelRepo, maintenanceRepo, reminderRepo
  types/               # TypeScript interfaces
  utils/               # consumption, reminderCheck, export, flags
```

---

## Design System

| Token | Value | Usage |
|---|---|---|
| zen-primary | `#1B6CA8` | Primary blue — headers, buttons |
| zen-secondary | `#2D6A4F` | Green — confirm actions, OK status |
| zen-gold | `#F4A035` | Gold — cancel actions, warnings |
| zen-bg | `#F0F8FF` | Background |
| Danger | `#E53E3E` | Destructive actions |

Fonts: **Playfair Display** (headings) + **Inter** (body)

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
- The `src/utils/flags.ts` module handles one-shot cross-screen prompts (e.g. the maintenance setup prompt after adding a new vehicle)
