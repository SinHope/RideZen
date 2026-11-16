# RideZen — Technical Design Document

**Version:** 1.2.0  
**Last updated:** November 2026  
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
│  reminderRepo (legacy)  notifyLogRepo                │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│                Service Layer                         │
│  rideSession.ts (haversine + odometer update)        │
│  trackingPreferences.ts (app_settings R/W)           │
│  backgroundLocationTask.ts (OS background task)      │
│  currencyService.ts (exchange rates, conversion)     │
│  notificationPreferences.ts (notification settings)  │
│  notifications/ (planner + sync, see 9.6)            │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              Database Layer                          │
│  expo-sqlite (sync API)  ·  ridezen.db               │
│  Migrations V1 → V9  ·  Seeds per vehicle type       │
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
| price_per_litre | REAL | Optional. In pump currency (`currency`) |
| currency | TEXT | ISO 4217 code, e.g. `SGD`, `MYR`. Default `'SGD'`. Added in V4 migration. |
| price_home | REAL | `price_per_litre` converted to home currency at log time. Used for all cost aggregates so totals never mix currencies. NULL when no conversion was possible (offline, no cached rates). Added in V8 migration. |
| is_full_tank | INTEGER | 1 = full, 0 = partial |
| notes | TEXT | Optional |
| km_since_last | REAL | Recomputed for the whole vehicle chain after every add/update/delete |
| consumption | REAL | L/100km. Computed at each full-tank fill: litres since the previous full-tank fill (partials included) ÷ km between the two full fills. Recomputed for the whole chain after every add/update/delete |
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

#### `maintenance_notify_log`
Which level of each service item the rider was already notified about, so a level is announced once and never repeated (§9.6). Added in migration V9.

| Column | Type | Notes |
|---|---|---|
| item_id | INTEGER FK | → `maintenance_items(id)`, CASCADE delete |
| level | TEXT | `due` / `urgent` / `overdue` |
| fire_at | TEXT | ISO-8601 UTC. **Past** = delivered; **future** = scheduled with Android and still pending |

Primary key `(item_id, level)`. Future rows are deleted and rewritten on every sync (their notifications are cancelled and re-planned).

> `reminder_settings` is **no longer read**. Notification levels come from the global thresholds in `app_settings` — the same ones that drive the status badges — so a notification can never disagree with its badge. The table is left in place.

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
| `maintenance_notifications_enabled` | `1` | `1` / `0` — the Settings "Push notifications" switch (absent = ON) |
| `maintenance_notify_time` | `09:00` | 24-hour `HH:MM` the date-based reminders fire at |
| `maintenance_notify_grouped` | `0` | `1` = send one summary when several notifications are due at once |
| `notif_permission_asked` | — | `true` once the first-launch notification permission prompt was shown |

### 3.2 Migration history

| Version | Description |
|---|---|
| V1 | Core tables: vehicles, fuel_logs, maintenance_items, maintenance_logs, reminder_settings |
| V2 | `app_settings` key-value store |
| V3 | Inserts Front Fork Servicing + Vehicle Wash into all existing vehicles |
| V4 (DB ver 5) | `ALTER TABLE fuel_logs ADD COLUMN currency TEXT DEFAULT 'SGD'` |
| V7 (DB ver 7) | Backfills new items (Valve Clearance, Oil Filter, Throttle Body Cleaning, Engine Overhaul, CVT Clutch & Bell, Clutch Plates) into existing vehicles; renames CVT Basic Service → CVT Service, CVT Variator/Pulley → CVT Sliders & Guides, Chain Replacement → Chain & Sprocket Set; retunes CVT Rollers to 18,000 km |
| V8 (DB ver 8) | `ALTER TABLE fuel_logs ADD COLUMN price_home REAL`; backfills `price_home = price_per_litre` for logs already in the home currency. Foreign-currency logs stay NULL (historical rate unknown) and are excluded from cost totals |
| V9 (DB ver 9) | `CREATE TABLE maintenance_notify_log (item_id, level, fire_at, PRIMARY KEY (item_id, level))` — remembers which maintenance level was already notified (§9.6) |

### 3.3 Seeded maintenance items

Items are inserted by `src/db/seeds.ts` when a vehicle is created. Items added in later versions are backfilled onto pre-existing vehicles via migrations (see §3.2).

