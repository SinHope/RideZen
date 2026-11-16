// Repositories ask for a maintenance-notification re-check after every write that can change a due level
// (odometer, items, service logs). Wiring them here means no screen can forget to do it.
// Modules under test (EXIST, need change): src/repositories/{vehicleRepo,maintenanceRepo,fuelRepo}.ts
// Depends on (NOT YET IMPLEMENTED): src/notifications/maintenanceSyncSignal.ts → requestMaintenanceSync()
//   - a dependency-free module (repositories must not import maintenanceNotifications, which imports them)
//
// Rules: call it AFTER a successful write only; never after a failed write or a no-op.

jest.mock('@/db/client', () => ({ getDb: jest.fn() }));
jest.mock('@/db/seeds', () => ({ seedMaintenanceItems: jest.fn() }));
jest.mock('@/notifications/maintenanceSyncSignal', () => ({ requestMaintenanceSync: jest.fn() }));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import { getDb } from '@/db/client';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { fuelRepo } from '@/repositories/fuelRepo';

const mSync = requestMaintenanceSync as jest.Mock;

let db: { runSync: jest.Mock; getFirstSync: jest.Mock; getAllSync: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  db = {
    runSync: jest.fn().mockReturnValue({ lastInsertRowId: 9, changes: 1 }),
    getFirstSync: jest.fn().mockReturnValue({
      id: 1, vehicle_id: 1, category: 'Oil', next_due_odo: 3000, interval_km: 3000, notes: null,
    }),
    getAllSync: jest.fn().mockReturnValue([]),
  };
  (getDb as jest.Mock).mockReturnValue(db);
});

function failWrites() {
  db.runSync.mockImplementation(() => {
    throw new Error('disk full');
  });
}

const VEHICLE_INPUT = { nickname: 'Beat', type: 'scooter', current_odometer: 100 } as any;
const FUEL_INPUT = { vehicle_id: 1, date: '2026-11-16', odometer: 5000, litres: 4, is_full_tank: true } as any;
const SERVICE_INPUT = { item_id: 1, vehicle_id: 1, date: '2026-11-16', odometer: 5000 } as any;

describe('vehicleRepo', () => {
  it.each([
    ['create', () => vehicleRepo.create(VEHICLE_INPUT)],
    ['update', () => vehicleRepo.update(1, { nickname: 'Beat 2' })],
    ['updateOdometer', () => vehicleRepo.updateOdometer(1, 5000)],
    ['delete', () => vehicleRepo.delete(1)],
  ])('%s requests a re-check after a successful write', async (_name, run) => {
    await run();
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['create', () => vehicleRepo.create(VEHICLE_INPUT)],
    ['update', () => vehicleRepo.update(1, { nickname: 'Beat 2' })],
    ['updateOdometer', () => vehicleRepo.updateOdometer(1, 5000)],
    ['delete', () => vehicleRepo.delete(1)],
  ])('%s does NOT request one when the write fails', async (_name, run) => {
    failWrites();
    const result = await run();
    expect(result.error).toBeTruthy();
    expect(mSync).not.toHaveBeenCalled();
  });

  it('update with nothing to change writes nothing and requests nothing', async () => {
    await vehicleRepo.update(1, {});
    expect(db.runSync).not.toHaveBeenCalled();
    expect(mSync).not.toHaveBeenCalled();
  });
});

describe('maintenanceRepo', () => {
  it('logService requests a re-check (the item just reset to ok)', async () => {
    const result = await maintenanceRepo.logService(SERVICE_INPUT);
    expect(result.error).toBeNull();
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it('logService does not request one when the item does not exist', async () => {
    db.getFirstSync.mockReturnValue(null);
    const result = await maintenanceRepo.logService(SERVICE_INPUT);
    expect(result.error).toBeTruthy();
    expect(mSync).not.toHaveBeenCalled();
  });

  it('logService does not request one when the write fails', async () => {
    failWrites();
    await maintenanceRepo.logService(SERVICE_INPUT);
    expect(mSync).not.toHaveBeenCalled();
  });

  it('updateItem requests a re-check (due values changed)', async () => {
    await maintenanceRepo.updateItem(1, { next_due_odo: 4000 });
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it('updateItem with no allowed field requests nothing', async () => {
    await maintenanceRepo.updateItem(1, { category: 'ignored' } as any);
    expect(mSync).not.toHaveBeenCalled();
  });

  it('updateItem does not request one when the write fails', async () => {
    failWrites();
    await maintenanceRepo.updateItem(1, { next_due_odo: 4000 });
    expect(mSync).not.toHaveBeenCalled();
  });
});

describe('fuelRepo (a refuel can raise the odometer)', () => {
  it.each([
    ['add', () => fuelRepo.add(FUEL_INPUT)],
    ['update', () => fuelRepo.update(3, FUEL_INPUT)],
  ])('%s requests a re-check after a successful write', async (_name, run) => {
    await run();
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['add', () => fuelRepo.add(FUEL_INPUT)],
    ['update', () => fuelRepo.update(3, FUEL_INPUT)],
  ])('%s does NOT request one when the write fails', async (_name, run) => {
    failWrites();
    const result = await run();
    expect(result.error).toBeTruthy();
    expect(mSync).not.toHaveBeenCalled();
  });

  it('delete does not (it never changes the vehicle odometer)', async () => {
    await fuelRepo.delete(3);
    expect(mSync).not.toHaveBeenCalled();
  });
});

describe('the signal module itself', () => {
  it('is a safe no-op until the sync routine registers itself, and survives a failing requester', () => {
    jest.isolateModules(() => {
      const real = jest.requireActual('@/notifications/maintenanceSyncSignal');
      expect(() => real.requestMaintenanceSync()).not.toThrow();

      const requester = jest.fn(() => {
        throw new Error('boom');
      });
      real.registerMaintenanceSyncRequester(requester);
      expect(() => real.requestMaintenanceSync()).not.toThrow();
      expect(requester).toHaveBeenCalledTimes(1);

      real.registerMaintenanceSyncRequester(null);
      expect(() => real.requestMaintenanceSync()).not.toThrow();
      expect(requester).toHaveBeenCalledTimes(1);
    });
  });
});
