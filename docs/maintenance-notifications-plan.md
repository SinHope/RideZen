# Maintenance Push Notifications — Plan and As-Built Notes

**Status:** implemented 2026-11-16. `npm test` → 21 suites / 302 tests passing (`__tests__/maintNotif/` is the spec); `tsc` shows no errors in the new or changed files; the Android JS bundle builds (`expo export`). **On-device verification on the Vivo is still pending** — see the checklist in [how-to-update.md](../how-to-update.md).
**Needs a fresh APK:** two new native modules (`expo-background-task`, `@react-native-community/datetimepicker`).

## Feature

Send a phone notification when a maintenance item becomes **due soon**, **urgent** or **overdue**, even when RideZen is closed. The user controls on/off, the time of day for date reminders, and whether several reminders at once are grouped into one summary.

## What was wrong before (verified in code)

1. **Never sent.** `scheduleMaintenanceReminders()` had no caller (only its test).
2. **Even if it had been called:** it fired once, 60 s after running, and never pre-scheduled future dates; nothing re-ran it after the odometer changed or in the background; it had no memory, so it would have pinged again for the same item every run; urgent and overdue shared one message; and `channelId` was on `content`, where SDK 55 ignores it.
3. **Two threshold systems disagreed.** The Settings screen edits global thresholds in `app_settings` and the badges use them; the old notifier used the per-item `reminder_settings` table, which no screen edits.
4. **The Settings "Push notifications" switch was fake** — plain `useState(true)`, not saved, controlled nothing.
5. **Tapping a notification** only opened the app.

## Design

### Levels come from the Settings thresholds

The level is `computeMaintenanceStatus(item, odometer, loadStatusThresholds(), now).status` — the same value that drives the badge. Example: oil change due at 2,000 km, early warning 1,000 km, final reminder 200 km:

| Odometer | Badge and level | Notification |
|---|---|---|
| < 1,000 km | ok | none |
| 1,000 km | due | "Service due soon" (once) |
| 1,800 km | urgent | "Service urgent" (once) |
| > 2,000 km | overdue | "Service overdue" (once) |

Date thresholds work the same way: due soon 14 days before, urgent 3 days before, overdue the day after the due date. Changing a threshold in Settings moves the badge and the notification together.

**Once per level.** At most one notification per stage; riding from 1,000 to 1,500 km sends nothing more. **No repeats while an item stays overdue.** Logging the service drops the item back to `ok`, clears its memory, and the next cycle notifies again.

### Three layers, all calling one function: `syncMaintenanceNotifications()`

| Layer | How | Covers |
|---|---|---|
| A. Pre-scheduled dates | For items with `next_due_date`, compute each level's first day and hand Android a `DATE` trigger at the **user's chosen time** (default 09:00). | Date-based items while the app is closed. |
| B. Re-check on events | App launch / resume, manual ride end, auto-mode GPS (at most every 5 min), every repository write that can change a due level, Settings changes. | Km-based items (unpredictable dates) and resync after edits. |
| C. Daily background check | `expo-background-task`, about every 24 h. | Safety net (phone restart, app not opened for days). Vivo may delay it. |

Km-based notifications are sent **immediately** when found (usually right after a ride). The chosen time only applies to date-based ones.

### User settings (Settings → Reminders)

```
Push notifications           [ ON ]          maintenance_notifications_enabled  '1'
  Notification time          9:00 AM         maintenance_notify_time            '09:00'
  Group into one summary     [ OFF ]         maintenance_notify_grouped         '0'
Default early warning        1000 km · 14 days   (existing)
Default final reminder       200 km · 3 days     (existing)
```

- **Push notifications OFF:** cancel every pending `maint-*` and send nothing. The badges still work. **ON:** ask for permission if needed (blocked → alert with *Open Settings*), then sync, so anything that came due meanwhile is sent.
- **Notification time:** Android time dialog (`DateTimePickerAndroid`; iOS falls back to the inline picker). Saving re-books every pending date reminder.
- **Group into one summary:** several notifications at the same moment → ON sends one "3 services need attention", OFF sends one each.
- Time and summary are greyed out and not pressable while notifications are OFF. All values live in `app_settings`.