| Category | Scope | Default Interval |
|---|---|---|
| Engine Oil | universal | 5,000 km / 90 days |
| Oil Filter | universal | 10,000 km / 365 days |
| Air Filter | universal | 10,000 km / 365 days |
| Throttle Body Cleaning | universal | 12,000 km / 365 days |
| Spark Plug | universal | 10,000 km / 365 days |
| Valve Clearance | universal | 12,000 km / 365 days |
| Front Brake Pads | universal | 15,000 km |
| Rear Brake Pads | universal | 15,000 km |
| Brake Fluid | universal | — / 730 days |
| Front Tyre | universal | 30,000 km |
| Rear Tyre | universal | 25,000 km |
| Battery | universal | — / 730 days |
| Coolant | universal | — / 730 days |
| Front Fork Servicing | universal | 24,000 km / 360 days |
| Engine Overhaul | universal | None |
| Vehicle Wash | universal | None |
| Gear Oil | scooter, manual_bike | 5,000 km / 180 days |
| CVT Service | scooter | 8,000 km |
| CVT Rollers | scooter | 18,000 km |
| CVT V Belt | scooter | 25,000 km |
| CVT Sliders & Guides | scooter | 24,000 km |
| CVT Clutch & Bell | scooter | 30,000 km |
| Chain Lubrication | manual_bike | 800 km |
| Chain Adjustment | manual_bike | 2,500 km |
| Chain & Sprocket Set | manual_bike | 18,000 km |
| Clutch Cable Inspection | manual_bike | 10,000 km |
| Clutch Plates | manual_bike | 35,000 km |
| Transmission Oil | car | 50,000 km |
| Timing Belt/Chain | car | 80,000 km |
| Cabin Air Filter | car | 15,000 km / 365 days |
| Power Steering Fluid | car | — / 730 days |
| Wiper Blades | car | — / 365 days |

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

Saved to `app_settings` via `setAppSetting(key, value)`. Read by `loadStatusThresholds()` in `reminderCheck.ts` on every maintenance data load. Changes take effect immediately on next list refresh — no app restart required. Saving a threshold also re-checks maintenance notifications (§9.6), because the due / urgent levels move with them.

### 7.2 Tracking mode selector

A custom two-card selector (Manual / Auto) that runs the full permission flow when switching to Auto. The Home screen and Settings screen both sync their displayed mode from `getTrackingMode()` on focus.

### 7.3 Privacy policy

Fully in-app. No external URL. 7 sections: data storage, location data, no accounts, no analytics, export, data deletion, contact.

### 7.4 Maintenance notification settings

Under **Reminders**, stored in `app_settings` via `notificationPreferences.ts` (synchronous, never throws, falls back to the defaults — also read from background tasks):

| Control | Behaviour |
|---|---|
| **Push notifications** (switch) | Default ON. OFF → `syncMaintenanceNotifications()` cancels everything pending. ON → asks for permission (if the phone blocks it, an alert offers *Open Settings*), then re-checks so anything that came due while OFF is sent. |
| **Notification time** | Android time dialog (`DateTimePickerAndroid`; iOS falls back to an inline picker). Default 9:00 AM. Applies to **date-based** reminders only; saving re-books every pending one. |
| **Group into one summary** (switch) | Default OFF. ON → notifications due at the same moment are merged into one "N services need attention". |

Time and summary are greyed out (and not pressable) while Push notifications is OFF.

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
/(tabs)/fuel → pencil / trash buttons on a fuel log card
  → Edit → /fuel/edit/[logId] (modal)
       Pre-filled: date, odometer, litres, price/L, currency, full-tank, notes
       Save → fuelRepo.update(id, input)
            → recalcConsumptionChain() rewalks the whole vehicle chain
            → syncVehicleOdometer() raises vehicle odometer if a log exceeds it
            → router.back() → useFocusEffect reloads list
  → Delete → confirm Alert → fuelRepo.delete(id)
            → recalcConsumptionChain() → list reloads immediately
