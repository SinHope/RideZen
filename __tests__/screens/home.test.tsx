/**
 * Home ("My Garage") screen — vehicle cards, search, overdue strip, monthly stats, ride sessions,
 * the first-run onboarding / maintenance prompts and the auto-track revocation banner.
 * Hooks and repositories are faked; the cards, modals and banner are the real components.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, AppState, Linking, RefreshControl } from 'react-native';

// Native animation libs can't run in Node — use their official Jest mocks.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => require('../helpers/routerMock').expoRouterMock());

const mockReload = jest.fn();
const mockVehiclesState: { vehicles: any[]; loading: boolean } = { vehicles: [], loading: false };
jest.mock('@/hooks/useVehicles', () => ({
  useVehicles: () => ({ vehicles: mockVehiclesState.vehicles, loading: mockVehiclesState.loading, reload: mockReload }),
}));

const mockCounts: Record<number, { overdueCount: number; dueCount: number }> = {};
jest.mock('@/hooks/useMaintenance', () => ({
  useMaintenance: (vehicleId: number) => mockCounts[vehicleId] ?? { overdueCount: 0, dueCount: 0 },
}));

jest.mock('@/repositories/fuelRepo', () => ({
  fuelRepo: { getLastRefuel: jest.fn(), getMonthlyStats: jest.fn(), getMonthlyGlobalStats: jest.fn() },
}));
jest.mock('@/repositories/maintenanceRepo', () => ({
  maintenanceRepo: { getOverdueSummary: jest.fn() },
}));

const mockRide = { isTracking: false, activeVehicleId: null as number | null, distanceKm: 0, startRide: jest.fn(), endRide: jest.fn() };
jest.mock('@/contexts/RideSessionContext', () => ({ useRideSession: () => mockRide }));

const mockRecheck = jest.fn();
const mockSwitchToAuto = jest.fn();
jest.mock('@/hooks/useTrackingMode', () => ({
  useTrackingMode: () => ({ recheckOnLaunch: mockRecheck, switchToAuto: mockSwitchToAuto }),
}));

const mockMode = { value: 'manual' as 'manual' | 'auto' };
jest.mock('@/services/trackingPreferences', () => ({
  getTrackingMode: () => mockMode.value,
  setOnboardingShown: jest.fn(),
}));
jest.mock('@/services/currencyService', () => ({ getHomeCurrency: () => 'SGD' }));
jest.mock('@/notifications/scheduler', () => ({ requestNotificationPermissions: jest.fn() }));

import { fuelRepo } from '@/repositories/fuelRepo';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { requestNotificationPermissions } from '@/notifications/scheduler';
import { consumeMaintenancePromptPending, consumeTrackingOnboardingPending, setMaintenancePromptPending, setTrackingOnboardingPending } from '@/utils/flags';
import HomeScreen from '../../app/(tabs)/index';
import { routerMocks, resetRouterMocks } from '../helpers/routerMock';

const mFuel = fuelRepo as jest.Mocked<typeof fuelRepo>;
const mMaint = maintenanceRepo as jest.Mocked<typeof maintenanceRepo>;
const mAsk = requestNotificationPermissions as jest.Mock;

const vehicle = (id: number, nickname: string, over: object = {}) => ({
  id,
  nickname,
  type: 'scooter',
  current_odometer: 1000 * id,
  created_at: '',
  updated_at: '',
  ...over,
});

let appStateHandler: ((state: string) => void) | null = null;

async function renderHome() {
  render(<HomeScreen />);
  await act(async () => {}); // let the async stats / overdue lookups settle
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRouterMocks();
  mockVehiclesState.vehicles = [];
  mockVehiclesState.loading = false;
  Object.keys(mockCounts).forEach((k) => delete mockCounts[Number(k)]);
  Object.assign(mockRide, { isTracking: false, activeVehicleId: null, distanceKm: 0 });
  mockRide.startRide.mockResolvedValue(true);
  mockRide.endRide.mockResolvedValue(undefined);
  mockMode.value = 'manual';
  mockRecheck.mockResolvedValue({ changed: false });
  mockSwitchToAuto.mockResolvedValue('granted');
  mAsk.mockResolvedValue(true);
  mFuel.getLastRefuel.mockResolvedValue({ data: null, error: null });
  mFuel.getMonthlyStats.mockResolvedValue({ data: { total_litres: 0, total_cost: 0, avg_consumption: 0 }, error: null });
  mFuel.getMonthlyGlobalStats.mockResolvedValue({ totalCost: 0, avgConsumption: null, avgVehicleName: null });
  mMaint.getOverdueSummary.mockResolvedValue({ total: 0, message: null });
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: any) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  }) as any);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.useFakeTimers({ now: new Date(2026, 10, 17, 9) });
});
afterEach(() => {
  // flags are module state — never leak one into the next test
  consumeMaintenancePromptPending();
  consumeTrackingOnboardingPending();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ─── header ───────────────────────────────────────────────────────────────────

describe('header', () => {
  it('shows the title', async () => {
    await renderHome();
    expect(screen.getByText('My Garage')).toBeTruthy();
  });

  it.each([
    [0, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [16, 'Good afternoon'],
    [17, 'Good evening'],
    [23, 'Good evening'],
  ])('at %i:00 it says "%s"', async (hour, greeting) => {
    jest.setSystemTime(new Date(2026, 10, 17, hour));
    await renderHome();
    expect(screen.getByText(new RegExp(`^${greeting},`))).toBeTruthy();
  });
});

// ─── vehicle list ─────────────────────────────────────────────────────────────

describe('vehicles', () => {
  it('while loading shows placeholders, not the empty message', async () => {
    mockVehiclesState.loading = true;
    await renderHome();
    expect(screen.queryByText('Add your first vehicle to get started')).toBeNull();
    expect(screen.queryByLabelText('Add another vehicle')).toBeNull();
  });

  describe('with none yet', () => {
    it('invites the rider to add one, and opens the add screen', async () => {
      await renderHome();
      expect(screen.getByText('Add your first vehicle to get started')).toBeTruthy();
      fireEvent.press(screen.getByLabelText('Add vehicle'));
      expect(routerMocks.push).toHaveBeenCalledWith('/vehicle/add');
    });

    it('hides the monthly stats and the add-another button', async () => {
      await renderHome();
      expect(screen.queryByText('This month')).toBeNull();
      expect(screen.queryByLabelText('Add another vehicle')).toBeNull();
    });

    it('does not look up overdue items or fuel stats', async () => {
      await renderHome();
      expect(mMaint.getOverdueSummary).not.toHaveBeenCalled();
      expect(mFuel.getMonthlyGlobalStats).not.toHaveBeenCalled();
    });
  });

  describe('with vehicles', () => {
    beforeEach(() => {
      mockVehiclesState.vehicles = [vehicle(1, 'Aerox'), vehicle(2, 'Civic', { type: 'car' })];
    });

    it('shows a card for each', async () => {
      await renderHome();
      expect(screen.getByLabelText('Aerox vehicle card')).toBeTruthy();
      expect(screen.getByLabelText('Civic vehicle card')).toBeTruthy();
    });

    it('opens a vehicle when its card is tapped', async () => {
      await renderHome();
      fireEvent.press(screen.getByLabelText('Civic vehicle card'));
      expect(routerMocks.push).toHaveBeenCalledWith('/vehicle/2');
    });

    it('offers to add another vehicle', async () => {
      await renderHome();
      fireEvent.press(screen.getByLabelText('Add another vehicle'));
      expect(routerMocks.push).toHaveBeenCalledWith('/vehicle/add');
    });

    it("shows each card's overdue / due counts", async () => {
      mockCounts[1] = { overdueCount: 2, dueCount: 0 };
      mockCounts[2] = { overdueCount: 0, dueCount: 3 };
      await renderHome();
      expect(screen.getByText('2 Overdue')).toBeTruthy();
      expect(screen.getByText('3 Due soon')).toBeTruthy();
    });

    it("shows each card's last refuel and average consumption", async () => {
      mFuel.getLastRefuel.mockResolvedValue({ data: { id: 1, vehicle_id: 1, date: '2026-11-14' } as any, error: null });
      mFuel.getMonthlyStats.mockResolvedValue({ data: { total_litres: 5, total_cost: 10, avg_consumption: 4.56 }, error: null });
      await renderHome();
      expect(screen.getAllByText('3 days ago').length).toBeGreaterThan(0);
      expect(screen.getAllByText('4.6 L').length).toBeGreaterThan(0);
    });
  });
});

// ─── search ───────────────────────────────────────────────────────────────────

describe('search', () => {
  beforeEach(() => {
    mockVehiclesState.vehicles = [vehicle(1, 'Aerox'), vehicle(2, 'Civic'), vehicle(3, 'Beat')];
  });

  it('is hidden until the search button is tapped', async () => {
    await renderHome();
    expect(screen.queryByPlaceholderText('Search vehicles...')).toBeNull();
    fireEvent.press(screen.getByLabelText('Search'));
    expect(screen.getByPlaceholderText('Search vehicles...')).toBeTruthy();
  });

  it('filters by name, ignoring case', async () => {
    await renderHome();
    fireEvent.press(screen.getByLabelText('Search'));
    fireEvent.changeText(screen.getByPlaceholderText('Search vehicles...'), 'CIV');
    expect(screen.getByLabelText('Civic vehicle card')).toBeTruthy();
    expect(screen.queryByLabelText('Aerox vehicle card')).toBeNull();
    expect(screen.queryByLabelText('Beat vehicle card')).toBeNull();
  });

  it('says so when nothing matches', async () => {
    await renderHome();
    fireEvent.press(screen.getByLabelText('Search'));
    fireEvent.changeText(screen.getByPlaceholderText('Search vehicles...'), 'zzz');
    expect(screen.getByText('No vehicles match your search.')).toBeTruthy();
  });

  it('closing the search shows every vehicle again', async () => {
    await renderHome();
    fireEvent.press(screen.getByLabelText('Search'));
    fireEvent.changeText(screen.getByPlaceholderText('Search vehicles...'), 'civ');
    fireEvent.press(screen.getByLabelText('Search')); // toggle off
    expect(screen.getByLabelText('Aerox vehicle card')).toBeTruthy();
    expect(screen.getByLabelText('Beat vehicle card')).toBeTruthy();
  });

  it('a blank search shows everything', async () => {
    await renderHome();
    fireEvent.press(screen.getByLabelText('Search'));
    fireEvent.changeText(screen.getByPlaceholderText('Search vehicles...'), '   ');
    expect(screen.getByLabelText('Aerox vehicle card')).toBeTruthy();
  });
});

// ─── overdue strip & monthly stats ────────────────────────────────────────────

describe('overdue strip', () => {
  beforeEach(() => {
    mockVehiclesState.vehicles = [vehicle(1, 'Aerox')];
  });

  it('asks about overdue items for the rider\'s vehicles', async () => {
    await renderHome();
    expect(mMaint.getOverdueSummary).toHaveBeenCalledWith(mockVehiclesState.vehicles);
  });

  it('is not shown when nothing is overdue', async () => {
    await renderHome();
    expect(screen.queryByLabelText(/overdue/i)).toBeNull();
  });

  it('shows the message and opens the Service tab when tapped', async () => {
    mMaint.getOverdueSummary.mockResolvedValue({ total: 1, message: '1 item overdue — Engine Oil on Aerox' });
    await renderHome();
    fireEvent.press(screen.getByLabelText('1 item overdue — Engine Oil on Aerox'));
    expect(routerMocks.push).toHaveBeenCalledWith('/(tabs)/maintenance');
  });
});

describe('this month', () => {
  beforeEach(() => {
    mockVehiclesState.vehicles = [vehicle(1, 'Aerox')];
  });

  it('shows dashes and "no data yet" before anything is logged', async () => {
    await renderHome();
    expect(screen.getByText('This month')).toBeTruthy();
    expect(screen.getByText('no data yet')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows fuel spent (whole numbers, home currency) and the most efficient vehicle', async () => {
    mFuel.getMonthlyGlobalStats.mockResolvedValue({ totalCost: 123.6, avgConsumption: 4.56, avgVehicleName: 'Aerox' });
    await renderHome();
    expect(screen.getByText('SGD 124')).toBeTruthy();
    expect(screen.getByText(/^4\.6 L\/100km$/)).toBeTruthy(); // value and unit share one line
    expect(screen.getAllByText('Aerox').length).toBeGreaterThan(0);
  });

  it('asks for every vehicle\'s stats', async () => {
    mockVehiclesState.vehicles = [vehicle(1, 'A'), vehicle(2, 'B')];
    await renderHome();
    expect(mFuel.getMonthlyGlobalStats).toHaveBeenCalledWith([1, 2]);
  });
});

// ─── ride sessions ────────────────────────────────────────────────────────────

describe('ride sessions', () => {
  beforeEach(() => {
    mockVehiclesState.vehicles = [vehicle(1, 'Aerox'), vehicle(2, 'Civic')];
  });

  it('manual mode shows Start Ride on each card', async () => {
    await renderHome();
    expect(screen.getAllByLabelText('Start tracking this ride')).toHaveLength(2);
  });

  it('auto mode has no Start Ride button', async () => {
    mockMode.value = 'auto';
    await renderHome();
    expect(screen.queryByLabelText('Start tracking this ride')).toBeNull();
  });

  it('Start Ride asks for notification permission, starts the ride, then explains how to end it', async () => {
    await renderHome();
    await act(async () => {
      fireEvent.press(screen.getAllByLabelText('Start tracking this ride')[1]);
    });
    expect(mAsk).toHaveBeenCalledTimes(1);
    expect(mockRide.startRide).toHaveBeenCalledWith(2);
    expect(mAsk.mock.invocationCallOrder[0]).toBeLessThan(mockRide.startRide.mock.invocationCallOrder[0]);
    expect(Alert.alert).toHaveBeenCalledWith('', "Tap 'End Ride' when you're done to save your distance.", [{ text: 'Got it' }]);
  });

  it('says nothing more when the ride could not start', async () => {
    mockRide.startRide.mockResolvedValue(false);
    await renderHome();
    await act(async () => {
      fireEvent.press(screen.getAllByLabelText('Start tracking this ride')[0]);
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('still starts the ride when notification permission is refused', async () => {
    mAsk.mockResolvedValue(false);
    await renderHome();
    await act(async () => {
      fireEvent.press(screen.getAllByLabelText('Start tracking this ride')[0]);
    });
    expect(mockRide.startRide).toHaveBeenCalledWith(1);
  });

  it('while a ride is on, only that vehicle shows End Ride (live distance too) and the others cannot start', async () => {
    Object.assign(mockRide, { isTracking: true, activeVehicleId: 2, distanceKm: 3.46 });
    await renderHome();
    expect(screen.getAllByLabelText('End ride and save distance')).toHaveLength(1);
    expect(screen.getByText('+3.5 km')).toBeTruthy();
    const startButtons = screen.getAllByLabelText('Start tracking this ride');
    expect(startButtons).toHaveLength(1);
    fireEvent.press(startButtons[0]);
    expect(mockRide.startRide).not.toHaveBeenCalled();
  });

  it('End Ride saves, confirms, and refreshes the odometer', async () => {
    Object.assign(mockRide, { isTracking: true, activeVehicleId: 1 });
    await renderHome();
    mockReload.mockClear();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('End ride and save distance'));
    });
    expect(mockRide.endRide).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith('Ride saved!', 'Your odometer has been updated.', [{ text: 'OK' }]);
    expect(mockReload).toHaveBeenCalled();
  });
});

// ─── refreshing ───────────────────────────────────────────────────────────────

describe('refreshing', () => {
  it('reloads the vehicles when focused', async () => {
    await renderHome();
    expect(mockReload).toHaveBeenCalled();
  });

  it('pull-to-refresh reloads', async () => {
    mockVehiclesState.vehicles = [vehicle(1, 'Aerox')];
    await renderHome();
    mockReload.mockClear();
    await act(async () => {
      await screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('coming back to the app refreshes the vehicles and the tracking mode (e.g. after "Turn off GPS")', async () => {
    mockVehiclesState.vehicles = [vehicle(1, 'Aerox')];
    await renderHome();
    expect(screen.getAllByLabelText('Start tracking this ride')).toHaveLength(1);
    mockReload.mockClear();

    mockMode.value = 'auto';
    act(() => appStateHandler!('active'));

    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Start tracking this ride')).toBeNull();
  });

  it('going to the background does nothing', async () => {
    await renderHome();
    mockReload.mockClear();
    act(() => appStateHandler!('background'));
    expect(mockReload).not.toHaveBeenCalled();
  });

  it('stops listening when the screen goes away', async () => {
    const remove = jest.fn();
    (AppState.addEventListener as jest.Mock).mockReturnValue({ remove });
    render(<HomeScreen />);
    screen.unmount();
    expect(remove).toHaveBeenCalled();
  });
});

// ─── first-run prompts ────────────────────────────────────────────────────────

describe('after adding a vehicle', () => {
  beforeEach(() => {
    mockVehiclesState.vehicles = [vehicle(1, 'Aerox')];
  });

  it('shows the tracking onboarding when the add-vehicle screen asked for it', async () => {
    setTrackingOnboardingPending();
    await renderHome();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });

  it('offers the maintenance review after a short pause', async () => {
    setMaintenancePromptPending();
    await renderHome();
    expect(screen.queryByText('Set up maintenance?')).toBeNull();
    act(() => {
      jest.advanceTimersByTime(1300);
    });
    expect(screen.getByText('Set up maintenance?')).toBeTruthy();
  });

  const openMaintenancePrompt = async () => {
    setMaintenancePromptPending();
    await renderHome();
    act(() => {
      jest.advanceTimersByTime(1300);
    });
  };

  it("'Let's go' opens the Service tab", async () => {
    await openMaintenancePrompt();
    fireEvent.press(screen.getByText("Let's go"));
    expect(routerMocks.push).toHaveBeenCalledWith('/(tabs)/maintenance');
  });

  it('Cancel just closes the prompt', async () => {
    await openMaintenancePrompt();
    fireEvent.press(screen.getByText('Cancel'));
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it('with neither prompt pending, shows neither', async () => {
    await renderHome();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Set up maintenance?')).toBeNull();
    expect(screen.queryByText('Step 1 of 2')).toBeNull();
  });

  it('when both are pending: onboarding first, then — after it finishes — the maintenance prompt', async () => {
    setTrackingOnboardingPending();
    setMaintenancePromptPending();
    await renderHome();

    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.queryByText('Set up maintenance?')).toBeNull();

    fireEvent.press(screen.getByLabelText('Continue to explanation'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Confirm and close onboarding'));
    });

    expect(Alert.alert).toHaveBeenCalledWith('', 'You can change your tracking mode anytime in Settings.', [{ text: 'Got it' }]);
    expect(screen.queryByText('Set up maintenance?')).toBeNull(); // not yet…
    act(() => {
      jest.advanceTimersByTime(700);
    });
    expect(screen.getByText('Set up maintenance?')).toBeTruthy(); // …a moment later
  });
});

// ─── auto-track recheck & banner ──────────────────────────────────────────────

describe('auto-track launch check', () => {
  beforeEach(() => {
    mockVehiclesState.vehicles = [vehicle(1, 'Aerox')];
    mockMode.value = 'auto';
  });

  it('runs once when the screen first opens', async () => {
    await renderHome();
    expect(mockRecheck).toHaveBeenCalledTimes(1);
  });

  it('shows no banner when nothing changed', async () => {
    await renderHome();
    expect(screen.queryByLabelText('Dismiss banner')).toBeNull();
  });

  it('survives a failing check', async () => {
    mockRecheck.mockRejectedValue(new Error('boom'));
    await expect(renderHome()).resolves.toBeUndefined();
  });

  describe('when background location was revoked', () => {
    beforeEach(() => {
      mockRecheck.mockResolvedValue({ changed: true, reason: 'permission_revoked' });
    });

    it('explains it and switches the screen back to manual', async () => {
      await renderHome();
      expect(screen.getByText('Background location was turned off. Switched to Manual Ride Session.')).toBeTruthy();
      expect(screen.getAllByLabelText('Start tracking this ride')).toHaveLength(1);
    });

    it('the banner can be dismissed', async () => {
      await renderHome();
      fireEvent.press(screen.getByLabelText('Dismiss banner'));
      expect(screen.queryByLabelText('Dismiss banner')).toBeNull();
    });

    it('Re-enable switches the first vehicle back to auto and clears the banner', async () => {
      await renderHome();
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Re-enable auto-track'));
      });
      expect(mockSwitchToAuto).toHaveBeenCalledWith(1);
      expect(screen.queryByLabelText('Dismiss banner')).toBeNull();
      expect(screen.queryByLabelText('Start tracking this ride')).toBeNull(); // auto mode again
    });

    it.each(['foreground_never_ask', 'background_never_ask'])('Re-enable with permission blocked (%s) points to the phone settings', async (outcome) => {
      mockSwitchToAuto.mockResolvedValue(outcome);
      const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
      await renderHome();
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Re-enable auto-track'));
      });
      expect(screen.getByText('Please enable "Always Allow" location in Settings.')).toBeTruthy();
      fireEvent.press(screen.getByLabelText('Open phone settings'));
      expect(openSettings).toHaveBeenCalledTimes(1);
    });

    it('Re-enable that is merely declined leaves the banner as it was', async () => {
      mockSwitchToAuto.mockResolvedValue('foreground_denied');
      await renderHome();
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Re-enable auto-track'));
      });
      expect(screen.getByText('Background location was turned off. Switched to Manual Ride Session.')).toBeTruthy();
    });
  });

  it('Re-enable does nothing without a vehicle', async () => {
    mockVehiclesState.vehicles = [];
    mockRecheck.mockResolvedValue({ changed: true, reason: 'permission_revoked' });
    await renderHome();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Re-enable auto-track'));
    });
    expect(mockSwitchToAuto).not.toHaveBeenCalled();
  });
});