### Sync procedure (`syncMaintenanceNotifications`)

1. Switch OFF, or permission not granted (only **checked** — a prompt needs the UI, and this also runs headless) → cancel our pending notifications and stop.
2. Load vehicles and items. **If any read fails, change nothing** (cancelling or planning on partial data would forget log rows and re-announce levels later).
3. Cancel every pending `maint-*` (**never** `gps_idle`) and delete the future rows of the notify log, then read the log and plan (pure).
4. Apply `clearLog`, record `markSent`, send `notifyNow`, schedule `schedule`. A log row is written **only after** the OS accepted the notification, so a failed one is retried next sync.
5. Never throws; errors go to `logToFile('MAINT_NOTIF', …)`. One run at a time — a call during a run asks for exactly one rerun afterwards.

### Notify log (migration V9)

```sql
CREATE TABLE maintenance_notify_log (
  item_id INTEGER NOT NULL REFERENCES maintenance_items(id) ON DELETE CASCADE,
  level   TEXT    NOT NULL,          -- 'due' | 'urgent' | 'overdue'
  fire_at TEXT    NOT NULL,          -- ISO UTC; future = scheduled, past = delivered
  PRIMARY KEY (item_id, level)
);
```

"Already notified level" = the highest `level` with `fire_at <= now`. This also covers a pre-scheduled notification that Android delivered while JS was asleep: its `fire_at` is in the past, so the next sync counts it as sent. (`PRAGMA foreign_keys` is only switched on in migration V1 on this app, so the cascade cannot be relied on — the planner also deletes rows of items that no longer exist.)

### Notification content

- **Title:** "Service due soon" / "Service urgent" / "Service overdue".
- **Body:** `Oil Change on Beat: 150 km left`, `due in 3 days`, `due tomorrow`, `due today`, `overdue by 120 km`, `overdue by 1 day`. If both km and date have reached the level: `150 km left · due in 2 days`. Scheduled ones are worded in days.
- **Summary:** "3 services need attention", body lists up to 3 items then "+N more".
- **data:** `{ type: 'maintenance', itemId, vehicleId }` (summary: `{ type: 'maintenance_summary' }`). No sensitive data.
- **Tap:** opens `maintenance/log/<itemId>`; a summary opens Home. A tap that launched the app is read once the navigator is ready.

## As built — files

| # | File | What |
|---|------|------|
| 1 | `src/notifications/maintenancePlanner.ts` **(new)** | Pure rules: `planMaintenanceNotifications({ entries, thresholds, log, now, notifyTime, grouped }) → { notifyNow, schedule, clearLog, markSent }`, identifiers, wording, grouping. |
| 2 | `src/notifications/maintenanceNotifications.ts` **(new)** | `syncMaintenanceNotifications()`, `cancelMaintenanceNotifications()`, `syncIfStale(ms)`, debounced `requestMaintenanceSync()`. |
| 3 | `src/notifications/maintenanceSyncSignal.ts` **(new)** | Dependency-free `requestMaintenanceSync()` the repositories call; `maintenanceNotifications.ts` registers its debounced sync here. |
| 4 | `src/notifications/maintenanceResponseHandler.ts` **(new)** | Tap listener + `handleLastMaintenanceResponse()` for cold start; deduped. Imported at the top of `_layout.tsx`. |
| 5 | `src/notifications/maintenanceBootstrap.ts` **(new)** | `initMaintenanceNotifications()` (first-launch permission, register daily task, first sync) and `attachMaintenanceAppStateSync()`. |
| 6 | `src/services/maintenanceBackgroundTask.ts` **(new)** | `RIDEZEN_MAINT_CHECK` task + idempotent `registerMaintenanceCheck()`. Imported at the top of `_layout.tsx`. |
| 7 | `src/services/notificationPreferences.ts` **(new)** | The 3 settings + permission-asked flag; sync, never throws, defaults on failure. |
| 8 | `src/repositories/notifyLogRepo.ts` **(new)** | `getAll / upsert / remove / deleteFuture` for the log. |
| 9 | `src/utils/notifyTime.ts` **(new)** | `HH:MM` validate / parse / format / to-Date helpers. |
| 10 | `src/db/migrations.ts` | V9 (`CURRENT_VERSION = 9`). |
| 11 | `src/utils/reminderCheck.ts` | `parseLocalDate` / `addLocalDays` / `localDaysBetween`; `computeMaintenanceStatus` takes an optional `now` and reads dates as local days; `STATUS_RANK` exported; **`checkReminderTrigger` removed**. |
| 12 | `src/notifications/scheduler.ts` | Old `scheduleMaintenanceReminders` / `cancelAllReminders` removed; keeps handler, permission helper, channels. |
| 13 | `src/repositories/{vehicle,maintenance,fuel}Repo.ts` | `requestMaintenanceSync()` after successful writes: vehicle create / update / updateOdometer / delete, maintenance logService / updateItem, fuel add / update. |
| 14 | `src/contexts/RideSessionContext.tsx` | `endRide` → `requestMaintenanceSync()` after `addRideDistance`. |
| 15 | `src/services/backgroundLocationTask.ts` | After real movement: `await syncIfStale(5 min)`, wrapped so it can never break distance tracking. |
| 16 | `app/_layout.tsx` | Imports 4 + 6; `initMaintenanceNotifications()` in `init()` after migrations and channel setup; `attachMaintenanceAppStateSync()`; `NotificationLaunchHandler` (reads the launch tap once the navigator is ready). |
| 17 | `app/(tabs)/settings.tsx` | Real switch, Notification time row, Group switch, `SettingsRow` gains `disabled`; saving a threshold re-checks. |
| 18 | `app.json`, `package.json` | `expo-background-task ~55.0.22`, `@react-native-community/datetimepicker 8.6.0` + plugins. |
| 19 | Docs | CHANGELOG, TechnicalDesign §3 / §7.4 / §9.6 / §11.4, README, how-to-update. |

