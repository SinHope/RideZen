/**
 * Vehicle detail / edit screen — end to end against a real SQLite database (sql.js) with the real repository.
 * (The odometer-specific behaviour — whole-number display, keyboard handling — is in vehicle-edit-odometer.test.tsx.)
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => require('../helpers/routerMock').expoRouterMock());
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('@/notifications/maintenanceSyncSignal', () => ({ requestMaintenanceSync: jest.fn() }));
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

import { vehicleRepo } from '@/repositories/vehicleRepo';
import VehicleDetailScreen from '../../app/vehicle/[id]';
import { routerMocks, resetRouterMocks, setRouteParams } from '../helpers/routerMock';
import { TestDb, createMigratedDb, setCurrentDb } from '../helpers/testDb';

let db: TestDb;
let id: number;

const row = () => db.getFirstSync<any>('SELECT * FROM vehicles WHERE id = ?', [id]);
const input = (placeholder: string) => screen.getByPlaceholderText(placeholder);

async function renderScreen() {
  render(<VehicleDetailScreen />);
  await act(async () => {});
}
const edit = (placeholder: string, text: string) => fireEvent.changeText(input(placeholder), text);
async function updateAndConfirm() {
  fireEvent.press(screen.getByLabelText('Update vehicle'));
  await act(async () => {
    fireEvent.press(screen.getByText('Yes, update'));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetRouterMocks();
  db = await createMigratedDb();
  setCurrentDb(db);
  const created = await vehicleRepo.create({
    nickname: 'Aerox',
    type: 'scooter',
    make: 'Yamaha',
    model: 'Aerox 155',
    year: 2019,
    plate_number: 'FBR2762C',
    current_odometer: 12345.678912,
  });
  id = created.data!;
  setRouteParams({ id: String(id) });
});
afterEach(() => {
  setCurrentDb(null);
  jest.restoreAllMocks();
});

describe('showing the vehicle', () => {
  it('shows a spinner until the vehicle is loaded', async () => {
    render(<VehicleDetailScreen />);
    expect(screen.queryByText('Identity')).toBeNull();
    await act(async () => {}); // let the load finish
    expect(screen.getByText('Identity')).toBeTruthy();
  });

  it('shows its type and name in the header', async () => {
    await renderScreen();
    expect(screen.getAllByText('Scooter / CVT')).toHaveLength(2); // header + the selected type chip
    expect(screen.getAllByText('Aerox').length).toBeGreaterThan(0);
  });

  it('fills the form from what is saved', async () => {
    await renderScreen();
    expect(screen.getByDisplayValue('Aerox')).toBeTruthy();
    expect(screen.getByDisplayValue('Yamaha')).toBeTruthy();
    expect(screen.getByDisplayValue('Aerox 155')).toBeTruthy();
    expect(screen.getByDisplayValue('2019')).toBeTruthy();
    expect(screen.getByDisplayValue('FBR2762C')).toBeTruthy();
  });

  it('shows empty fields for details the vehicle does not have', async () => {
    db.runSync('UPDATE vehicles SET make = NULL, model = NULL, year = NULL, plate_number = NULL WHERE id = ?', [id]);
    await renderScreen();
    expect(input('e.g. Yamaha').props.value).toBe('');
    expect(input('e.g. 2019').props.value).toBe('');
  });

  it('the year field takes at most four digits', async () => {
    await renderScreen();
    expect(input('e.g. 2019').props.maxLength).toBe(4);
    expect(input('e.g. 2019').props.keyboardType).toBe('number-pad');
  });

  it('the back arrow leaves the screen', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(routerMocks.back).toHaveBeenCalledTimes(1);
  });
});

describe('editing', () => {
  it('Update is disabled until something changes', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Update vehicle'));
    expect(screen.queryByText('Save changes?')).toBeNull();
    edit('e.g. Yamaha', 'Honda');
    fireEvent.press(screen.getByLabelText('Update vehicle'));
    expect(screen.getByText('Save changes?')).toBeTruthy();
  });

  it('the header follows the name as it is typed, and falls back to the saved name when emptied', async () => {
    await renderScreen();
    fireEvent.changeText(screen.getByDisplayValue('Aerox'), 'Blue Aerox');
    expect(screen.getAllByText('Blue Aerox').length).toBeGreaterThan(0);
    fireEvent.changeText(screen.getByDisplayValue('Blue Aerox'), '');
    expect(screen.getAllByText('Aerox').length).toBeGreaterThan(0);
  });

  it('asks for confirmation, and Cancel saves nothing', async () => {
    await renderScreen();
    edit('e.g. Yamaha', 'Honda');
    fireEvent.press(screen.getByLabelText('Update vehicle'));
    fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByText('Save changes?')).toBeNull();
    expect(row().make).toBe('Yamaha');
  });

  it('saves the changes, shows "Saved!", and returns home', async () => {
    await renderScreen();
    fireEvent.changeText(screen.getByDisplayValue('Aerox'), '  Blue Aerox ');
    edit('e.g. Yamaha', 'Honda');
    fireEvent.changeText(screen.getByDisplayValue('Aerox 155'), 'PCX');
    edit('e.g. 2019', '2021');
    edit('e.g. FBR2762C', 'SJP1234A');
    await updateAndConfirm();

    expect(row()).toMatchObject({ nickname: 'Blue Aerox', make: 'Honda', model: 'PCX', year: 2021, plate_number: 'SJP1234A' });
    expect(screen.getByText('Saved!')).toBeTruthy();
    expect(routerMocks.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('an emptied name keeps the existing name rather than saving a blank one', async () => {
    await renderScreen();
    fireEvent.changeText(screen.getByDisplayValue('Aerox'), '   ');
    await updateAndConfirm();
    expect(row().nickname).toBe('Aerox');
  });

  it('can change the vehicle type', async () => {
    await renderScreen();
    fireEvent.press(screen.getByText('Car'));
    await updateAndConfirm();
    expect(row().type).toBe('car');
  });

  it('offers all four types', async () => {
    await renderScreen();
    for (const label of ['Scooter / CVT', 'Manual Motorcycle', 'Car', 'Other']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  // KNOWN GAP — an emptied optional field is sent as `undefined`, and the repository skips undefined fields, so
  // a make / model / year / plate can be changed but never removed. When fixed, change `it.failing` to `it`.
  it.failing('clearing the plate number removes it', async () => {
    await renderScreen();
    edit('e.g. FBR2762C', '');
    await updateAndConfirm();
    expect(row().plate_number).toBeNull();
  });

  // KNOWN GAP — the screen ignores the result of the update: a failed save still shows "Saved!" and goes home.
  // When fixed, change `it.failing` to `it`.
  it.failing('does not claim "Saved!" when the update failed', async () => {
    jest.spyOn(vehicleRepo, 'update').mockResolvedValue({ data: null, error: 'Could not update vehicle.' });
    await renderScreen();
    edit('e.g. Yamaha', 'Honda');
    await updateAndConfirm();
    expect(screen.queryByText('Saved!')).toBeNull();
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });
});

describe('deleting', () => {
  it('asks first, and Cancel keeps the vehicle', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Delete vehicle'));
    expect(screen.getByText('Delete vehicle?')).toBeTruthy();
    expect(screen.getByText(/all associated data will be removed/)).toBeTruthy();
    fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByText('Delete vehicle?')).toBeNull();
    expect(row()).not.toBeNull();
  });

  it('deleting removes the vehicle and its data, and returns home', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Delete vehicle'));
    await act(async () => {
      fireEvent.press(screen.getByText('Delete'));
    });
    expect(row()).toBeNull();
    expect(db.count('maintenance_items')).toBe(0);
    expect(routerMocks.replace).toHaveBeenCalledWith('/(tabs)');
  });

  // KNOWN GAP — same as the update: the delete result is ignored, so a failed delete still returns home as if it
  // had worked. When fixed, change `it.failing` to `it`.
  it.failing('stays on the screen when the delete failed', async () => {
    jest.spyOn(vehicleRepo, 'delete').mockResolvedValue({ data: null, error: 'Could not delete vehicle.' });
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Delete vehicle'));
    await act(async () => {
      fireEvent.press(screen.getByText('Delete'));
    });
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });
});