```

### 8.4.1 Consumption chain recalculation

`km_since_last` and `consumption` are never computed incrementally. After **every**
`fuelRepo.add / update / delete`, `recalcConsumptionChain(db, vehicleId)` re-walks all of
the vehicle's logs ordered by odometer:

- `km_since_last` = distance from the previous log (any fill type).
- `consumption` is set only on full-tank fills: *(litres of this fill + all partial fills
  since the previous full-tank fill) ÷ km between the two full-tank fills × 100*.
- Partial fills therefore contribute litres to the next full fill's figure instead of
  breaking the chain; back-dated inserts, edits, and deletions can never leave a
  neighbouring log with stale values.

Cost aggregates (`getMonthlyStats`, `getMonthlyGlobalStats`, PDF export) sum
`litres × price_home` — the home-currency price locked in at save time — so fills logged
in foreign currencies are never added raw into home-currency totals. Fills without a
stored conversion are excluded from cost totals (but still count toward litres and
consumption).

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

### 9.5 GPS Idle Reminder

Local notification "Still tracking your ride?" with **Turn off GPS** / **Leave it** buttons, shown ~60 s after the rider stops while tracking (auto or manual).

- **Mechanism:** every movement ≥ 10 m calls `armIdleReminder()`, which schedules a one-shot `TIME_INTERVAL` notification (60 s) under the fixed identifier `ridezen-gps-idle`; scheduling again replaces it. Throttled to once per 10 s. The OS fires it even if JS is asleep. "Leave it" only dismisses — nothing re-arms until the next movement.
- **Android channel:** `ride_tracking` (HIGH importance). `channelId` is set on the **trigger**, not the content.
- **Buttons:** category `gps_idle`, actions `TURN_OFF_GPS` / `LEAVE_IT` with `opensAppToForeground: false`. Taps reach `handleIdleReminderResponse()` via `addNotificationResponseReceivedListener` (app alive) and a `registerTaskAsync` background task (Android, app backgrounded/killed); the handler dedupes the same tap.
- **Turn off GPS:** auto mode → `disableAutoTracking()` (stop `RIDEZEN_BG_LOCATION`, clear coords, mode = manual, cancel reminder). Manual mode → `onManualRideStopRequested` listeners; `RideSessionContext` ends the ride via a ref to the latest `endRide` so distance is saved.
- **Maintenance interaction:** the maintenance sync only ever cancels identifiers starting `maint-` (or `data.type` `maintenance*`), never the idle reminder — it never calls `cancelAllScheduledNotificationsAsync()`.
- **iOS caveat:** a button tap with the app fully killed does not run JS (no background task for action taps on iOS); with active background location the app process is normally alive.
- Tests: `__tests__/gpsIdle/`. Plan: `docs/gps-idle-reminder-plan.md`.

### 9.6 Maintenance Notifications

A phone notification when a service item becomes **due soon**, **urgent** or **overdue**, with or without the app open. Plan and as-built notes: `docs/maintenance-notifications-plan.md`.

**Rules** (implemented once, in the pure `planMaintenanceNotifications()` in `src/notifications/maintenancePlanner.ts`):
- **Level = the badge's level.** It uses `computeMaintenanceStatus()` with the Settings thresholds, so notification and badge agree; changing a threshold moves both.
- **One notification per level.** No repeats while overdue. When the item is back to `ok` (service logged) its memory is cleared; if it drops to a lower non-ok level (due date moved out, thresholds lowered) the lower level is recorded as already told (`markSent`) so it is not re-announced.
- **km-based levels fire as soon as noticed** (no predictable date). **Date-based levels fire at the user's notify time on the day the level starts** (`due`: due date − early days, `urgent`: − final days, `overdue`: due date + 1). A level whose time has already passed today is sent now. Several levels at the same instant keep only the highest; a final window longer than the early window never yields a lower level after a higher one.
- **Grouping:** with *Group into one summary* ON, notifications at the same moment (immediate ones, or scheduled ones with an identical `fireAt`) become one `maint-summary-<ms>` notification listing up to 3 items + "+N more".
- Dates are read as **local** calendar days (`parseLocalDate()`); see the UTC bug noted in the CHANGELOG.

**Sync** — `syncMaintenanceNotifications()` in `maintenanceNotifications.ts` is the single entry point and is idempotent:
1. Switch OFF, or permission not granted (only *checked* — a prompt needs the UI) → cancel our pending notifications and stop.
2. Load vehicles + items. **If any read fails, change nothing** (planning on partial data would treat missing items' log rows as orphans and forget them).
3. Cancel pending `maint-*`, delete future log rows, read the log, plan.
4. Apply `clearLog`, record `markSent`, send `notifyNow` (trigger `{ channelId: 'maintenance' }`), schedule `schedule` (`DATE` trigger + channel). A row is logged **only after** the OS accepted the notification, so a failed one is retried next sync.
- Never throws. One run at a time; a call during a run requests exactly one rerun afterwards. `syncIfStale(ms)` skips if a sync finished recently (used from the GPS task). `requestMaintenanceSync()` is a 2 s debounce for bursts of writes.
- Only identifiers starting `maint-` (or `data.type` `maintenance` / `maintenance_summary`) are ever cancelled — never the GPS idle reminder.
- `channelId` goes on the **trigger**, not the content (SDK 55).

**When it runs:**

| Trigger | Where |
|---|---|
| App launch (after migrations + channel setup) | `initMaintenanceNotifications()` from `_layout.tsx` `init()` — also asks for permission once and registers the daily task |
| App returns to foreground | `attachMaintenanceAppStateSync()` → `requestMaintenanceSync()` |
| Any write that can change a due level | `vehicleRepo` create / update / updateOdometer / delete, `maintenanceRepo` logService / updateItem, `fuelRepo` add / update → `requestMaintenanceSync()` |
| Manual ride ends | `RideSessionContext.endRide` (after `addRideDistance`) |
| Auto-tracking moves the odometer | `backgroundLocationTask` → `await syncIfStale(5 min)` |
| Settings changes | switch, time, summary, saving a threshold → `syncMaintenanceNotifications()` |
| Daily safety net | `RIDEZEN_MAINT_CHECK` via `expo-background-task` (`minimumInterval` 24 h; registered once — re-registering would restart the timer) |

Repositories call `requestMaintenanceSync()` from the **dependency-free** `maintenanceSyncSignal.ts`; `maintenanceNotifications.ts` registers its debounced sync there on load. (Importing it from the repositories directly would be an import cycle — it reads those same repositories.)

**Tap handling** — `maintenanceResponseHandler.ts` (imported at the top of `_layout.tsx`): a single item opens `/maintenance/log/<id>`, a summary opens Home. Live taps arrive through `addNotificationResponseReceivedListener`; when the tap *launched* the app, `NotificationLaunchHandler` in `_layout.tsx` reads `getLastNotificationResponse()` once the navigator is ready. Both paths are deduped on `identifier:date`.

**Limits:** Android treats `DATE` triggers as exact only if allowed and otherwise delivers a few minutes late (no `SCHEDULE_EXACT_ALARM` needed). expo-notifications restores scheduled notifications after a reboot. Vivo's battery manager can still delay or kill pending alarms and the daily task — RideZen should be set to unrestricted background.

**Tests:** `__tests__/maintNotif/` (12 files); one runs under a negative-UTC timezone via `__tests__/helpers/tzLosAngelesEnv.js`.

## 10. Testing

Jest (`jest-expo/android` preset) + React Native Testing Library. **49 suites / 1,113 tests, ~98% statement coverage.** Data-layer tests (migrations, repositories, seeds, `export`, `currencyService`) run against a **real SQLite engine** — `sql.js` (a dev dependency) behind the `expo-sqlite` sync API — so the app's actual SQL is executed; screens and components use faked hooks / repositories (the data-heavy screens use the real DB). Real defects the tests uncovered but that are not yet fixed are recorded as `it.failing` tests and listed in `docs/testing.md` ("Known gaps").

Run with `npm test` (~1.5–2 min) or `npm run test:watch`. Full guide — folder map, helpers, conventions, gotchas, known gaps: [docs/testing.md](docs/testing.md).

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

### 11.4 Native modules added for maintenance notifications

`expo-background-task` (daily check, WorkManager) and `@react-native-community/datetimepicker` (the *Notification time* dialog) are native modules and are listed in the `app.json` `plugins`. They need a **new APK build** — Metro reload and Expo Go cannot load them. Installing on the Vivo follows `how-to-update.md`.

---

## 12. Privacy & Compliance

- All user data stored locally on-device via SQLite
- Location data used only to compute ride distance; not stored beyond current session in manual mode; not transmitted
- No analytics, no crash reporters, no advertising SDKs
- No user account or email required
- Complies with Singapore PDPA, Google Play Developer Policies, Apple App Store guidelines
- Export: PDF generated on-device, shared only when user explicitly taps Share
- Data deletion: uninstalling the app removes all data permanently

---

## 13. Future Considerations

> Not planned, not scheduled — recorded here so the intent isn't lost.

- **Cloud sync (Google login, cross-device)** — *out of scope for now.* Would only be considered if users explicitly request syncing across devices. The current architecture (local-only SQLite, no backend, no account) is a deliberate present-state choice, not a permanent guarantee. **Caveat:** building this would directly contradict the "fully offline, no cloud, no account" claims in §1, §12, the in-app privacy policy (§7.3), and the onboarding tutorial — all of those would need revising in the same change. Treat it as a positioning decision, not just a technical one.
