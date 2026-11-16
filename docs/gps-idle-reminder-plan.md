# GPS Idle Reminder — Implementation Plan

**Status:** implemented 2026-11-16; all `__tests__/gpsIdle` tests pass (9 suites / 65 tests overall). **On-device verification on the Vivo still pending.**
**Spec:** `__tests__/gpsIdle/` — goal is `npx jest __tests__/gpsIdle` all green. Each test file's header comment lists the exact exports/constants to create.

## Feature

When the rider stops moving for ~60 s while GPS tracking is on, show a local notification with two buttons: **Turn off GPS** / **Leave it**.

## Current behaviour (verified in code)

GPS never stops by itself.
- **Manual** (`RideSessionContext.tsx`): `watchPositionAsync` runs until the user taps End Ride.
- **Auto** (`useTrackingMode.ts`): background task + foreground service runs until switched to Manual, or killed by the OS (Vivo battery saver).
- `distanceInterval: 10` only means the OS sends no updates while still; GPS stays on.

## Design: dead-man's switch

Every real movement (≥ 10 m) schedules a local notification 60 s ahead under the fixed ID `ridezen-gps-idle` (re-scheduling replaces it). While moving it never fires; 60 s after the rider stops, the OS fires it even if JS is asleep. "Leave it" needs no extra logic: nothing re-arms until the rider moves again. It is a **local** notification — no server, app stays local-only.

## Files

| # | File | Change |
|---|------|--------|
| 1 | `src/notifications/idleReminder.ts` **(new)** | Constants `IDLE_REMINDER_ID='ridezen-gps-idle'`, `IDLE_REMINDER_CATEGORY='gps_idle'`, `IDLE_REMINDER_CHANNEL='ride_tracking'`, `IDLE_REMINDER_SECONDS=60`, `IDLE_REARM_THROTTLE_MS=10000`, `ACTION_TURN_OFF_GPS='TURN_OFF_GPS'`, `ACTION_LEAVE_IT='LEAVE_IT'`. `setupIdleReminderCategory()` (2 buttons, `opensAppToForeground:false`). `armIdleReminder()` (throttled 10 s, never throws, failed schedule must not start the throttle). `cancelIdleReminder()` (cancel + dismiss, resets throttle, never throws). |
| 2 | `src/notifications/idleResponseHandler.ts` **(new)** | Exports `IDLE_RESPONSE_TASK='RIDEZEN_IDLE_RESPONSE'`, `handleIdleReminderResponse()`, `onManualRideStopRequested(listener)→unsubscribe`. On import: `addNotificationResponseReceivedListener` **and** `TaskManager.defineTask` + `Notifications.registerTaskAsync` (needed on Android when the app is killed). Dedupe the same tap (listener + task can both fire; key on `notification.date`). Ignore body taps and non-`gps_idle` data. Auto → `disableAutoTracking()`; Manual → notify `onManualRideStopRequested` listeners. Dismiss afterwards. Never throws. Also check `getLastNotificationResponseAsync()` on launch. |
| 3 | `src/services/autoTracking.ts` **(new)** | `disableAutoTracking()`: stop `RIDEZEN_BG_LOCATION` if running, `clearBgLastCoords`, `setTrackingMode('manual')`, `cancelIdleReminder()`. Safe when nothing runs; still saves manual mode if stopping throws. |
| 4 | `src/services/backgroundLocationTask.ts` | Call `armIdleReminder()` inside `if (km >= MIN_DELTA_KM)`. Not on jitter, not on first fix (no `last`), not when mode ≠ auto. |
| 5 | `src/contexts/RideSessionContext.tsx` | Arm on `startRide`; arm on real movement (`delta >= MIN_DELTA_KM`); `cancelIdleReminder()` in `endRide`; subscribe to `onManualRideStopRequested` and call `endRide` using **latest** state (stale-closure trap — use a ref); unsubscribe on unmount. |
| 6 | `src/hooks/useTrackingMode.ts` | `switchToManual` → `disableAutoTracking()` (keeps `setMode('manual')`). Re-read `getTrackingMode()` on `AppState` → `active` so the UI follows a change made from the notification. |
| 7 | `src/notifications/scheduler.ts` | `setupAndroidChannel`: add `ride_tracking` channel, importance ≥ HIGH. **Bug fix:** `scheduleMaintenanceReminders` and `cancelAllReminders` call `cancelAllScheduledNotificationsAsync()` which would delete the idle reminder → cancel only notifications whose `data.type !== 'gps_idle'` (via `getAllScheduledNotificationsAsync` + `cancelScheduledNotificationAsync(identifier)`). Ask notification permission when a ride starts / auto mode is enabled. |
| 8 | `app/_layout.tsx` | Import `idleResponseHandler` at the top (next to `backgroundLocationTask`); call `setupIdleReminderCategory()` in `init()`. |
| 9 | Docs | CHANGELOG entry + TechnicalDesign.md section when built. |

## Gotchas found while double-checking

1. **`channelId` goes on the `trigger`, not `content`** (expo-notifications SDK 55 types). The existing maintenance code puts it on `content`, where it is ignored. Wrong placement → falls into the default channel → buttons hidden.
2. **Killed-app button taps on Android** need `registerTaskAsync` (see file 2). A plain listener will not fire.
3. **Double delivery** of one tap → dedupe.
4. **Stale `endRide`** — handler must end the current ride, otherwise distance is lost.
5. **Throttle reset** in `cancelIdleReminder`, else a new ride within 10 s is not armed.
6. **Do not arm at auto-mode start** — auto starts every app launch; would nag at home.
7. **Possible manual-mode problem (check first on the Vivo):** manual mode uses `watchPositionAsync` with no foreground service; Android may stop updates after the phone locks → false "you stopped" reminders and under-counted distance. Test: start manual ride, lock phone, ride ~1 km, check distance. If not counted, manual mode needs a foreground service (bigger change, separate task).

## Decisions (recommended defaults, user may override)

- Both modes get the reminder (auto: "Turn off GPS" = switch to Manual).
- 60 s as requested (one constant).
- "Turn off GPS" works in the background; fall back to opening the app only if killed-app handling fails on the Vivo.

## Testing

```bash
npx jest __tests__/gpsIdle            # feature specs (red until built)
npx jest __tests__/rideSession.test.ts  # baseline (green)
npm test                              # everything
npm run test:watch
```

Jest + jest-expo (Android preset) + React Native Testing Library. Not coverable by Jest — user tests manually on the Vivo: banner + buttons appear, Turn off GPS (app open / backgrounded / swiped away), Leave it, maintenance reminders don't remove the idle one.

Known unrelated failure: `__tests__/vehicle-edit-odometer.test.tsx` crashes on startup (Reanimated/worklets native init under Jest) — not part of this feature.
