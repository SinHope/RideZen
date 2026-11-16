# RideZen — Testing

**49 suites / 1,113 tests, all passing. ~98% statement coverage** across `src/` and `app/` (it was 35% before the full-project test pass). The only files below 90% are `logger.ts` (it is broken — see Known gaps), `scheduler.ts` and `backgroundLocationTask.ts` (native-only branches), and `types/index.ts` (types only, no code).

## Running

| Command | What it does |
|---|---|
| `npm test` | Every test once (~1.5–2 min; first run is slower) |
| `npm run test:watch` | Stays open and re-runs tests related to files changed since your last commit (`a` = all, `f` = failed only, `p`/`t` = filter by file / test name, `q` = quit) |
| `npx jest __tests__/data` | One folder |
| `npx jest path/to/file.test.ts -t "part of a test name"` | One file, or one test |
| `npx jest --coverage --collectCoverageFrom='src/**/*.{ts,tsx}' --collectCoverageFrom='app/**/*.{ts,tsx}'` | Coverage report |

Tests are TypeScript run through Babel (`jest-expo/android` preset) — Jest does **not** type-check them. Run `npx tsc --noEmit` for that (the test files are clean).

## What lives where (`__tests__/`)

| Folder | Covers | How |
|---|---|---|
| `data/` | Migrations V1–V9 (fresh install **and** upgrades from old versions), seed catalogue, `vehicleRepo`, `fuelRepo` (consumption chain, monthly stats), `maintenanceRepo`, `reminderRepo`, `getDb` | **Real SQLite** (see below) |
| `utils/` | `reminderCheck` (status rules, thresholds), `consumption`, `cn`, `flags`, `logger` | Pure / real DB |
| `services/` | `currencyService`, `trackingPreferences`, PDF `export` | Real DB; network and native modules faked |
| `hooks/` | `useVehicles`, `useFuelLogs`, `useMaintenance`, `useTrackingMode` flows | Repositories faked |
| `components/` | Every component in `src/components/` | React Native Testing Library |
| `screens/` | Every screen in `app/` (Home, Fuel, Service, Settings, Add Vehicle, Vehicle detail, Log Refuel, Edit Refuel, Log Service, tab bar, root layout) | RNTL; the data-heavy ones (Log Service, Vehicle detail) run against the real DB |
| `maintNotif/` | Maintenance push notifications (planner, sync, bootstrap, tap handling, V9, Settings controls) | See `docs/maintenance-notifications-plan.md` |
| `gpsIdle/` | GPS idle reminder, ride session, auto-tracking | See `docs/gps-idle-reminder-plan.md` |
| `helpers/` | `testDb.ts`, `routerMock.tsx`, `tzLosAngelesEnv.js` | Shared by the tests above |

## The helpers

- **`helpers/testDb.ts` — a real database for tests.** `sql.js` (SQLite compiled to WebAssembly, a **dev dependency**) sits behind the same synchronous API as `expo-sqlite` (`execSync / runSync / getAllSync / getFirstSync`). Repository, seed and migration tests therefore run the app's *actual SQL* — constraints, cascades, aggregates — instead of string-matching it. Use it with `jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }))`, then `setCurrentDb(await createMigratedDb())` in `beforeEach`. It also has `freezeClock()` (fakes only `Date`, so timers and promises still work) and small fixtures (`addVehicle`, `addItem`).
- **`helpers/routerMock.tsx`** — a stand-in for `expo-router` (`router.push/replace/back`, route params, and a `useFocusEffect` that runs on mount like a screen gaining focus).
- **`helpers/tzLosAngelesEnv.js`** — a Jest environment that runs a file in the `America/Los_Angeles` timezone (a negative UTC offset; the dev machine is UTC+8), used to catch off-by-one-day date bugs.

## Conventions

- **Known gaps use `it.failing`.** When a test exposes a real bug that has not been fixed, it is written as the *correct* behaviour inside `it.failing(...)`, with a `// KNOWN GAP` comment. The suite stays green; the day someone fixes the bug, that test starts "failing" (Jest says *"Failing test passed even though it was supposed to fail"*) — change `it.failing` to `it` and it becomes a normal regression test. Each one was run as a normal test to confirm it fails for the intended reason, not by accident.
- **Mutation spot-checks.** After writing tests, a few lines of source were deliberately broken (e.g. `consumption × 10`, `odometer - interval`, month off by one) to confirm tests fail. Two weak assertions were found this way and strengthened.
- **Today is frozen** (usually 17 Nov 2026) wherever dates matter, using local noon so the UTC and local calendar days agree in any timezone.
- Tests describe behaviour in plain words (`'a back-dated fill re-computes its neighbours'`) so a failure reads like a sentence.

## Gotchas (each cost real time once)

