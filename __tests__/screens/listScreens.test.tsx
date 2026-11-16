/**
 * The Fuel tab, the Service (maintenance) tab and the bottom tab bar.
 * Hooks are faked; FlashList is replaced by a plain list; cards and rows are the real components.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, RefreshControl } from 'react-native';

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => require('../helpers/routerMock').expoRouterMock());
jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  return {
    FlashList: ({ data, renderItem, keyExtractor, refreshControl }: any) => (
      <View>
        {refreshControl}
        {data.map((item: any, index: number) => (
          <View key={keyExtractor(item, index)}>{renderItem({ item, index })}</View>
        ))}
      </View>
    ),
  };
});
jest.mock('@/services/currencyService', () => ({ getHomeCurrency: () => 'SGD' }));

const mockVehicles: { vehicles: any[] } = { vehicles: [] };
jest.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ vehicles: mockVehicles.vehicles }) }));

const mockFuelReload = jest.fn();
const mockDeleteLog = jest.fn();
const mockFuelIds: number[] = [];
const mockFuel = {
  logs: [] as any[],
  loading: false,
  monthStats: { total_litres: 0, total_cost: 0, avg_consumption: 0 },
};
jest.mock('@/hooks/useFuelLogs', () => ({
  useFuelLogs: (vehicleId: number) => {
    mockFuelIds.push(vehicleId);
    return { ...mockFuel, reload: mockFuelReload, deleteLog: mockDeleteLog };
  },
}));

const mockMaintReload = jest.fn();
const mockMaintArgs: [number, number][] = [];
const mockMaint = { items: [] as any[], loading: false, overdueCount: 0, dueCount: 0 };
jest.mock('@/hooks/useMaintenance', () => ({
  useMaintenance: (vehicleId: number, odometer: number) => {
    mockMaintArgs.push([vehicleId, odometer]);
    return { ...mockMaint, reload: mockMaintReload };
  },
}));

import FuelScreen from '../../app/(tabs)/fuel';
import MaintenanceScreen from '../../app/(tabs)/maintenance';
import { routerMocks, resetRouterMocks } from '../helpers/routerMock';

const vehicle = (id: number, nickname: string, odometer = 1000) => ({ id, nickname, type: 'scooter', current_odometer: odometer });
const log = (id: number, over: object = {}) => ({
  id,
  vehicle_id: 1,
  date: '2026-11-05',
  odometer: 1000 + id,
  litres: 5,
  is_full_tank: 1,
  created_at: '',
  ...over,
});
const item = (id: number, category: string, status: string, over: object = {}) => ({
  id,
  vehicle_id: 1,
  category,
  vehicle_type_scope: 'universal',
  updated_at: '',
  status,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetRouterMocks();
  mockVehicles.vehicles = [];
  mockFuelIds.length = 0;
  Object.assign(mockFuel, { logs: [], loading: false, monthStats: { total_litres: 0, total_cost: 0, avg_consumption: 0 } });
  mockMaintArgs.length = 0;
  Object.assign(mockMaint, { items: [], loading: false, overdueCount: 0, dueCount: 0 });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ─── Fuel tab ─────────────────────────────────────────────────────────────────

describe('Fuel tab', () => {
  beforeEach(() => {
    mockVehicles.vehicles = [vehicle(1, 'Aerox')];
  });

  it('is titled for the first vehicle', () => {
    render(<FuelScreen />);
    expect(screen.getByText('Fuel Log')).toBeTruthy();
    expect(screen.getByText('Aerox')).toBeTruthy();
  });

  it('shows dashes for the month before anything is logged', () => {
    render(<FuelScreen />);
    expect(screen.getByText('SGD —')).toBeTruthy();
    expect(screen.getByText('— L')).toBeTruthy();
    expect(screen.getByText('L/100km avg')).toBeTruthy();
  });

  it('shows this month\'s average, litres and spend (spend as a whole number)', () => {
    mockFuel.monthStats = { total_litres: 12.46, total_cost: 45.4, avg_consumption: 4.56 };
    render(<FuelScreen />);
    expect(screen.getByText('4.6')).toBeTruthy();
    expect(screen.getByText('12.5 L')).toBeTruthy();
    expect(screen.getByText('SGD 45')).toBeTruthy();
  });

  it('loads logs for the first vehicle and reloads on focus', () => {
    render(<FuelScreen />);
    expect(mockFuelIds[0]).toBe(1);
    expect(mockFuelReload).toHaveBeenCalled();
  });

  describe('with no vehicles', () => {
    beforeEach(() => {
      mockVehicles.vehicles = [];
    });

    it('asks the rider to add one first', () => {
      render(<FuelScreen />);
      expect(screen.getByText('No vehicle')).toBeTruthy();
      expect(screen.getByText('Add a vehicle first to start tracking fuel.')).toBeTruthy();
      fireEvent.press(screen.getByText('Add Vehicle'));
      expect(routerMocks.push).toHaveBeenCalledWith('/vehicle/add');
    });

    it('has no refuel button', () => {
      render(<FuelScreen />);
      expect(screen.queryByLabelText('Log refuel')).toBeNull();
    });
  });

  describe('vehicle picker', () => {
    it('is hidden with one vehicle', () => {
      render(<FuelScreen />);
      expect(screen.getAllByText('Aerox')).toHaveLength(1); // header only, no pill
    });

    it('with several vehicles, switching shows the other one\'s logs and refuel button', () => {
      mockVehicles.vehicles = [vehicle(1, 'Aerox'), vehicle(2, 'Civic')];
      render(<FuelScreen />);
      expect(mockFuelIds[mockFuelIds.length - 1]).toBe(1);

      fireEvent.press(screen.getAllByText('Civic')[0]);

      expect(mockFuelIds[mockFuelIds.length - 1]).toBe(2);
      fireEvent.press(screen.getByLabelText('Log refuel'));
      expect(routerMocks.push).toHaveBeenCalledWith('/fuel/add/2');
    });
  });

  describe('log list', () => {
    it('shows placeholders while loading', () => {
      mockFuel.loading = true;
      render(<FuelScreen />);
      expect(screen.queryByText('Log your first refuel to start tracking consumption')).toBeNull();
    });

    it('invites the first refuel when there are no logs', () => {
      render(<FuelScreen />);
      expect(screen.getByText('Recent refuels')).toBeTruthy();
      expect(screen.getByText('Log your first refuel to start tracking consumption')).toBeTruthy();
    });

    it('lists each log', () => {
      mockFuel.logs = [log(2, { notes: 'second' }), log(1, { notes: 'first' })];
      render(<FuelScreen />);
      expect(screen.getByText(/second/)).toBeTruthy();
      expect(screen.getByText(/first/)).toBeTruthy();
    });

    it('edit opens that log', () => {
      mockFuel.logs = [log(7)];
      render(<FuelScreen />);
      fireEvent.press(screen.getByLabelText('Edit entry'));
      expect(routerMocks.push).toHaveBeenCalledWith('/fuel/edit/7');
    });

    it('delete asks first, then removes that log', () => {
      mockFuel.logs = [log(7)];
      render(<FuelScreen />);
      fireEvent.press(screen.getByLabelText('Delete entry'));
      expect(mockDeleteLog).not.toHaveBeenCalled();
      (Alert.alert as jest.Mock).mock.calls[0][2].find((b: any) => b.text === 'Delete').onPress();
      expect(mockDeleteLog).toHaveBeenCalledWith(7);
    });

    it('pull-to-refresh reloads', async () => {
      mockFuel.logs = [log(1)];
      render(<FuelScreen />);
      mockFuelReload.mockClear();
      await act(async () => {
        await screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
      });
      expect(mockFuelReload).toHaveBeenCalledTimes(1);
    });
  });

  it('the + button opens the refuel form for the vehicle', () => {
    render(<FuelScreen />);
    fireEvent.press(screen.getByLabelText('Log refuel'));
    expect(routerMocks.push).toHaveBeenCalledWith('/fuel/add/1');
  });
});

// ─── Service tab ──────────────────────────────────────────────────────────────

describe('Service tab', () => {
  beforeEach(() => {
    mockVehicles.vehicles = [vehicle(1, 'Aerox', 5000)];
  });

  it('is titled for the first vehicle and loads its items at its odometer', () => {
    render(<MaintenanceScreen />);
    expect(screen.getByText('Maintenance')).toBeTruthy();
    expect(screen.getByText('Aerox')).toBeTruthy();
    expect(mockMaintArgs[0]).toEqual([1, 5000]);
  });

  it('reloads on focus', () => {
    render(<MaintenanceScreen />);
    expect(mockMaintReload).toHaveBeenCalled();
  });

  describe('header badge', () => {
    it('is absent when nothing needs attention', () => {
      render(<MaintenanceScreen />);
      expect(screen.queryByText(/overdue$/)).toBeNull();
      expect(screen.queryByText(/ due$/)).toBeNull();
    });

    it('shows the overdue count first', () => {
      mockMaint.overdueCount = 2;
      mockMaint.dueCount = 4;
      render(<MaintenanceScreen />);
      expect(screen.getByText('2 overdue')).toBeTruthy();
    });

    it('otherwise shows the due count', () => {
      mockMaint.dueCount = 3;
      render(<MaintenanceScreen />);
      expect(screen.getByText('3 due')).toBeTruthy();
    });
  });

  describe('states', () => {
    it('no vehicles', () => {
      mockVehicles.vehicles = [];
      render(<MaintenanceScreen />);
      expect(screen.getByText('No vehicle')).toBeTruthy();
      expect(screen.getByText('Add a vehicle to see maintenance items.')).toBeTruthy();
    });

    it('loading shows placeholders instead of the empty message', () => {
      mockMaint.loading = true;
      render(<MaintenanceScreen />);
      expect(screen.queryByText('No items match this filter.')).toBeNull();
    });

    it('no items', () => {
      render(<MaintenanceScreen />);
      expect(screen.getByText('No items match this filter.')).toBeTruthy();
    });
  });

  describe('sections and filters', () => {
    beforeEach(() => {
      mockMaint.items = [
        item(1, 'Air Filter', 'overdue', { km_remaining: -100 }),
        item(2, 'Brake Pads', 'urgent', { km_remaining: 100 }),
        item(3, 'Chain', 'due', { km_remaining: 800 }),
        item(4, 'Wash', 'ok'),
      ];
    });

    it('"All items" groups them: Needs attention, Due soon (due + urgent), All good', () => {
      render(<MaintenanceScreen />);
      expect(screen.getByText('Needs attention')).toBeTruthy();
      expect(screen.getAllByText('Due soon')).toHaveLength(2); // the filter pill and the section heading
      expect(screen.getByText('All good')).toBeTruthy();
      for (const name of ['Air Filter', 'Brake Pads', 'Chain', 'Wash']) expect(screen.getByText(name)).toBeTruthy();
    });

    it('leaves out a section that has no items', () => {
      mockMaint.items = [item(4, 'Wash', 'ok')];
      render(<MaintenanceScreen />);
      expect(screen.queryByText('Needs attention')).toBeNull();
      expect(screen.getByText('All good')).toBeTruthy();
    });

    it('"Overdue" shows only overdue items, without section headings', () => {
      render(<MaintenanceScreen />);
      fireEvent.press(screen.getAllByText('Overdue')[0]); // the filter pill (the item badge says Overdue too)
      expect(screen.getByText('Air Filter')).toBeTruthy();
      expect(screen.queryByText('Brake Pads')).toBeNull();
      expect(screen.queryByText('Needs attention')).toBeNull();
    });

    it('"Due soon" shows due AND urgent items', () => {
      render(<MaintenanceScreen />);
      fireEvent.press(screen.getAllByText('Due soon')[0]);
      expect(screen.getByText('Brake Pads')).toBeTruthy();
      expect(screen.getByText('Chain')).toBeTruthy();
      expect(screen.queryByText('Air Filter')).toBeNull();
    });

    it('"OK" shows only items that are fine', () => {
      render(<MaintenanceScreen />);
      fireEvent.press(screen.getAllByText('OK')[0]); // the filter pill (the item badge says OK too)
      expect(screen.getByText('Wash')).toBeTruthy();
      expect(screen.queryByText('Chain')).toBeNull();
    });

    it('says so when a filter matches nothing', () => {
      mockMaint.items = [item(4, 'Wash', 'ok')];
      render(<MaintenanceScreen />);
      fireEvent.press(screen.getAllByText('Overdue')[0]);
      expect(screen.getByText('No items match this filter.')).toBeTruthy();
    });

    it('"All items" brings everything back', () => {
      render(<MaintenanceScreen />);
      fireEvent.press(screen.getAllByText('Overdue')[0]);
      fireEvent.press(screen.getByText('All items'));
      expect(screen.getByText('Chain')).toBeTruthy();
    });

    it('opening an item goes to its log screen', () => {
      render(<MaintenanceScreen />);
      fireEvent.press(screen.getByLabelText('Chain — due'));
      expect(routerMocks.push).toHaveBeenCalledWith('/maintenance/log/3');
    });
  });

  describe('front and rear tyres', () => {
    it('sit side by side as small cards when both exist', () => {
      mockMaint.items = [
        item(1, 'Front Tyre', 'ok', { km_remaining: 5000, next_due_odo: 10000 }),
        item(2, 'Rear Tyre', 'ok', { km_remaining: 4000, next_due_odo: 9000 }),
      ];
      render(<MaintenanceScreen />);
      // compact cards say just "N km left"; full cards say "Due at … · N km left"
      expect(screen.getByText(`${(5000).toLocaleString()} km left`)).toBeTruthy();
      expect(screen.getByText(`${(4000).toLocaleString()} km left`)).toBeTruthy();
      expect(screen.queryByText(/Due at/)).toBeNull();
    });

    it('open their own log screens', () => {
      mockMaint.items = [item(1, 'Front Tyre', 'ok'), item(2, 'Rear Tyre', 'ok')];
      render(<MaintenanceScreen />);
      fireEvent.press(screen.getByLabelText('Rear Tyre — ok'));
      expect(routerMocks.push).toHaveBeenCalledWith('/maintenance/log/2');
    });

    it('a lone tyre is a normal full card', () => {
      mockMaint.items = [item(1, 'Front Tyre', 'ok', { km_remaining: 5000, next_due_odo: 10000 })];
      render(<MaintenanceScreen />);
      expect(screen.getByText(`Due at ${(10000).toLocaleString()} km · ${(5000).toLocaleString()} km left`)).toBeTruthy();
    });

    it('tyres in different sections are not paired', () => {
      mockMaint.items = [
        item(1, 'Front Tyre', 'overdue', { km_remaining: -50 }),
        item(2, 'Rear Tyre', 'ok', { km_remaining: 4000, next_due_odo: 9000 }),
      ];
      render(<MaintenanceScreen />);
      expect(screen.getByText(`Due at ${(9000).toLocaleString()} km · ${(4000).toLocaleString()} km left`)).toBeTruthy();
    });
  });

  describe('several vehicles', () => {
    beforeEach(() => {
      mockVehicles.vehicles = [vehicle(1, 'Aerox', 5000), vehicle(2, 'Civic', 80000)];
    });

    it('a picker switches the vehicle (and the odometer its statuses are judged by)', () => {
      render(<MaintenanceScreen />);
      fireEvent.press(screen.getAllByText('Civic')[0]);
      expect(mockMaintArgs[mockMaintArgs.length - 1]).toEqual([2, 80000]);
    });
  });

  it('pull-to-refresh reloads', async () => {
    mockMaint.items = [item(1, 'Wash', 'ok')];
    render(<MaintenanceScreen />);
    mockMaintReload.mockClear();
    await act(async () => {
      await screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(mockMaintReload).toHaveBeenCalledTimes(1);
  });
});
