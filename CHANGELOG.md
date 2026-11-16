# Changelog

All notable changes to RideZen are documented here.

---

## [Unreleased] — In Progress

### Added

#### Full-project test suite

- **Coverage: 35% -> ~98% of statements** (49 suites / 1,113 tests, up from 21 / 302). Now covered: every migration (fresh install and upgrades from old versions), all repositories, the seed catalogue, consumption maths, status rules, currency conversion, PDF export, all data hooks, every component, and every screen including the root layout and tab bar.
- **Real SQL in tests:** data-layer tests run against a real SQLite engine (`sql.js`, new **dev** dependency) instead of mocks; helpers in `__tests__/helpers/` (`testDb.ts`, `routerMock.tsx`).
- `package.json`: Jest `testTimeout` raised to 30 s (the Settings screen could exceed the 5 s default when ~50 suites run in parallel).
- **Real bugs the tests found (documented, not fixed):** the error log file is never written (SDK 55 removed the old `expo-file-system` API); logging a service does not advance a date-based due date; the Log Service date defaults to the UTC day; the refuel form pre-fills GPS decimals; the currency picker calls a stale callback (wipes the converted price); vehicle make / model / year / plate cannot be cleared; failed vehicle update / delete still report success; `foreign_keys` is only enabled on first install so cascades do not run. Each is an `it.failing` test and is listed with its suggested fix in [docs/testing.md](docs/testing.md).

#### Maintenance push notifications — due soon / urgent / overdue