- **`sql.js` fails inside the Expo test setup** with an *empty* error message: `expo/src/winter` replaces the global `TextDecoder` with a polyfill that cannot decode WebAssembly memory. `testDb.ts` swaps in Node's `TextDecoder` only while the engine initialises.
- **`jest.mock` factories** may only reference variables named `mock…`, and they run *before* `const`s declared further down — use function declarations, or build the mock inside the factory (e.g. `expo-splash-screen`, whose `preventAutoHideAsync()` is called at import time).
- **Real `expo-notifications` cannot load in Jest.** Anything that imports `backgroundLocationTask` / `autoTracking` / `useTrackingMode` must mock `@/notifications/maintenanceNotifications` (and `scheduler`).
- **`process.env` inside a test is a copy** — setting `TZ` there does nothing; use the custom environment above.
- **Stale timers leak between tests.** The Home screen schedules a real 1.2 s timer on every focus; left running it fires inside a *later* test and consumes a one-shot flag. That file uses fake timers throughout.
- **React `act` warnings** mean state changed after the test ended — await the load (`await act(async () => {})`) before the test returns.
- The Android `Switch` exposes `on` / `enabled` props (not `value` / `disabled`); `FlashList` needs layout, so tests replace it with a plain list; `jest.replaceProperty(Platform, 'OS', 'ios')` switches platform for one test.
- Slow machines: `package.json` sets `"testTimeout": 30000` because the Settings screen can exceed Jest's 5 s default when ~50 suites run in parallel.

## Known gaps found by the tests (not fixed)

These are real defects the tests documented. Nothing here was changed in the app.

| # | Where | What happens | Likely fix | Test |
|---|---|---|---|---|
| 1 | `src/utils/logger.ts` | **The error log file is never written.** SDK 55 removed `writeAsStringAsync`, `documentDirectory`, etc. from the main `expo-file-system` entry (they live in `expo-file-system/legacy`); the old names throw and `logToFile`'s `catch` hides it. So no error/crash is ever logged to disk. (It also overwrites rather than appends.) | Import from `expo-file-system/legacy`, or move to the `File` API | `utils/logger.test.ts` (3) |
| 2 | `app/maintenance/log/[itemId].tsx` | **Logging a service does not move a date-based due date forward.** "Next due date" is pre-filled with the current date and wins over the interval, so a date-based item stays overdue after being serviced. | Send `new_due_date` only if the rider edited it | `screens/logService.test.tsx` |
| 3 | same screen | **Service date defaults to the UTC date** (`toISOString`), i.e. *yesterday* in Singapore between 00:00 and 08:00. (Log Refuel does it correctly.) | Use `toLocalDateString()` | `screens/logService.test.tsx` |
| 4 | `app/fuel/add/[vehicleId].tsx` | The odometer is pre-filled with GPS decimals (`12345.678912`); Edit Vehicle already rounds. | `Math.round(...)` | `screens/fuelForms.test.tsx` |
| 5 | `src/components/CurrencyPickerModal.tsx` | Rows of the full list keep a **stale `onSelect`** (`useCallback(..., [selected])`). In the refuel form, changing a currency after typing a price wipes the converted amount instead of re-converting it. | Add `onSelect` / `onClose` to the deps (or `useRef`) | `components/modals.test.tsx`, `screens/fuelForms.test.tsx` |
| 6 | `app/vehicle/[id].tsx` | An emptied make / model / year / plate is sent as `undefined` and skipped, so those fields can be changed but **never cleared**. | Send `null` for emptied fields | `screens/vehicleDetail.test.tsx` |
| 7 | same screen | The result of update / delete is ignored: a **failed save still shows "Saved!"** and a failed delete still returns home. | Check `result.error` | `screens/vehicleDetail.test.tsx` (2) |
| 8 | `src/db/client.ts` + migration V1 | `PRAGMA foreign_keys = ON` runs only in migration V1 (first install). Each later launch is a new connection with foreign keys **off**, so `ON DELETE CASCADE` does not run: deleting a vehicle leaves its fuel logs, items and history behind as orphans (invisible, but they waste space). The notification planner already cleans up after this. | Run the pragma every time `getDb()` opens the database | `data/vehicleRepo.test.ts` |

Also noticed while reading (not pinned by tests):

- The Home greeting and the Settings header hard-code the name **"Nasmer"** for every user.
- With an expired exchange-rate cache and no network, `getRates()` returns `null` instead of falling back to the stale rates (pinned in `currencyService.test.ts` as current behaviour).
- The PDF report inserts vehicle names and notes into HTML **without escaping**, so a name containing `<` would break the layout.
- For vehicle type "Other", the *Model* field is ignored in favour of *Description*.
- The `error` value returned by `useVehicles` / `useFuelLogs` / `useMaintenance` is never shown by any screen (a failed load looks like an empty list).
- An unknown vehicle id on the vehicle screen shows the spinner forever.
