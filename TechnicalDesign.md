# RideZen — Technical Design Document

**Version:** 1.2.0  
**Last updated:** May 2026  
**Author:** TulusNas Software Studio

---

## 1. Overview

RideZen is a fully offline, privacy-first motorcycle maintenance and odometer tracking app built with React Native and Expo. All data is stored locally on-device via SQLite. No accounts, no cloud sync, no analytics.

**Target platforms:** Android (primary), iOS (planned)  
**Target users:** Motorcycle and scooter owners in Singapore and Southeast Asia

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    UI Layer                          │
│  app/(tabs)/*.tsx   app/vehicle/*.tsx                │
│  app/fuel/*.tsx (add, edit)  app/maintenance/*.tsx   │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│                 Hooks / Context                      │
│  useVehicles  useFuelLogs  useMaintenance            │
│  useRideSession  useTrackingMode                     │
│  RideSessionContext (app-level)                      │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│               Repository Layer                       │
│  vehicleRepo  fuelRepo  maintenanceRepo              │
│  reminderRepo                                        │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│                Service Layer                         │
│  rideSession.ts (haversine + odometer update)        │
│  trackingPreferences.ts (app_settings R/W)           │
│  backgroundLocationTask.ts (OS background task)      │
│  currencyService.ts (exchange rates, conversion)     │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              Database Layer                          │
│  expo-sqlite (sync API)  ·  ridezen.db               │
│  Migrations V1 → V3  ·  Seeds per vehicle type       │
└─────────────────────────────────────────────────────┘
```

---

## 3. Database Schema

### 3.1 Tables

#### `vehicles`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| nickname | TEXT | Required |
| type | TEXT | `scooter`, `manual_bike`, `car`, `other` |
| make | TEXT | Optional |
| model | TEXT | Optional |
| year | INTEGER | Optional |
| plate_number | TEXT | Optional |
| photo_uri | TEXT | Optional |
| current_odometer | REAL | Updated after each ride |
| created_at | TEXT | ISO datetime |
| updated_at | TEXT | ISO datetime |

#### `fuel_logs`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| vehicle_id | INTEGER FK | CASCADE delete |
| date | TEXT | YYYY-MM-DD |
| odometer | REAL | |
| litres | REAL | |
| price_per_litre | REAL | Optional |
| currency | TEXT | ISO 4217 code, e.g. `SGD`, `MYR`. Default `'SGD'`. Added in V4 migration. |
| is_full_tank | INTEGER | 1 = full, 0 = partial |
| notes | TEXT | Optional |
| km_since_last | REAL | Computed on insert and update |
| consumption | REAL | L/100km, computed on insert and update |
| created_at | TEXT | |

#### `maintenance_items`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| vehicle_id | INTEGER FK | CASCADE delete |
| category | TEXT | e.g. "Engine Oil" |
| vehicle_type_scope | TEXT | `universal`, `scooter`, `manual_bike`, `car` |
| last_changed_date | TEXT | Date of last service |
| last_changed_odo | REAL | Odometer at last service |
| next_due_date | TEXT | Optional calendar due date |
| next_due_odo | REAL | Computed or manually set |
| interval_km | REAL | Service interval in km |
| interval_days | INTEGER | Service interval in days |
| notes | TEXT | Persistent remarks (not per-log) |
| updated_at | TEXT | |

#### `maintenance_logs`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| item_id | INTEGER FK | CASCADE delete |
| vehicle_id | INTEGER FK | CASCADE delete |
| date | TEXT | Service date |
| odometer | REAL | Odometer at service |
| cost | REAL | Optional |
| workshop | TEXT | Optional |
| notes | TEXT | Per-service notes (separate from item remarks) |
| created_at | TEXT | |

#### `reminder_settings`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| item_id | INTEGER FK | CASCADE delete |
| early_km_before | REAL | |
| early_days_before | INTEGER | |
| early_enabled | INTEGER | 1 = on |
| final_km_before | REAL | |
| final_days_before | INTEGER | |
| final_enabled | INTEGER | 1 = on |

#### `app_settings`
| Column | Type | Notes |
|---|---|---|
| key | TEXT PK | |
| value | TEXT | |
| updated_at | TEXT | |

**Known keys:**

| Key | Default | Description |
|---|---|---|
| `tracking_mode` | `manual` | `manual` or `auto` |
| `onboarding_tracking_shown` | — | `true` once shown |
| `early_warning_km` | `1000` | km threshold for "due soon" |
| `early_warning_days` | `14` | days threshold for "due soon" |
| `final_reminder_km` | `200` | km threshold for "urgent" |
| `final_reminder_days` | `3` | days threshold for "urgent" |
| `auto_track_vehicle_id` | — | Vehicle ID for auto-track |
| `bg_last_lat` / `bg_last_lon` | — | Last GPS coordinate |
| `tutorial_shown` | — | `true` once first-launch tutorial is completed or skipped |
| `home_currency` | `SGD` | ISO 4217 code for the user's home currency |
| `exchange_rates_json` | — | Cached exchange rates JSON blob |
| `exchange_rates_base` | — | Base currency the cached rates are relative to |
| `exchange_rates_cached_at` | — | ISO datetime of last rates fetch |
| `recent_currencies` | — | JSON array of up to 3 recently used currency codes |

### 3.2 Migration history

| Version | Description |
|---|---|
| V1 | Core tables: vehicles, fuel_logs, maintenance_items, maintenance_logs, reminder_settings |
| V2 | `app_settings` key-value store |
| V3 | Inserts Front Fork Servicing + Vehicle Wash into all existing vehicles |
| V4 (DB ver 5) | `ALTER TABLE fuel_logs ADD COLUMN currency TEXT DEFAULT 'SGD'` |

### 3.3 Seeded maintenance items

Items are inserted by `src/db/seeds.ts` when a vehicle is created.

| Category | Scope | Default Interval |
|---|---|---|
| Engine Oil | scooter, manual_bike, car | 3,000 km / 90 days |
| Air Filter | scooter, manual_bike, car | 10,000 km / 180 days |
| Spark Plug | scooter, manual_bike, car | 10,000 km / 365 days |
| Brake Fluid | scooter, manual_bike, car | — / 730 days |
| Battery | scooter, manual_bike, car | — / 730 days |
| Coolant | scooter, car | — / 730 days |
| Chain Lubrication | manual_bike | 1,000 km |
| Chain Adjustment | manual_bike | 2,500 km |
| Chain Replacement | manual_bike | 18,000 km |
| Clutch Cable Inspection | manual_bike | 10,000 km |
| Front Tyre | scooter, manual_bike, car | 20,000 km |
| Rear Tyre | scooter, manual_bike, car | 15,000 km |
| Front Fork Servicing | universal | 24,000 km / 360 days |
| Vehicle Wash | universal | None |

---

## 4. Maintenance Status Computation

### 4.1 `computeMaintenanceStatus(item, currentOdometer, thresholds?)`

Located in `src/utils/reminderCheck.ts`.

**Status hierarchy:** `overdue > urgent > due > ok`

**Km-based logic:**
```
if km_remaining <= 0           → overdue
if km_remaining <= finalKm     → urgent
if km_remaining <= earlyKm     → due
else                           → ok
```

**Date-based logic:**
```
if days_remaining < 0          → overdue
if days_remaining <= finalDays → urgent
if days_remaining <= earlyDays → due
else                           → ok
```

The higher severity between km and date wins.

**`StatusThresholds` interface:**
```typescript
{
  earlyKm: number;    // default 1000
  earlyDays: number;  // default 14
  finalKm: number;    // default 200
  finalDays: number;  // default 3
}
```

`loadStatusThresholds()` reads live values from `app_settings` with hardcoded fallbacks. Called in `maintenanceRepo.getByVehicle()` and in the log screen.

### 4.2 Progress bar

Progress percentage (`progress_pct`) is computed as:
```
km:   (interval_km - max(km_remaining, 0)) / interval_km × 100
date: (interval_days - max(days_remaining, 0)) / interval_days × 100
```
The higher of the two is used.

---

## 5. Odometer Tracking

### 5.1 Manual Ride Session

- User taps "Start Ride" on a vehicle card
- `useRideSession` starts `expo-location`'s `watchPositionAsync` in the foreground
- Each GPS update calls `rideSession.ts` to accumulate distance (haversine formula)
- When user taps "End Ride", `rideSession.ts` calls `vehicleRepo.updateOdometer()` to persist
- Context: `RideSessionContext` — app-level, survives tab navigation

### 5.2 Auto-track (Background GPS)

- `backgroundLocationTask.ts` defines a named task (`RIDEZEN_BG_LOCATION`) using `expo-task-manager`
- The OS calls this task every time the device moves 10+ metres (even with screen off)
- Each call: reads last known coords from `app_settings`, computes distance via haversine, updates odometer in SQLite
- **Critical:** the task must be defined at module top-level before any React component mounts. Importing `backgroundLocationTask.ts` in `_layout.tsx` achieves this.

### 5.3 Permission flow

```
switchToAuto(vehicleId):
  1. requestForegroundPermissionsAsync()
     → denied: return 'foreground_denied' or 'foreground_never_ask'
  2. requestBackgroundPermissionsAsync()
     → denied: return 'background_only_while_using' or 'background_never_ask'
  3. startLocationUpdatesAsync(TASK, options)
     → failed: return 'background_denied'
  4. setTrackingMode('auto'), setAutoTrackVehicleId(vehicleId)
     → return 'granted'
```

### 5.4 Launch recheck

On every app launch, if saved mode is `auto`:
1. Check `getBackgroundPermissionsAsync()` — if revoked: fall back to manual + show `AutoTrackBanner`
2. Check `TaskManager.isTaskRegisteredAsync()` — if not running: try to restart silently
3. If restart fails: fall back to manual + show `AutoTrackBanner`

---

## 6. PDF Export

### 6.1 `exportAllDataAsPdf(vehicleId, vehicleNickname)`

Located in `src/utils/export.ts`.

**Steps:**
1. Fetch vehicle, all fuel logs, all maintenance items, and service history per item (concurrent `Promise.all`)
2. Build HTML string with inline CSS (vehicle stats grid, fuel log table, maintenance table)
3. `Print.printToFileAsync({ html })` → generates temp PDF file
4. Move to `FileSystem.cacheDirectory` with dated filename — **⚠️ `FileSystem.moveAsync()` is deprecated** (see known issue below)
5. `Sharing.shareAsync()` → native share sheet
6. `FileSystem.deleteAsync()` → clean up cache

> **Known issue:** `FileSystem.moveAsync()` from `expo-file-system` is deprecated as of Expo SDK 54+. Metro prints a warning on every app start. The function still works; no user-facing impact. Pending fix: replace with the new `File` / `Directory` class API from `expo-file-system`.

**PDF sections:**
- Header: vehicle name + export date
- Stats grid: vehicle details, current odometer, total fuel cost
- Fuel log table: date, odometer, litres, price/L, consumption, notes
- Maintenance table: item, status, next due, last serviced, service count
- Footer: app/studio attribution

---

## 7. Settings

### 7.1 Reminder thresholds

Saved to `app_settings` via `setAppSetting(key, value)`. Read by `loadStatusThresholds()` in `reminderCheck.ts` on every maintenance data load. Changes take effect immediately on next list refresh — no app restart required.

### 7.2 Tracking mode selector

A custom two-card selector (Manual / Auto) that runs the full permission flow when switching to Auto. The Home screen and Settings screen both sync their displayed mode from `getTrackingMode()` on focus.

### 7.3 Privacy policy

Fully in-app. No external URL. 7 sections: data storage, location data, no accounts, no analytics, export, data deletion, contact.

---

## 8. User Flows

### 8.1 Add vehicle flow
```
/vehicle/add (Step 1: select type)
  → /vehicle/add (Step 2: enter details)
      — placeholders adapt to selected type:
        car          → Vehicle Name "My Personal Car", Make "e.g. Hyundai", Model "e.g. Kona"
        scooter /
        manual_bike  → Plate Number "e.g. FBR1234C"
        other        → default motorcycle-style placeholders
  → Confirm modal
  → setMaintenancePromptPending() + setTrackingOnboardingPending()
  → router.replace('/(tabs)')
  → TrackingOnboardingModal (2 steps: choose mode → explanation + privacy)
  → onComplete → "Set up maintenance?" ConfirmModal
  → /(tabs)/maintenance (if user taps Let's go)
```

### 8.2 Log a service
```
/(tabs)/maintenance → tap item card
  → /maintenance/log/[itemId]
  → Edit interval / next due date / remarks
  → "Save" → confirm → updateItem() → back
  OR
  → "Log Service" → confirm → logService() → back
```

### 8.3 Ride session (manual)
```
Home → tap "Start Ride" on vehicle card
  → Alert: "Tap End Ride when done"
  → [riding — GPS accumulating distance]
  → tap "End Ride"
  → endRide() → updateOdometer()
  → Alert: "Ride saved!"
  → reload() refreshes odometer display
```

### 8.4 Edit / delete a fuel log
```
/(tabs)/fuel → tap "⋮" on a fuel log card
  → Alert: Edit | Delete (destructive) | Cancel
  → Edit → /fuel/edit/[logId] (modal)
       Pre-filled: date, odometer, litres, price/L, currency, full-tank, notes
       Save → fuelRepo.update(id, input) → recalculates km_since_last + consumption
            → router.back() → useFocusEffect reloads list
  → Delete → fuelRepo.delete(id) → list reloads immediately
```

### 8.5 VehicleCard — subtitle line

Below the vehicle nickname, `VehicleCard` renders a single subtitle line joining `make`, `model`, and `plate_number` with `·` separators. The line is only rendered when at least one of the three fields is populated (`vehicle.make || vehicle.model || vehicle.plate_number`). Style: `fontSize: 11`, `color: rgba(255,255,255,0.60)`, `Inter_400Regular`.

---

## 9. Key Components

### 9.1 First-Launch Tutorial (`TutorialModal`)

**Trigger:** `tutorial_shown` absent from `app_settings`. Shown once after splash screen.

**Format:** Full-screen FlashList with `pagingEnabled`, dot indicators, Skip / Next / CTA actions. `setTutorialShown()` called on complete or skip.

**Slides:** Welcome → My Garage → Odometer Tracking → Maintenance → Fuel Log → Final CTA ("Add my first vehicle" → `/vehicle/add`)

### 9.2 Currency Service (`currencyService.ts`)

Single file containing all exchange-rate logic. **To switch API providers: edit only `buildUrl()` and `parseResponse()`.**

**Provider:** ExchangeRate-API (`https://v6.exchangerate-api.com/v6/{key}/latest/{base}`)  
**Cache:** 24 h TTL in `app_settings`. App stays fully offline if cache is warm.  
**Conversion formula:** `(amount / rates[from]) * rates[to]`

**Public API:**
```typescript
getRates(base?)           // cache-first, async
convert(amount, from, to, rates)
getHomeCurrency() / setHomeCurrency(code)
getRecentCurrencies() / addRecentCurrency(code)  // max 3, stored in app_settings
SUPPORTED_CURRENCIES      // 162 CurrencyInfo[]  { code, name, country }
```

### 9.3 Currency Picker (`CurrencyPickerModal`)

Full-screen searchable modal (FlashList, 162 items). Search filters by code, name, or country. **Most Recent** section (max 3 entries) rendered above the full list as plain `View` — not `ListHeaderComponent` — to avoid FlashList layout issues. Recents persist across sessions in `app_settings`.

### 9.4 Date Wheel Picker (`DateWheelPickerModal`)

3-column `ScrollView`-based wheel picker (Day | Month | Year). No extra packages.

- **Snap:** `snapToInterval={ITEM_H}`, `decelerationRate="fast"` (iOS) / `0.9` (Android)
- **Cross-platform scroll end:** both `onMomentumScrollEnd` and `onScrollEndDrag` handled and deduplicated via a `committed` ref — covers Android's low-velocity case where momentum never fires
- **Day clamping:** `daysInMonth(month, year)` recalculated on month/year change; day index clamped and ScrollView scrolled programmatically
- **Gradient mask:** 4 stacked semi-transparent white `View` bands at top and bottom — simulates a gradient without `expo-linear-gradient`
- **Selection strip:** absolute `View` with blue-tinted background and hairline borders at the centre slot
- Opens as a bottom-sheet `Modal` (`animationType="slide"`, transparent backdrop). Cancel dismisses; Done formats to `YYYY-MM-DD`.

---

## 11. Build Notes

### 11.1 Development (Windows)

```bash
# Day-to-day — Metro hot reload, no rebuild needed
npx expo start
# press 'a' for Android emulator

# Only needed after native config changes (new plugins, new native modules)
npx expo run:android
```

Required environment:
- Volta + Node 20.x (`volta pin node@20`)
- Java: Android Studio JBR (`JAVA_HOME=/c/Program Files/Android/Android Studio/jbr`)
- Android SDK (`ANDROID_HOME=/c/Users/<user>/AppData/Local/Android/Sdk`)
- Visual C++ 2015–2022 Redistributable x64 (for `lightningcss` native binary)
- `android/local.properties` must be manually created after each `npx expo prebuild --clean`

### 11.2 EAS Build

```bash
# Development build (APK for device testing)
eas build --profile development --platform android

# Production build
eas build --profile production --platform android
```

### 11.3 `app.json` — required for background location

```json
{
  "ios": {
    "infoPlist": {
      "NSLocationAlwaysAndWhenInUseUsageDescription": "...",
      "NSLocationAlwaysUsageDescription": "...",
      "NSLocationWhenInUseUsageDescription": "...",
      "UIBackgroundModes": ["location"]
    }
  },
  "android": {
    "permissions": ["ACCESS_BACKGROUND_LOCATION"]
  }
}
```

Background location changes require a new EAS build — Metro reload is not sufficient.

---

## 12. Privacy & Compliance

- All user data stored locally on-device via SQLite
- Location data used only to compute ride distance; not stored beyond current session in manual mode; not transmitted
- No analytics, no crash reporters, no advertising SDKs
- No user account or email required
- Complies with Singapore PDPA, Google Play Developer Policies, Apple App Store guidelines
- Export: PDF generated on-device, shared only when user explicitly taps Share
- Data deletion: uninstalling the app removes all data permanently
