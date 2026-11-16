/**
 * Log Service screen — end to end against a real SQLite database (sql.js) with the real repositories:
 * what the rider sees, what "Log Service" and "Save" write, and the service history.
 * "Today" is frozen at 17 Nov 2026.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => require('../helpers/routerMock').expoRouterMock());
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('@/notifications/maintenanceSyncSignal', () => ({ requestMaintenanceSync: jest.fn() }));
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';
import LogServiceScreen from '../../app/maintenance/log/[itemId]';
import { routerMocks, resetRouterMocks, setRouteParams } from '../helpers/routerMock';
import { TestDb, addItem, addVehicle, createMigratedDb, freezeClock, setCurrentDb, unfreezeClock } from '../helpers/testDb';

/** YYYY-MM-DD, n days from the frozen today (2026-11-17). */
const plusDays = (n: number) => new Date(Date.UTC(2026, 10, 17 + n)).toISOString().slice(0, 10);

let db: TestDb;
let vehicleId: number;
let itemId: number;

const field = (label: string) => screen.getByLabelText(label);
const value = (label: string) => field(label).props.value;
const typeInto = (label: string, text: string) => fireEvent.changeText(field(label), text);
const row = () => db.getFirstSync<any>('SELECT * FROM maintenance_items WHERE id = ?', [itemId])!;
const history = () => db.getAllSync<any>('SELECT * FROM maintenance_logs WHERE item_id = ? ORDER BY id', [itemId]);

async function renderScreen() {
  render(<LogServiceScreen />);
  await act(async () => {});
}

/** Press a header button, then the matching button of the confirmation alert. */
async function confirmAlert(headerLabel: string, buttonText: string) {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(headerLabel));
  });
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2];
  await act(async () => {
    await buttons.find((b: any) => b.text === buttonText).onPress();
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetRouterMocks();
  freezeClock(2026, 10, 17);
  db = await createMigratedDb();
  setCurrentDb(db);
  vehicleId = addVehicle(db, { nickname: 'Aerox', odo: 5000.3 });
  itemId = addItem(db, vehicleId, {
    category: 'Engine Oil',
    interval_km: 5000,
    interval_days: 90,
    next_due_odo: 5200,
    next_due_date: plusDays(30),
  });
  setRouteParams({ itemId: String(itemId) });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  unfreezeClock();
  setCurrentDb(null);
  jest.restoreAllMocks();
});