## As built — tests (`__tests__/maintNotif/`)

| File | What it checks |
|---|---|
| `maintenancePlanner.test.ts` | Levels from thresholds (boundaries), changed thresholds, wording, once per level, no repeat while overdue, reset on ok, downgrade (`markSent`), orphans, date scheduling at the notify time, past-time-today sent now, delivered-by-alarm not repeated, notify time moved later, misordered thresholds, km + date together, grouping (immediate and scheduled), several vehicles. |
| `plannerTimezone.test.ts` | Runs in **America/Los_Angeles** (via `__tests__/helpers/tzLosAngelesEnv.js`): the badge and the schedule read due dates as local days. Fails with the old UTC parsing (checked by mutation). |
| `maintenanceNotifications.test.ts` | Switch off / no permission (cancel, no prompt), cancels `maint-*` only, channel on the trigger, DATE trigger at the saved time, log rows, grouping, housekeeping order, forget on ok, downgrade, **a failed read changes nothing**, never throws, one failed send doesn't stop the rest, single-flight, debounce, `syncIfStale`. |
| `maintenanceResponseHandler.test.ts` | Item tap → service screen, summary / bad id → Home, ignores GPS idle, dedupe, cold start. |
| `maintenanceBackgroundTask.test.ts` | Task defined, success / failure results, idempotent registration, restricted OS, never throws. |
| `maintenanceBootstrap.test.ts` | First launch asks once and remembers, not asked when OFF, order (permission before first sync), never throws, resume re-check + unsubscribe. |
| `syncTriggers.test.ts` | Repository writes request a re-check on success and not on failure / no-op; fuel delete does not; the signal module is a safe no-op. |
| `settingsNotifications.test.tsx` | Switch / time / summary load and save, ON asks permission and explains a block, OFF re-checks, disabled while OFF, thresholds re-check. |
| `notificationPreferences`, `notifyLogRepo`, `notifyTime`, `migrationV9` | Defaults and failure fallbacks, SQL shapes, time helpers, the V9 table. |
| Updated `__tests__/gpsIdle/` | `scheduler` (channels + permission helper), `backgroundLocationTask` (re-check after movement), `RideSessionContext` (re-check after ride), `autoTracking` / `useTrackingMode` (mock the new module). |

```bash
npx jest __tests__/maintNotif   # feature specs
npm test                        # everything
```

