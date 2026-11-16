/**
 * useVehicles, useFuelLogs, useMaintenance — the thin state layer between the repositories and the screens.
 * The repositories are faked; what matters here is loading / error state, reloads after changes, and the
 * derived counts / filters.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/repositories/vehicleRepo', () => ({
  vehicleRepo: { getAll: jest.fn(), create: jest.fn(), delete: jest.fn(), updateOdometer: jest.fn() },
}));
jest.mock('@/repositories/fuelRepo', () => ({
  fuelRepo: { getByVehicle: jest.fn(), getMonthlyStats: jest.fn(), add: jest.fn(), delete: jest.fn() },
}));
jest.mock('@/repositories/maintenanceRepo', () => ({
  maintenanceRepo: { getByVehicle: jest.fn(), logService: jest.fn() },
}));

import { useFuelLogs } from '@/hooks/useFuelLogs';
import { useMaintenance } from '@/hooks/useMaintenance';
import { useVehicles } from '@/hooks/useVehicles';
import { fuelRepo } from '@/repositories/fuelRepo';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import type { FuelLog, MaintenanceItem, Vehicle } from '@/types';

const mVehicles = vehicleRepo as jest.Mocked<typeof vehicleRepo>;
const mFuel = fuelRepo as jest.Mocked<typeof fuelRepo>;
const mMaint = maintenanceRepo as jest.Mocked<typeof maintenanceRepo>;

const vehicle = (id: number): Vehicle => ({
  id,
  nickname: `V${id}`,
  type: 'scooter',
  current_odometer: 1000,
  created_at: '',
  updated_at: '',
});
const fuelLog = (id: number): FuelLog => ({
  id,
  vehicle_id: 1,
  date: '2026-11-01',
  odometer: 1000 + id,
  litres: 5,
  is_full_tank: 1,
  created_at: '',
});
const item = (id: number, status: MaintenanceItem['status']): MaintenanceItem => ({
  id,
  vehicle_id: 1,
  category: `Item ${id}`,
  vehicle_type_scope: 'universal',
  updated_at: '',
  status,
});

beforeEach(() => jest.clearAllMocks());

// ─── useVehicles ──────────────────────────────────────────────────────────────

describe('useVehicles', () => {
  beforeEach(() => {
    mVehicles.getAll.mockResolvedValue({ data: [vehicle(1), vehicle(2)], error: null });
  });

  it('starts loading, then has the vehicles', async () => {
    const { result } = renderHook(() => useVehicles());
    expect(result.current.loading).toBe(true);
    expect(result.current.vehicles).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.vehicles.map((v) => v.id)).toEqual([1, 2]);
    expect(result.current.error).toBeNull();
  });

  it('exposes the error and keeps the list empty when loading fails', async () => {
    mVehicles.getAll.mockResolvedValue({ data: null, error: 'Could not load your vehicles.' });
    const { result } = renderHook(() => useVehicles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Could not load your vehicles.');
    expect(result.current.vehicles).toEqual([]);
  });

  it('reload fetches again', async () => {
    const { result } = renderHook(() => useVehicles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    mVehicles.getAll.mockResolvedValue({ data: [vehicle(3)], error: null });

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.vehicles.map((v) => v.id)).toEqual([3]);
  });

  describe('addVehicle', () => {
    it('creates, reloads the list and returns the new id', async () => {
      mVehicles.create.mockResolvedValue({ data: 9, error: null });
      const { result } = renderHook(() => useVehicles());
      await waitFor(() => expect(result.current.loading).toBe(false));
      mVehicles.getAll.mockResolvedValue({ data: [vehicle(9)], error: null });

      let id: number | null = null;
      await act(async () => {
        id = await result.current.addVehicle({ nickname: 'New', type: 'scooter', current_odometer: 0 });
      });

      expect(id).toBe(9);
      expect(mVehicles.create).toHaveBeenCalledWith({ nickname: 'New', type: 'scooter', current_odometer: 0 });
      expect(result.current.vehicles.map((v) => v.id)).toEqual([9]);
    });

    it('returns null, sets the error and does not reload when saving fails', async () => {
      mVehicles.create.mockResolvedValue({ data: null, error: 'Could not save vehicle. Please try again.' });
      const { result } = renderHook(() => useVehicles());
      await waitFor(() => expect(result.current.loading).toBe(false));
      mVehicles.getAll.mockClear();

      let id: number | null = 1;
      await act(async () => {
        id = await result.current.addVehicle({ nickname: 'New', type: 'scooter', current_odometer: 0 });
      });

      expect(id).toBeNull();
      expect(result.current.error).toBe('Could not save vehicle. Please try again.');
      expect(mVehicles.getAll).not.toHaveBeenCalled();
    });
  });

  describe('deleteVehicle', () => {
    it('deletes and reloads', async () => {
      mVehicles.delete.mockResolvedValue({ data: undefined, error: null });
      const { result } = renderHook(() => useVehicles());
      await waitFor(() => expect(result.current.loading).toBe(false));
      mVehicles.getAll.mockResolvedValue({ data: [vehicle(2)], error: null });

      await act(async () => {
        await result.current.deleteVehicle(1);
      });

      expect(mVehicles.delete).toHaveBeenCalledWith(1);
      expect(result.current.vehicles.map((v) => v.id)).toEqual([2]);
    });

    it('sets the error and keeps the list when deleting fails', async () => {
      mVehicles.delete.mockResolvedValue({ data: null, error: 'Could not delete vehicle.' });
      const { result } = renderHook(() => useVehicles());
      await waitFor(() => expect(result.current.loading).toBe(false));
      mVehicles.getAll.mockClear();

      await act(async () => {
        await result.current.deleteVehicle(1);
      });

      expect(result.current.error).toBe('Could not delete vehicle.');
      expect(mVehicles.getAll).not.toHaveBeenCalled();
      expect(result.current.vehicles).toHaveLength(2);
    });
  });

  describe('updateOdometer', () => {
    it('saves and reloads', async () => {
      mVehicles.updateOdometer.mockResolvedValue({ data: undefined, error: null });
      const { result } = renderHook(() => useVehicles());
      await waitFor(() => expect(result.current.loading).toBe(false));
      mVehicles.getAll.mockClear();

      await act(async () => {
        await result.current.updateOdometer(1, 1500);
      });

      expect(mVehicles.updateOdometer).toHaveBeenCalledWith(1, 1500);
      expect(mVehicles.getAll).toHaveBeenCalledTimes(1);
    });

    it('sets the error when saving fails', async () => {
      mVehicles.updateOdometer.mockResolvedValue({ data: null, error: 'Could not update odometer.' });
      const { result } = renderHook(() => useVehicles());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateOdometer(1, 1500);
      });

      expect(result.current.error).toBe('Could not update odometer.');
    });
  });
});

// ─── useFuelLogs ──────────────────────────────────────────────────────────────

describe('useFuelLogs', () => {
  const stats = { total_litres: 12, total_cost: 30, avg_consumption: 4.5 };
  beforeEach(() => {
    mFuel.getByVehicle.mockResolvedValue({ data: [fuelLog(2), fuelLog(1)], error: null });
    mFuel.getMonthlyStats.mockResolvedValue({ data: stats, error: null });
  });

  it('loads the logs and this month\'s stats for the vehicle', async () => {
    const { result } = renderHook(() => useFuelLogs(7));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mFuel.getByVehicle).toHaveBeenCalledWith(7);
    expect(mFuel.getMonthlyStats).toHaveBeenCalledWith(7);
    expect(result.current.logs.map((l) => l.id)).toEqual([2, 1]);
    expect(result.current.monthStats).toEqual(stats);
  });

  it('starts with zeroed stats', async () => {
    mFuel.getMonthlyStats.mockResolvedValue({ data: null, error: 'Could not load stats.' });
    const { result } = renderHook(() => useFuelLogs(7));
    expect(result.current.monthStats).toEqual({ total_litres: 0, total_cost: 0, avg_consumption: 0 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.monthStats).toEqual({ total_litres: 0, total_cost: 0, avg_consumption: 0 }); // failed stats leave the zeros
  });

  it('does nothing without a vehicle (id 0 / not chosen yet)', async () => {
    renderHook(() => useFuelLogs(0));
    await act(async () => {});
    expect(mFuel.getByVehicle).not.toHaveBeenCalled();
  });

  it('reloads when the vehicle changes', async () => {
    const { result, rerender } = renderHook(({ id }: { id: number }) => useFuelLogs(id), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ id: 2 });

    await waitFor(() => expect(mFuel.getByVehicle).toHaveBeenCalledWith(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('exposes the error when the logs cannot be loaded, and keeps the stats it did get', async () => {
    mFuel.getByVehicle.mockResolvedValue({ data: null, error: 'Could not load fuel logs.' });
    const { result } = renderHook(() => useFuelLogs(7));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Could not load fuel logs.');
    expect(result.current.logs).toEqual([]);
    expect(result.current.monthStats).toEqual(stats);
  });

  describe('addLog', () => {
    const input = { vehicle_id: 7, date: '2026-11-01', odometer: 1000, litres: 5, is_full_tank: true };

    it('saves, reloads and returns true', async () => {
      mFuel.add.mockResolvedValue({ data: 3, error: null });
      const { result } = renderHook(() => useFuelLogs(7));
      await waitFor(() => expect(result.current.loading).toBe(false));
      mFuel.getByVehicle.mockClear();

      let ok = false;
      await act(async () => {
        ok = await result.current.addLog(input);
      });

      expect(ok).toBe(true);
      expect(mFuel.add).toHaveBeenCalledWith(input);
      expect(mFuel.getByVehicle).toHaveBeenCalledTimes(1);
    });

    it('returns false and sets the error when saving fails', async () => {
      mFuel.add.mockResolvedValue({ data: null, error: 'Could not save fuel log. Please try again.' });
      const { result } = renderHook(() => useFuelLogs(7));
      await waitFor(() => expect(result.current.loading).toBe(false));
      mFuel.getByVehicle.mockClear();

      let ok = true;
      await act(async () => {
        ok = await result.current.addLog(input);
      });

      expect(ok).toBe(false);
      expect(result.current.error).toBe('Could not save fuel log. Please try again.');
      expect(mFuel.getByVehicle).not.toHaveBeenCalled();
    });
  });

  describe('deleteLog', () => {
    it('deletes and reloads', async () => {
      mFuel.delete.mockResolvedValue({ data: undefined, error: null });
      const { result } = renderHook(() => useFuelLogs(7));
      await waitFor(() => expect(result.current.loading).toBe(false));
      mFuel.getByVehicle.mockClear();

      await act(async () => {
        await result.current.deleteLog(2);
      });

      expect(mFuel.delete).toHaveBeenCalledWith(2);
      expect(mFuel.getByVehicle).toHaveBeenCalledTimes(1);
    });

    it('sets the error and does not reload when deleting fails', async () => {
      mFuel.delete.mockResolvedValue({ data: null, error: 'Could not delete fuel log.' });
      const { result } = renderHook(() => useFuelLogs(7));
      await waitFor(() => expect(result.current.loading).toBe(false));
      mFuel.getByVehicle.mockClear();

      await act(async () => {
        await result.current.deleteLog(2);
      });

      expect(result.current.error).toBe('Could not delete fuel log.');
      expect(mFuel.getByVehicle).not.toHaveBeenCalled();
    });
  });
});

// ─── useMaintenance ───────────────────────────────────────────────────────────

describe('useMaintenance', () => {
  const items = [item(1, 'overdue'), item(2, 'due'), item(3, 'urgent'), item(4, 'ok'), item(5, 'overdue')];
  beforeEach(() => {
    mMaint.getByVehicle.mockResolvedValue({ data: items, error: null });
  });

  it('loads the items for the vehicle at its current odometer', async () => {
    const { result } = renderHook(() => useMaintenance(7, 5000));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mMaint.getByVehicle).toHaveBeenCalledWith(7, 5000);
    expect(result.current.items).toHaveLength(5);
  });

  it('counts overdue items, and due + urgent items together', async () => {
    const { result } = renderHook(() => useMaintenance(7, 5000));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.overdueCount).toBe(2);
    expect(result.current.dueCount).toBe(2); // one due + one urgent
  });

  it('filters by status, or returns everything for "all"', async () => {
    const { result } = renderHook(() => useMaintenance(7, 5000));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.filterByStatus('all')).toHaveLength(5);
    expect(result.current.filterByStatus('overdue').map((i) => i.id)).toEqual([1, 5]);
    expect(result.current.filterByStatus('urgent').map((i) => i.id)).toEqual([3]);
    expect(result.current.filterByStatus('ok').map((i) => i.id)).toEqual([4]);
  });

  it('does nothing without a vehicle', async () => {
    renderHook(() => useMaintenance(0, 0));
    await act(async () => {});
    expect(mMaint.getByVehicle).not.toHaveBeenCalled();
  });

  it('reloads when the odometer changes (statuses depend on it)', async () => {
    const { result, rerender } = renderHook(({ odo }: { odo: number }) => useMaintenance(7, odo), { initialProps: { odo: 5000 } });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ odo: 5600 });

    await waitFor(() => expect(mMaint.getByVehicle).toHaveBeenCalledWith(7, 5600));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('exposes the error and keeps no items when loading fails', async () => {
    mMaint.getByVehicle.mockResolvedValue({ data: null, error: 'Could not load maintenance items.' });
    const { result } = renderHook(() => useMaintenance(7, 5000));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Could not load maintenance items.');
    expect(result.current.items).toEqual([]);
    expect(result.current.overdueCount).toBe(0);
  });

  describe('logService', () => {
    const input = { item_id: 1, vehicle_id: 7, date: '2026-11-17', odometer: 5000 };

    it('saves, reloads and returns true', async () => {
      mMaint.logService.mockResolvedValue({ data: undefined, error: null });
      const { result } = renderHook(() => useMaintenance(7, 5000));
      await waitFor(() => expect(result.current.loading).toBe(false));
      mMaint.getByVehicle.mockClear();

      let ok = false;
      await act(async () => {
        ok = await result.current.logService(input);
      });

      expect(ok).toBe(true);
      expect(mMaint.logService).toHaveBeenCalledWith(input);
      expect(mMaint.getByVehicle).toHaveBeenCalledTimes(1);
    });

    it('returns false and sets the error when saving fails', async () => {
      mMaint.logService.mockResolvedValue({ data: null, error: 'Could not save service log. Please try again.' });
      const { result } = renderHook(() => useMaintenance(7, 5000));
      await waitFor(() => expect(result.current.loading).toBe(false));
      mMaint.getByVehicle.mockClear();

      let ok = true;
      await act(async () => {
        ok = await result.current.logService(input);
      });

      expect(ok).toBe(false);
      expect(result.current.error).toBe('Could not save service log. Please try again.');
      expect(mMaint.getByVehicle).not.toHaveBeenCalled();
    });
  });
});
