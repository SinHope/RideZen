/**
 * useTrackingMode — the permission flow for switching to auto-track, and the launch-time recheck.
 * (switchToManual and the foreground refresh are in gpsIdle/useTrackingMode.test.tsx.)
 */
import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';

const mockLocation = {
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
};
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...a: any[]) => mockLocation.requestForegroundPermissionsAsync(...a),
  requestBackgroundPermissionsAsync: (...a: any[]) => mockLocation.requestBackgroundPermissionsAsync(...a),
  getBackgroundPermissionsAsync: (...a: any[]) => mockLocation.getBackgroundPermissionsAsync(...a),
  startLocationUpdatesAsync: (...a: any[]) => mockLocation.startLocationUpdatesAsync(...a),
  Accuracy: { Balanced: 3 },
}));

const mockIsRegistered = jest.fn();
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: (...a: any[]) => mockIsRegistered(...a),
}));

const mockPrefs = { mode: 'manual', vehicleId: 1 as number | null };
jest.mock('@/services/trackingPreferences', () => ({
  getTrackingMode: jest.fn(() => mockPrefs.mode),
  setTrackingMode: jest.fn((m: string) => {
    mockPrefs.mode = m;
  }),
  getAutoTrackVehicleId: jest.fn(() => mockPrefs.vehicleId),
  setAutoTrackVehicleId: jest.fn(),
  clearBgLastCoords: jest.fn(),
  getBgLastCoords: jest.fn(),
  setBgLastCoords: jest.fn(),
}));
jest.mock('@/notifications/idleReminder', () => ({
  armIdleReminder: jest.fn().mockResolvedValue(undefined),
  cancelIdleReminder: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/notifications/scheduler', () => ({ requestNotificationPermissions: jest.fn().mockResolvedValue(true) }));
jest.mock('@/notifications/maintenanceNotifications', () => ({ syncIfStale: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/db/client', () => ({ getDb: jest.fn() }));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import { useTrackingMode } from '@/hooks/useTrackingMode';
import { requestNotificationPermissions } from '@/notifications/scheduler';
import { setAutoTrackVehicleId, setTrackingMode } from '@/services/trackingPreferences';
import { logToFile } from '@/utils/logger';

const granted = { status: 'granted', canAskAgain: true };
const denied = (canAskAgain: boolean) => ({ status: 'denied', canAskAgain });

async function switchToAuto(vehicleId = 7) {
  const { result } = renderHook(() => useTrackingMode());
  let outcome: string = '';
  await act(async () => {
    outcome = await result.current.switchToAuto(vehicleId);
  });
  return { result, outcome };
}

async function recheck() {
  const { result } = renderHook(() => useTrackingMode());
  let outcome: any;
  await act(async () => {
    outcome = await result.current.recheckOnLaunch();
  });
  return { result, outcome };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrefs.mode = 'manual';
  mockPrefs.vehicleId = 1;
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue(granted);
  mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue(granted);
  mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockLocation.startLocationUpdatesAsync.mockResolvedValue(undefined);
  mockIsRegistered.mockResolvedValue(false);
  (requestNotificationPermissions as jest.Mock).mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

// ─── initial state ────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('reads the saved mode', () => {
    mockPrefs.mode = 'auto';
    const { result } = renderHook(() => useTrackingMode());
    expect(result.current.mode).toBe('auto');
    expect(result.current.loading).toBe(false);
  });

  it('defaults to manual', () => {
    const { result } = renderHook(() => useTrackingMode());
    expect(result.current.mode).toBe('manual');
  });
});

// ─── switchToAuto ─────────────────────────────────────────────────────────────

describe('switchToAuto', () => {
  it('asks for location, then background location, then notifications — in that order — and starts tracking', async () => {
    const { result, outcome } = await switchToAuto(7);

    expect(outcome).toBe('granted');
    const order = [
      mockLocation.requestForegroundPermissionsAsync,
      mockLocation.requestBackgroundPermissionsAsync,
      requestNotificationPermissions as jest.Mock,
      mockLocation.startLocationUpdatesAsync,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((n) => typeof n === 'number')).toBe(true);

    expect(setAutoTrackVehicleId).toHaveBeenCalledWith(7);
    expect(setTrackingMode).toHaveBeenCalledWith('auto');
    expect(result.current.mode).toBe('auto');
  });

  it('starts the background task with the ride-tracking notification', async () => {
    await switchToAuto();
    const [task, options] = mockLocation.startLocationUpdatesAsync.mock.calls[0];
    expect(task).toEqual(expect.any(String));
    expect(options.foregroundService.notificationTitle).toBe('RideZen is tracking your ride');
    expect(options.distanceInterval).toBe(10);
  });

  it('does not start a second task when one is already running', async () => {
    mockIsRegistered.mockResolvedValue(true);
    const { outcome } = await switchToAuto();
    expect(outcome).toBe('granted');
    expect(mockLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('still succeeds when notifications are refused (only the idle reminder is lost)', async () => {
    (requestNotificationPermissions as jest.Mock).mockResolvedValue(false);
    const { outcome } = await switchToAuto();
    expect(outcome).toBe('granted');
  });

  describe('when permission is refused', () => {
    const stays = (result: any) => {
      expect(result.current.mode).toBe('manual');
      expect(setTrackingMode).not.toHaveBeenCalled();
      expect(setAutoTrackVehicleId).not.toHaveBeenCalled();
      expect(mockLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
    };

    it('location denied (can ask again)', async () => {
      mockLocation.requestForegroundPermissionsAsync.mockResolvedValue(denied(true));
      const { result, outcome } = await switchToAuto();
      expect(outcome).toBe('foreground_denied');
      expect(mockLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
      stays(result);
    });

    it('location denied for good', async () => {
      mockLocation.requestForegroundPermissionsAsync.mockResolvedValue(denied(false));
      const { result, outcome } = await switchToAuto();
      expect(outcome).toBe('foreground_never_ask');
      stays(result);
    });

    it('only "while using the app" (can ask again)', async () => {
      mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue(denied(true));
      const { result, outcome } = await switchToAuto();
      expect(outcome).toBe('background_only_while_using');
      expect(requestNotificationPermissions).not.toHaveBeenCalled();
      stays(result);
    });

    it('background location denied for good', async () => {
      mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue(denied(false));
      const { result, outcome } = await switchToAuto();
      expect(outcome).toBe('background_never_ask');
      stays(result);
    });
  });

  it('if the tracking task cannot start, reports it and stays on manual', async () => {
    mockLocation.startLocationUpdatesAsync.mockRejectedValue(new Error('service unavailable'));
    const { result, outcome } = await switchToAuto();
    expect(outcome).toBe('background_denied');
    expect(setTrackingMode).not.toHaveBeenCalled();
    expect(result.current.mode).toBe('manual');
    expect(logToFile).toHaveBeenCalledWith('TRACKING_MODE', 'startBgTask', expect.stringContaining('service unavailable'));
  });
});

// ─── recheckOnLaunch ──────────────────────────────────────────────────────────

describe('recheckOnLaunch', () => {
  describe('in manual mode', () => {
    it('does nothing at all', async () => {
      const { outcome } = await recheck();
      expect(outcome).toEqual({ changed: false });
      expect(mockLocation.getBackgroundPermissionsAsync).not.toHaveBeenCalled();
    });
  });

  describe('in auto mode', () => {
    beforeEach(() => {
      mockPrefs.mode = 'auto';
    });

    it('all well (permission granted, task running): nothing changes', async () => {
      mockIsRegistered.mockResolvedValue(true);
      const { result, outcome } = await recheck();
      expect(outcome).toEqual({ changed: false });
      expect(result.current.mode).toBe('auto');
    });

    it('permission was revoked: falls back to manual and says why', async () => {
      mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
      const { result, outcome } = await recheck();
      expect(outcome).toEqual({ changed: true, reason: 'permission_revoked' });
      expect(setTrackingMode).toHaveBeenCalledWith('manual');
      expect(result.current.mode).toBe('manual');
    });

    it('the phone killed the task: quietly restarts it', async () => {
      mockIsRegistered.mockResolvedValue(false);
      const { result, outcome } = await recheck();
      expect(outcome).toEqual({ changed: false, reason: 'task_restarted' });
      expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
      expect(result.current.mode).toBe('auto');
    });

    it('the task cannot be restarted: falls back to manual and says why', async () => {
      mockIsRegistered.mockResolvedValue(false);
      mockLocation.startLocationUpdatesAsync.mockRejectedValue(new Error('nope'));
      const { result, outcome } = await recheck();
      expect(outcome).toEqual({ changed: true, reason: 'permission_revoked' });
      expect(result.current.mode).toBe('manual');
    });

    it('the task is gone and no vehicle is remembered: falls back to manual', async () => {
      mockIsRegistered.mockResolvedValue(false);
      mockPrefs.vehicleId = null;
      const { result, outcome } = await recheck();
      expect(outcome).toEqual({ changed: true, reason: 'permission_revoked' });
      expect(mockLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
      expect(result.current.mode).toBe('manual');
    });

    describe('on iOS', () => {
      beforeEach(() => {
        jest.replaceProperty(Platform, 'OS', 'ios');
        mockIsRegistered.mockResolvedValue(true);
      });

      it('double-checks the precise authorisation, and is happy when it still says granted', async () => {
        const { outcome } = await recheck();
        expect(outcome).toEqual({ changed: false });
        expect(mockLocation.getBackgroundPermissionsAsync).toHaveBeenCalledTimes(2);
      });

      it('falls back to manual when the second look shows it is no longer "Always"', async () => {
        mockLocation.getBackgroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' }).mockResolvedValueOnce({ status: 'denied' });
        const { result, outcome } = await recheck();
        expect(outcome).toEqual({ changed: true, reason: 'permission_revoked' });
        expect(result.current.mode).toBe('manual');
      });
    });

    it('on Android it does not look twice', async () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      mockIsRegistered.mockResolvedValue(true);
      await recheck();
      expect(mockLocation.getBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
    });
  });
});