**Not coverable by Jest — check on the Vivo** (full list in how-to-update.md): date reminder arrives at the chosen time with the app swiped away, and after a reboot; km reminder after a ride and after editing the odometer; tap opens the item; OFF/ON; summary vs one each; GPS idle reminder unaffected; Vivo battery settings.

## Differences from the original plan

- **`maintenanceSyncSignal.ts` is new.** The plan had repositories call `requestMaintenanceSync()` from `maintenanceNotifications.ts`, but that module reads those same repositories — an import cycle. A dependency-free signal module breaks it.
- **`maintenanceBootstrap.ts`, `notificationPreferences.ts`, `notifyLogRepo.ts`, `notifyTime.ts` are separate files** (the plan folded them into fewer).
- **Permission handling.** The plan said the sync checks permission; as built it only *checks* (it may run headless). The prompt is shown once on first launch (`notif_permission_asked`) and when the Settings switch is turned ON, which is also where a block is explained.
- **Settings changes call `syncMaintenanceNotifications()` directly** (a one-off user action), not the debounce.
- **Reads happen before cancelling.** A failed read leaves existing schedules and the log untouched.
- **`markSent` in the planner result** and **orphan cleanup** were added after working through the drop-a-level and deleted-item cases.
- **Date levels are gated on the notify time, not on the badge.** The badge turns at midnight; the notification waits for the chosen time (and a level whose time has passed today is sent now). Downgrade decisions use the badge level, so moving the notify time later on the day a level starts does not re-send what was delivered.
- **`fuelRepo.delete` does not trigger a re-check** (it never changes the odometer).
- **`checkReminderTrigger` was deleted** (nothing calls it); `reminder_settings` is left in the database but unused.
- **A real bug found and fixed on the way:** `computeMaintenanceStatus` read `"YYYY-MM-DD"` as UTC, so in negative-UTC timezones a due date was one day early. Both the badge and the planner now use the local-date helpers.
- **Test-environment finding:** `process.env` inside a Jest test is a copy, so a timezone cannot be switched from inside a test; `__tests__/helpers/tzLosAngelesEnv.js` is a custom Jest environment that does it before the sandbox is created. Anything importing `backgroundLocationTask` must also mock `@/notifications/maintenanceNotifications` (the real `expo-notifications` cannot load in Jest).

## Gotchas

1. **Delivered while JS was asleep:** the log's `fire_at` rule prevents double pings.
2. **Headless contexts** (GPS task, daily task) have no React and no router — sync only touches the DB, notifications and `app_settings`.
3. **Date parsing:** always local (`parseLocalDate`), never `new Date('YYYY-MM-DD')`.
4. **Android 12+ exact alarms:** expo-notifications uses `setExactAndAllowWhileIdle` when allowed and falls back to `setAndAllowWhileIdle`, so a reminder may be a few minutes late; no `SCHEDULE_EXACT_ALARM` permission needed.
5. **Reboot:** expo-notifications re-registers scheduled notifications after boot (`RECEIVE_BOOT_COMPLETED`), and the next launch resyncs anyway. Verify on the Vivo.
6. **WorkManager `CANCEL_AND_REENQUEUE`:** registering the daily task again restarts its 24 h timer, so it is registered only when not already registered.
7. **Vivo battery manager** may delay or kill pending alarms and the daily task — set RideZen to unrestricted background + auto-start.
8. **First sync after this update** may find several items already due or overdue. With grouping OFF (the default) that is one notification each — Android bundles four or more from one app; turn grouping ON for a single summary.
9. **Existing channel:** the `maintenance` channel already exists on the phone with DEFAULT importance (shade + sound, no heads-up banner); Android keeps a channel's importance after creation, so changing it would need a new channel id.

## Decisions (agreed 2026-11-16)

1. **Thresholds:** the global Settings values, so notifications match the badges. The per-item `reminder_settings` table is ignored.
2. **Frequency:** once per level (due → urgent → overdue). No repeat while overdue.
3. **Time of day:** the user picks it in Settings. Default 09:00.
4. **Grouping:** the user chooses summary or one each in Settings. Default one each.
5. **Daily background check:** included, via `expo-background-task`.
6. **Push notifications switch:** made real and saved. Default ON. The time and grouping options sit under it.
