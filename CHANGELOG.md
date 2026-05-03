# Changelog

All notable changes to RideZen are documented here.

---

## [Unreleased] — In Progress

### Added

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
