# Changelog

All notable changes to RideZen are documented here.

---

## [Unreleased] — In Progress

### Planned
- First-launch tutorial (5-slide swipeable onboarding, skippable, `tutorial_shown` flag in `app_settings`)

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