describe('what the rider sees', () => {
  it('shows "Loading…" until the item is ready', async () => {
    render(<LogServiceScreen />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    await act(async () => {}); // let the load finish
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('is titled with the item and shows its status and next due', async () => {
    await renderScreen();
    expect(screen.getByText('Engine Oil')).toBeTruthy();
    expect(screen.getByText('Urgent')).toBeTruthy(); // 200 km left
    expect(screen.getByText(`Next due at ${(5200).toLocaleString()} km · ${(200).toLocaleString()} km left`)).toBeTruthy();
    expect(screen.getByText(`Or by ${plusDays(30)}`)).toBeTruthy();
  });

  it('starts the form from the item\'s current settings', async () => {
    db.runSync(`UPDATE maintenance_items SET notes = 'Motul 10W-40' WHERE id = ?`, [itemId]);
    await renderScreen();
    expect(value('Odometer at service')).toBe('5000'); // current odometer, rounded
    expect(value('Due for service in (km)')).toBe('5000');
    expect(value('Next due date')).toBe(plusDays(30));
    expect(value('Remarks')).toBe('Motul 10W-40');
  });

  it('leaves the optional fields empty for an item with nothing set', async () => {
    const bare = addItem(db, vehicleId, { category: 'Vehicle Wash' });
    setRouteParams({ itemId: String(bare) });
    await renderScreen();
    expect(value('Due for service in (km)')).toBe('');
    expect(value('Next due date')).toBe('');
    expect(value('Remarks')).toBe('');
    expect(screen.queryByText(/Next due at/)).toBeNull();
  });

  it('the back arrow leaves the screen', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(routerMocks.back).toHaveBeenCalledTimes(1);
  });
});

describe('service history', () => {
  const log = (date: string, over: object = {}) =>
    db.runSync(
      `INSERT INTO maintenance_logs (item_id, vehicle_id, date, odometer, cost, workshop, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [itemId, vehicleId, date, (over as any).odometer ?? null, (over as any).cost ?? null, (over as any).workshop ?? null, (over as any).notes ?? null]
    );

  it('is not shown when the item was never serviced', async () => {
    await renderScreen();
    expect(screen.queryByText('Service history')).toBeNull();
  });

  it('lists past services newest first, with workshop, cost and notes', async () => {
    log('2026-03-01', { odometer: 2000, workshop: 'Ah Seng', cost: 45.5, notes: 'first change' });
    log('2026-09-09', { odometer: 4100 });
    await renderScreen();

    expect(screen.getByText('Service history')).toBeTruthy();
    expect(screen.getByText('Ah Seng')).toBeTruthy();
    expect(screen.getByText('SGD 45.50')).toBeTruthy();
    expect(screen.getByText('first change')).toBeTruthy();
    expect(screen.getByText(`${(4100).toLocaleString()} km`)).toBeTruthy();
  });

  it('shows at most the five most recent', async () => {
    for (let i = 1; i <= 7; i++) log(`2026-0${i}-01`);
    await renderScreen();
    expect(screen.queryByText('2026-01-01')).toBeNull();
    expect(screen.queryByText('2026-02-01')).toBeNull();
    expect(screen.getByText('2026-07-01')).toBeTruthy();
  });
});

describe('Log Service', () => {
  it('needs a valid odometer reading', async () => {
    await renderScreen();
    for (const bad of ['', '0', 'abc']) {
      typeInto('Odometer at service', bad);
      fireEvent.press(screen.getByLabelText('Log service'));
      expect(Alert.alert).toHaveBeenLastCalledWith('Invalid', 'Enter a valid odometer reading.');
    }
    expect(history()).toHaveLength(0);
  });

  it('asks before recording anything', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Log service'));
    const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
    expect(title).toBe('Log Service');
    expect(message).toMatch(/recorded as a service entry/);
    expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Log Service']);
    expect(history()).toHaveLength(0);
  });

  it('records the service in the history with what was typed', async () => {
    await renderScreen();
    typeInto('Odometer at service', '5100');
    typeInto('Cost', '45.5');
    typeInto('Workshop', 'Ah Seng Motors');
    typeInto('Notes', 'Used 10W-40');
    await confirmAlert('Log service', 'Log Service');

    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({
      item_id: itemId,
      vehicle_id: vehicleId,
      date: '2026-11-17',
      odometer: 5100,
      cost: 45.5,
      workshop: 'Ah Seng Motors',
      notes: 'Used 10W-40',
    });
  });

  it('resets the item: last done now, next due km = odometer + interval', async () => {
    await renderScreen();
    typeInto('Odometer at service', '5100');
    await confirmAlert('Log service', 'Log Service');
    expect(row()).toMatchObject({ last_changed_date: '2026-11-17', last_changed_odo: 5100, next_due_odo: 10100 });
  });

  it('a new interval applies to the next due km', async () => {
    await renderScreen();
    typeInto('Odometer at service', '5100');
    typeInto('Due for service in (km)', '3000');
    await confirmAlert('Log service', 'Log Service');
    expect(row()).toMatchObject({ interval_km: 3000, next_due_odo: 8100 });
  });

  it('the remarks become the item\'s note', async () => {
    await renderScreen();
    typeInto('Remarks', 'Switched to synthetic');
    await confirmAlert('Log service', 'Log Service');
    expect(row().notes).toBe('Switched to synthetic');
  });

  it('closes the screen and asks the notification planner to re-check', async () => {
    await renderScreen();
    await confirmAlert('Log service', 'Log Service');
    expect(routerMocks.back).toHaveBeenCalledTimes(1);
    expect(requestMaintenanceSync).toHaveBeenCalled();
  });

  it('Cancel on the confirmation changes nothing', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Log service'));
    const cancel = (Alert.alert as jest.Mock).mock.calls.at(-1)![2].find((b: any) => b.text === 'Cancel');
    expect(cancel.onPress).toBeUndefined();
    expect(history()).toHaveLength(0);
    expect(routerMocks.back).not.toHaveBeenCalled();
  });

  it('explains a failed save and stays on the screen', async () => {
    jest.spyOn(maintenanceRepo, 'logService').mockResolvedValue({ data: null, error: 'Could not save service log. Please try again.' });
    await renderScreen();
    await confirmAlert('Log service', 'Log Service');
    expect(Alert.alert).toHaveBeenLastCalledWith('Error', 'Could not save service log. Please try again.');
    expect(routerMocks.back).not.toHaveBeenCalled();
  });

  // KNOWN GAP — the "Next due date" field is pre-filled with the item's CURRENT due date, and any date in that
  // field wins over the interval. So logging a service without touching it keeps the old (often overdue) date, and
  // a date-based item stays overdue after being serviced. Fix: only send a due date the rider actually edited.
  // When fixed, change `it.failing` to `it`.
  it.failing('moves a date-based due date forward from the service date', async () => {
    db.runSync(`UPDATE maintenance_items SET interval_km = NULL, next_due_odo = NULL, interval_days = 90, next_due_date = ? WHERE id = ?`, [
      plusDays(-1),
      itemId,
    ]); // overdue by date
    await renderScreen();
    await confirmAlert('Log service', 'Log Service');
    expect(row().next_due_date).toBe(plusDays(90));
  });
});

describe('Save (without logging a service)', () => {
  it('asks first, and says no history entry will be made', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Save changes without logging'));
    const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
    expect(title).toBe('Save Changes');
    expect(message).toMatch(/no service history entry/);
    expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Save']);
  });

  it('saves the item settings without a history entry', async () => {
    await renderScreen();
    typeInto('Due for service in (km)', '8000');
    typeInto('Next due date', '2027-03-01');
    typeInto('Remarks', 'Changed my mind');
    await confirmAlert('Save changes without logging', 'Save');

    expect(history()).toHaveLength(0);
    expect(row()).toMatchObject({
      interval_km: 8000,
      next_due_odo: 13000, // current odometer 5000.3 + 8000, rounded
      next_due_date: '2027-03-01',
      notes: 'Changed my mind',
    });
    expect(routerMocks.back).toHaveBeenCalledTimes(1);
  });

  it('explains a failed save and stays on the screen', async () => {
    jest.spyOn(maintenanceRepo, 'updateItem').mockResolvedValue({ data: null, error: 'Could not update item.' });
    await renderScreen();
    await confirmAlert('Save changes without logging', 'Save');
    expect(Alert.alert).toHaveBeenLastCalledWith('Error', 'Could not update item.');
    expect(routerMocks.back).not.toHaveBeenCalled();
  });
});

describe('the service date field', () => {
  it('starts on today', async () => {
    await renderScreen();
    expect(value('Service date')).toBe('2026-11-17');
  });

  it('what the rider types is the date recorded', async () => {
    await renderScreen();
    typeInto('Service date', '2026-11-10');
    await confirmAlert('Log service', 'Log Service');
    expect(history()[0].date).toBe('2026-11-10');
  });

  // KNOWN GAP — the default comes from new Date().toISOString() (UTC), not the local calendar day. In Singapore
  // (UTC+8) between midnight and 8 am the form therefore offers YESTERDAY'S date. (The Log Refuel form uses the
  // local date correctly.) The test picks a moment where the local and UTC dates differ in whatever timezone it
  // runs in; in UTC itself the two always agree, so it is skipped there. When fixed, change `it.failing` to `it`.
  const offset = new Date().getTimezoneOffset(); // minutes behind UTC; negative = ahead
  const maybeFailing = offset === 0 ? it.skip : it.failing;
  maybeFailing('defaults to today in the rider\'s own timezone, not the UTC date', async () => {
    unfreezeClock();
    freezeClock(2026, 10, 17, offset < 0 ? 0 : 23, 30); // just after local midnight (ahead of UTC) / just before it (behind)
    await renderScreen();
    expect(value('Service date')).toBe('2026-11-17');
  });
});