- **The gap this closes:** the notification code already existed, but **nothing ever called it**, so a maintenance notification was never sent. (`scheduleMaintenanceReminders()` had no caller, fired once 60 s after running, and read a per-item `reminder_settings` table that no screen edits — so it could even have disagreed with the status badges.)
- **When you are notified:** when a service item reaches **due soon**, **urgent** or **overdue**. The level comes from the same Settings thresholds as the status badge (defaults 1000 km / 14 days early, 200 km / 3 days final), so a notification and its badge always agree; change a threshold and both move together. **One notification per level** (due → urgent → overdue); no repeats while an item stays overdue; logging the service resets it so the next cycle notifies again.
- **Works with the app closed — three layers, all calling one function (`syncMaintenanceNotifications()`):**
  1. *Date-based items* are pre-scheduled with Android (`DATE` trigger) for the chosen time on the day each level starts, so they arrive with the app closed.
  2. *Km-based items* (no predictable date) are re-checked on app launch and resume, after a manual ride ends, during auto-tracking (background GPS task, at most every 5 min), after any write that can change a due level (vehicle / odometer / service log / item / fuel log edits), and after Settings changes.
  3. *Daily safety net* — `expo-background-task` runs the same check about every 24 h (Android treats it as a minimum and may delay it; Vivo's battery manager can skip it).
- **New Settings → Reminders controls:** **Push notifications** switch (was a fake `useState(true)`; now saved, default ON; OFF cancels everything pending, ON re-checks and sends anything missed), **Notification time** (Android time dialog, default 9:00 AM; applies to date-based reminders — km-based ones are sent as soon as they are noticed), **Group into one summary** (default OFF: when several notifications are due at the same moment send one "3 services need attention" instead of one each). Time and summary are greyed out while notifications are OFF. Saving a threshold re-checks.
- **Permission:** asked once on first launch (after the Android channel exists) and again when the switch is turned ON; if the phone blocks notifications the switch explains how to allow them (Open Settings). Background checks only *check* the permission — a prompt needs the UI.
- **Wording:** "Service due soon" / "Service urgent" / "Service overdue" with e.g. `Oil Change on Beat: 150 km left`, `due in 3 days`, `overdue by 1 day`. Tapping opens that item's service screen (a summary opens Home); also handled when the tap launched the app from closed.
- **Never touches the GPS idle reminder** — only identifiers starting `maint-` are ever cancelled. `channelId` is set on the trigger (SDK 55), not the content.
- **New files:** `src/notifications/maintenancePlanner.ts` (pure decision logic), `maintenanceNotifications.ts` (sync, cancel, debounce, single-flight), `maintenanceSyncSignal.ts` (dependency-free hook the repositories call — avoids an import cycle), `maintenanceResponseHandler.ts` (taps), `maintenanceBootstrap.ts` (first-launch permission + app-resume re-check); `src/services/maintenanceBackgroundTask.ts` (daily task), `notificationPreferences.ts` (3 settings + permission-asked flag); `src/repositories/notifyLogRepo.ts`; `src/utils/notifyTime.ts`.
- **Database:** migration **V9** (DB version 9) adds `maintenance_notify_log (item_id, level, fire_at)` — remembers which level was already announced per item so nothing repeats. `app_settings` gains `maintenance_notifications_enabled`, `maintenance_notify_time`, `maintenance_notify_grouped`, `notif_permission_asked`.
- **New dependencies (native — need a new APK build):** `expo-background-task ~55.0.22`, `@react-native-community/datetimepicker 8.6.0`; both added to the `app.json` plugins.
- **Removed:** `scheduleMaintenanceReminders()` and `cancelAllReminders()` (`scheduler.ts`), `checkReminderTrigger()` (`reminderCheck.ts`) — replaced by the above. The `reminder_settings` table is left in place but is no longer read.
- **Fixed alongside — due dates were read in UTC.** `computeMaintenanceStatus` parsed `"YYYY-MM-DD"` with `new Date(str)` (UTC midnight), so in a negative-UTC timezone a due date was one day early (e.g. the badge turned *overdue* on the due date itself). Now uses `parseLocalDate()`; day counts are DST-safe; `computeMaintenanceStatus` gained an optional `now` argument. No effect for UTC+ users (Singapore), but the notification planner needs it to schedule on the right day.
- **Tests:** `__tests__/maintNotif/` — 12 files (planner rules, sync/cancel/ordering/failure handling, tap handling, background task, repository triggers, first-launch + resume hooks, preferences, notify log, migration V9, Settings screen, time helpers, and a negative-UTC timezone run via `__tests__/helpers/tzLosAngelesEnv.js`). Existing `gpsIdle` tests updated for the changes (scheduler, GPS task, ride session; `autoTracking` / `useTrackingMode` mock the new module). Suite: **21 suites, 302 tests passing**. Plan and as-built notes: `docs/maintenance-notifications-plan.md`.
- **Needs on-device verification (Vivo):** see "Checks on the phone after an update" in `how-to-update.md` — chiefly that a date-based notification arrives at the chosen time with the app swiped away and after a reboot, and that Vivo's battery manager doesn't suppress it.

#### Automated tests — Jest setup and GPS idle reminder specs

- **Jest test tooling** — added `jest`, `jest-expo` (Android preset), `@testing-library/react-native`, `react-test-renderer` and `@types/jest` as dev dependencies; `npm test` and `npm run test:watch` scripts; `@/` path alias mapped for Jest. Tests live in `__tests__/`.
- **Baseline tests** — `__tests__/rideSession.test.ts` covers `haversineKm` and `addRideDistance`.
- **GPS idle reminder specs** — `__tests__/gpsIdle/` (7 files, all passing) cover the idle reminder below. Plan: `docs/gps-idle-reminder-plan.md`.

#### GPS idle reminder — "Still tracking your ride?"

- **Local notification after 60 s without movement** while GPS tracking is on (auto and manual mode), with **Turn off GPS** / **Leave it** buttons. Implemented as a dead-man's switch: each real movement (≥ 10 m) re-schedules one notification (fixed ID `ridezen-gps-idle`) 60 s ahead, so it never fires while moving and fires ~50–60 s after the rider stops. Re-arming is throttled to once per 10 s. No server — stays local-only.
- **`src/notifications/idleReminder.ts`** (new) — constants, `setupIdleReminderCategory()`, `armIdleReminder()`, `cancelIdleReminder()`. Never throws.
- **`src/notifications/idleResponseHandler.ts`** (new) — handles button taps via both a response listener (app alive) and a registered background task (`RIDEZEN_IDLE_RESPONSE`, Android backgrounded/killed). Dedupes the same tap. Auto mode → `disableAutoTracking()`; manual mode → asks `RideSessionContext` to end the ride (distance is saved).
- **`src/services/autoTracking.ts`** (new) — `disableAutoTracking()` stops the background task, clears coords, saves manual mode, cancels the reminder; callable outside React.
- **`backgroundLocationTask.ts`** — arms the reminder on real movement (not on first fix, so launching the app at home never nags). **`RideSessionContext`** — arms on start/movement, cancels on end, ends the ride on "Turn off GPS" using the latest state. **`useTrackingMode`** — `switchToManual` uses `disableAutoTracking()`; re-reads the saved mode when the app returns to foreground; asks notification permission when enabling auto mode. Home screen also refreshes mode/odometer on foreground and asks notification permission before a manual ride.
- **`scheduler.ts`** — new high-importance `ride_tracking` Android channel (so buttons show as a banner). **Fix:** maintenance cancel no longer calls `cancelAllScheduledNotificationsAsync()`, which would also have deleted the idle reminder. `setNotificationHandler` now sets `shouldShowBanner`/`shouldShowList` (SDK 55; fixes a type error and foreground display).
- **`app/_layout.tsx`** — imports the response handler at the top and registers the notification category on startup.
- **Needs on-device verification (Vivo):** banner + buttons appear; Turn off GPS with app open / backgrounded / swiped away; Leave it; and whether manual mode keeps tracking with the phone locked (no foreground service — see plan).

#### Maintenance — expanded item catalogue

- **New universal items** — `Valve Clearance` (12,000 km / 365 days), `Oil Filter` (10,000 km / 365 days), `Throttle Body Cleaning` (12,000 km / 365 days), and `Engine Overhaul` (no schedule — a milestone you log, like Vehicle Wash) added to `UNIVERSAL_SEEDS` in `src/db/seeds.ts`.
- **CVT catalogue restructured (scooter)** — `CVT Basic Service` renamed to `CVT Service` (clean + grease + inspect, 8,000 km); `CVT Variator/Pulley` renamed to `CVT Sliders & Guides` (24,000 km); new `CVT Clutch & Bell` (30,000 km); `CVT Rollers` interval raised 12,000 → 18,000 km. Cleaning and greasing are folded into `CVT Service` rather than tracked as standalone items.
- **Manual-bike items** — `Chain Replacement` renamed to `Chain & Sprocket Set` (chain and sprockets wear together); new `Clutch Plates` (35,000 km).
- **Backfill migration V7** — `migrateV7()` in `src/db/migrations.ts` (DB version bumped 6 → 7) applies all of the above to pre-existing vehicles: renames in place via `UPDATE` (preserving `item_id`, so logged history and reminder settings stay linked), retunes CVT Rollers, and inserts the new items scope-aware (universal to all, CVT to scooters, Clutch Plates to manual bikes). Idempotent, modelled on `migrateV3`.

#### Fuel log — edit and delete

- **Edit fuel log** — `app/fuel/edit/[logId].tsx` modal (presented identically to Log Refuel). Pre-populates all fields from the existing entry: date, odometer, litres, price per litre, pump currency, full-tank toggle, and notes. On save, calls `fuelRepo.update()` which recalculates `km_since_last` and `consumption` from the previous entry by odometer. Registered as a modal route in `_layout.tsx`.
- **Delete fuel log** — accessible from the same "⋮" menu (see below). Uses the existing `fuelRepo.delete()`. The Alert's destructive button style serves as the single confirmation step.
- **"⋮" context menu on fuel log cards** — `FuelLogItem` now accepts optional `onEdit` and `onDelete` callbacks. When either is provided, a `MoreVerticalIcon` (three dots) button appears in the top-right corner of the card. Tapping it opens a native `Alert.alert` with **Edit / Delete (destructive) / Cancel** options.
- **`fuelRepo.getById(id)`** — new repository method; used by the edit screen to load an existing log.
- **`fuelRepo.update(id, input)`** — new repository method; updates all editable fields and recomputes `km_since_last` and `consumption` from the entry with the nearest lower odometer (excluding self).
- **`MoreVerticalIcon`** — added to `src/components/icons.tsx`.
- **Fuel list auto-refresh on focus** — `useFocusEffect` added to the Fuel tab so the list reloads whenever the screen regains focus (returning from add or edit modal). Previously required a manual pull-to-refresh.

#### Currency support in fuel log
- **`currencyService.ts`** — single-file service layer for all currency logic. ExchangeRate-API integration (162 currencies, free tier 1,500 req/mo). Cache-first: rates stored in `app_settings`, refreshed at most once per 24 h. Public API: `getRates()`, `convert()`, `getHomeCurrency()`, `setHomeCurrency()`, `getRecentCurrencies()`, `addRecentCurrency()`. Switching providers requires editing only `buildUrl()` and `parseResponse()`.
- **`CurrencyPickerModal`** — full-screen searchable picker (162 currencies). FlashList for performance. Search filters by code, name, or country. **Most Recent** section (max 3) appears above the full list when not searching; recents stored in `app_settings` under `recent_currencies` and updated on every selection.
- **Bidirectional currency converter on Log Refuel** — "Price per litre" and "Local currency" fields with live conversion. Typing in either field instantly updates the other. Exchange rate shown inline between the two fields (`1 SGD = 3.42xx MYR`). Tapping either currency badge opens `CurrencyPickerModal`. Only `price_per_litre` + `currency` are saved to DB; the local field is reference-only.
- **`currency` column in `fuel_logs`** — migration V4 (DB version bumped to 5) adds `currency TEXT DEFAULT 'SGD'` via `ALTER TABLE`. `FuelLog` and `FuelLogInput` types and `fuelRepo.add()` updated accordingly.

#### Date wheel picker
- **`DateWheelPickerModal`** — custom 3-column iOS-style wheel picker (Day | Month | Year). Built with `ScrollView` snap — no extra packages. Selection highlight strip (blue-tinted) at the centre row. Step-gradient fade mask at top/bottom simulated with layered semi-transparent Views (no `expo-linear-gradient` required). Day count auto-adjusts when month or year changes (e.g. Mar 31 → Feb 28). Handles both `onMomentumScrollEnd` and `onScrollEndDrag` for correct behaviour on Android (where low-velocity scrolls skip the momentum event). Opens from the date field in Log Refuel as a bottom-sheet modal.
- **Log Refuel — tappable date field** — replaces the manual YYYY-MM-DD text input. Shows date formatted as `DD Month YYYY`. Tapping opens `DateWheelPickerModal`; confirming writes back to `YYYY-MM-DD` for storage.

#### Home screen — real data
- **Overdue alert strip** — `maintenanceRepo.getOverdueSummary(vehicles)` computes live overdue count across all vehicles. Message: `"1 item overdue — Engine Oil on Irsyad Bike"` (single) or `"3 items overdue across your vehicles"` (multiple). Strip is hidden when count is 0.
- **"This month" stats** — `fuelRepo.getMonthlyGlobalStats(vehicleIds)` returns real total fuel cost and the per-vehicle average L/100km for the best-performing vehicle this month.

#### Other
- **Vehicle card subtitle** — `VehicleCard` now shows make, model, and plate number on a line below the vehicle name (font size 11, 60% white opacity), joined by `·`. Hidden entirely when all three fields are empty.
- **Add vehicle — type-aware placeholders** — Step 2 form shows placeholders tailored to the selected vehicle type (Car: "My Personal Car" / "e.g. Hyundai" / "e.g. Kona"; Scooter/Manual Bike: plate "e.g. FBR1234C").
- **Auto-fill odometer on Log Refuel** — screen now pre-fills the odometer field with the vehicle's current `current_odometer` on open.
- **First-launch tutorial** — `TutorialModal` with 6 slides (Welcome, My Garage, Odometer Tracking, Maintenance, Fuel Log, Final CTA). FlashList with paging, dot indicators, Skip / Next / "Add my first vehicle" actions. `tutorial_shown` flag persisted in `app_settings`. Shown once after splash screen on first install.

#### Automated tests (Jest)
- **Jest test setup** — `jest`, `jest-expo`, `@testing-library/react-native`, `react-test-renderer` and `@types/jest` added as **dev dependencies**. `package.json` gains `npm test` (`jest`), `npm run test:watch`, and a `jest` config block (preset `jest-expo/android`, `@/` → `src/` alias, tests live in `__tests__/**/*.test.ts(x)`).
- **Edit Vehicle odometer tests** — `__tests__/vehicle-edit-odometer.test.tsx` (7 tests) for the Edit Vehicle screen (`app/vehicle/[id].tsx`). Written test-first; they assert the odometer is shown rounded, uses a number-pad keyboard, isn't re-saved unless edited, and that the screen lifts above the keyboard on Android and scrolls the field into view. Run: `npx jest __tests__/vehicle-edit-odometer.test.tsx`.
- The animation libs can't run in Node, so that test mocks `react-native-worklets` and `react-native-reanimated` with their official mocks (inline in the test file).

### Fixed — Fuel section audit (2026-07)

- **Dead header button removed** — the Fuel tab header had a chevron button (labelled "Delete fuel log") with no `onPress`; removed.
- **Mixed-currency cost totals** — monthly and lifetime fuel spend previously summed `litres × price_per_litre` regardless of the pump currency, so a fill logged in MYR was added raw into SGD totals. New `price_home` column (migration V8, DB version 8) stores the per-litre price converted to the home currency at save time; all cost aggregates (Fuel tab stats, Home quick stat, PDF export) now sum `litres × price_home`. Fills without a stored conversion (foreign currency while offline with no cached rates) are excluded from cost totals. Existing home-currency logs are backfilled 1:1.
- **Hardcoded "SGD" labels** — `FuelLogItem` now shows each log's own pump currency for price/L and cost; the Fuel tab stats, Home quick stat, and PDF export aggregate cards use `getHomeCurrency()` instead of a hardcoded `SGD`.
- **Stale consumption after edit/delete** — `km_since_last` and `consumption` were only computed for the row being written, so editing an odometer, deleting a middle entry, or back-dating an insert left the *next* log's figures stale (and back-dated adds stored a negative `km_since_last`). New `recalcConsumptionChain()` in `fuelRepo` re-walks the vehicle's full log chain (ordered by odometer) after every add, update, and delete.
- **Partial fills no longer break the L/100km chain** — consumption at a full-tank fill now includes the litres of any partial fills since the previous full-tank fill (standard full-to-full method). Previously a partial fill between two full fills produced no consumption figure at all. Warning copy on the add/edit forms updated to match.
- **Vehicle odometer sync on edit** — `fuelRepo.update()` (not just `add()`) now raises the vehicle's `current_odometer` when a log exceeds it, via shared `syncVehicleOdometer()`.
- **UTC date bugs** — the Log Refuel default date and the "this month" stats boundary used `toISOString()` (UTC), which is yesterday's date before 8am SGT. New `toLocalDateString()` helper in `src/utils/consumption.ts`; `calcConsumption()` removed (superseded by the chain recalculation).
- **Edit screen infinite spinner** — opening `/fuel/edit/[logId]` for a missing/invalid log left the loading spinner up forever with no back button; it now alerts "Not found" and navigates back.
- **Redundant schema guard removed** — `fuelRepo.add()` ran a defensive `PRAGMA table_info` + `ALTER TABLE` for the `currency` column on every save, duplicating migration V4; removed.
- **Edit Vehicle odometer** — in `app/vehicle/[id].tsx`: the keyboard no longer covers the odometer field on Android (`KeyboardAvoidingView` uses `padding` on both platforms, and the screen scrolls to the field on focus); the field shows a whole number (`Math.round`) with a `number-pad` keyboard instead of raw GPS decimals; `current_odometer` is only saved when the user edits it, so renaming a vehicle can't overwrite the precise stored value. Covered by `__tests__/vehicle-edit-odometer.test.tsx` (7/7 passing).

### Changed
- **DB migration** — `CURRENT_VERSION` bumped from 4 → 5. `migrateV4()` guard condition is `currentVersion < 5` (not `< 4`) because the DB was already at version 4 from a prior placeholder bump.
- **`FuelLogItem` — edit/delete UI revised** — replaced the single "⋮" context menu with two explicit inline icon buttons: pencil (edit, amber) and trash (delete, red). Delete button shows a native confirmation Alert before executing. Both buttons use NativeWind classes (`bg-zen-gold/10`, `bg-red-500/10`, `rounded-lg`, `p-1.5`) with no inline styles.
- **`PencilIcon`** — added to `src/components/icons.tsx` (used by the edit button on fuel log cards).

### Known Issues
- **`expo-file-system` deprecation warning** — `FileSystem.moveAsync()` in `src/utils/export.ts` (PDF export) triggers a Metro/runtime deprecation warning: *"Method moveAsync imported from expo-file-system is deprecated."* The old API still works and does not affect app functionality. Fix: migrate `export.ts` to use the new `File` and `Directory` classes from `expo-file-system`. Deferred.

---

## [1.1.0] — 2025-04

### Added

#### Maintenance screen
- **Per-item editable interval** — users can change how often an item is due (km) directly on the log screen
- **Per-item next due date** — manual override of the next calendar due date
- **Remarks field** — persistent note per maintenance item (stored in `maintenance_items.notes`); separate from per-log notes
- **Two-action header on log screen** — "Save" updates item settings only with no history entry; "Log Service" creates a history entry and recalculates next due
- **Service history on log screen** — last 5 service entries shown at the bottom of the log screen
- **Confirmation dialogs** — both Save and Log Service require explicit confirmation before executing
- **Tyre pairing** — Front Tyre and Rear Tyre rendered side-by-side in compact card layout when both exist in the same status section
- **New maintenance items (migration V3)**: Front Fork Servicing (24,000 km / 360 days interval) and Vehicle Wash (no default interval) added to all existing and new vehicles

#### Settings screen
- **Editable reminder thresholds** — Default Early Warning and Default Final Reminder now open an edit modal; values persist in `app_settings` and apply immediately across the whole app
- **Privacy policy modal** — tapping Privacy opens a full in-app scrollable privacy policy (7 sections) instead of doing nothing
- **"Coming Soon" badge** — Upgrade section badge changed from "Soon" to "Coming Soon"

#### Maintenance status
- **User-configurable thresholds** — `computeMaintenanceStatus()` now accepts a `StatusThresholds` object; `loadStatusThresholds()` reads live values from `app_settings` so changing thresholds in Settings is immediately reflected on the Maintenance screen without a restart

#### Export
- **PDF export** — "Export data" now generates a formatted PDF report (vehicle info, fuel log table, maintenance schedule table) via `expo-print` and shares it via the native share sheet. Replaced previous CSV/JSON export.

#### Onboarding
- **Tracking onboarding on every vehicle add** — the 2-step tracking mode onboarding modal now appears after every vehicle is saved, not just the first. This allows users to confirm or change their tracking preference when adding a new vehicle.
- **Onboarding modal reset** — the modal now resets to Step 1 each time it opens (previously retained state from last open)

### Fixed
- **Maintenance prompt timing** — "Set up maintenance?" no longer appears during the tracking onboarding flow. It is now queued and shown only after the onboarding is completed.
- **Remarks vs notes mixing** — `maintenance_items.notes` (persistent remarks) and `maintenance_logs.notes` (per-service notes) were being mixed up in `maintenanceRepo.logService()`. Now correctly separated.
- **Default early warning sub-text** — Settings screen now shows live values from `app_settings` rather than hardcoded text.

### Changed
- **SDK upgrade**: Expo ~54 → ~55, React Native 0.81.5 → 0.83.4
- **Expo Router**: v4 → v6
- **`ServiceLogInput` type** — added `new_due_date` and `remarks` fields
- **`computeMaintenanceStatus`** — signature extended with optional `thresholds` parameter; `DEFAULT_THRESHOLDS` and `loadStatusThresholds()` exported from `reminderCheck.ts`
- **`app_settings` keys** — four new keys: `early_warning_km`, `early_warning_days`, `final_reminder_km`, `final_reminder_days`
- **DB migration** — `CURRENT_VERSION` bumped to 3

### Dependencies added
- `expo-print` — PDF generation from HTML

---

## [1.0.0] — 2025-02 (First Commit)

### Added
- Multi-vehicle garage (scooter, manual motorcycle, car, other)
- Fuel log — log refuels, track consumption (L/100km), monthly stats
- Maintenance tracking — seeded per vehicle type, status badges (overdue / urgent / due / ok)
- Manual Ride Session — tap Start/End, GPS foreground, odometer auto-updated
- Auto-track Always — GPS background task (expo-task-manager), silent odometer updates
- 2-step tracking onboarding on first vehicle add
- Two-stage push notification reminders (early warning + final reminder)
- `app_settings` SQLite table for tracking preferences
- Animated splash screen
- NativeWind v4 design system (zen-primary, zen-secondary, zen-gold, zen-bg tokens)
- Fully offline — no backend, no account, SQLite on-device only
- EAS Build support (Windows MAX_PATH workaround)
