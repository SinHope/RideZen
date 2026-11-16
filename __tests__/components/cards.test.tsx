/**
 * The list cards: FuelLogItem, MaintenanceItemCard and VehicleCard.
 * "Today" is frozen at 17 Nov 2026 (VehicleCard shows "last refuel" relative to it).
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Alert, StyleSheet, View } from 'react-native';

// Native animation libs can't run in Node — use their official Jest mocks.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

import { FuelLogItem } from '@/components/FuelLogItem';
import { MaintenanceItemCard } from '@/components/MaintenanceItemCard';
import { VehicleCard } from '@/components/VehicleCard';
import type { FuelLog, MaintenanceItem, Vehicle } from '@/types';
import { formatDate } from '@/utils/consumption';
import { freezeClock, unfreezeClock } from '../helpers/testDb';

beforeEach(() => {
  jest.clearAllMocks();
  freezeClock(2026, 10, 17);
});
afterEach(() => {
  unfreezeClock();
  jest.restoreAllMocks();
});

const n = (v: number) => v.toLocaleString();

// ─── FuelLogItem ──────────────────────────────────────────────────────────────

describe('FuelLogItem', () => {
  const log = (over: Partial<FuelLog> = {}): FuelLog => ({
    id: 1,
    vehicle_id: 1,
    date: '2026-11-05',
    odometer: 12345.6,
    litres: 5.25,
    is_full_tank: 1,
    created_at: '',
    ...over,
  });

  it('shows the date, litres and rounded odometer', () => {
    render(<FuelLogItem log={log()} />);
    expect(screen.getByText(new RegExp(formatDate('2026-11-05')))).toBeTruthy();
    expect(screen.getByText(/5\.3 L/)).toBeTruthy(); // 5.25 → one decimal
    expect(screen.getByText(n(12346))).toBeTruthy();
  });

  it('shows consumption, or a dash before one can be worked out', () => {
    const { rerender } = render(<FuelLogItem log={log({ consumption: 4.56 })} />);
    expect(screen.getByText('4.6 L/100km')).toBeTruthy();
    rerender(<FuelLogItem log={log()} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('appends the notes to the date line', () => {
    render(<FuelLogItem log={log({ notes: 'Shell V-Power' })} />);
    expect(screen.getByText(new RegExp(`${formatDate('2026-11-05')}.*Shell V-Power`))).toBeTruthy();
  });

  it('shows price per litre and the cost in the log\'s currency', () => {
    render(<FuelLogItem log={log({ litres: 10, price_per_litre: 2.5, currency: 'MYR' })} />);
    expect(screen.getByText('MYR 2.50/L')).toBeTruthy();
    expect(screen.getByText('MYR 25.00')).toBeTruthy(); // 10 L × 2.50
  });

  it('assumes SGD when no currency was stored', () => {
    render(<FuelLogItem log={log({ litres: 4, price_per_litre: 2 })} />);
    expect(screen.getByText('SGD 2.00/L')).toBeTruthy();
    expect(screen.getByText('SGD 8.00')).toBeTruthy();
  });

  it('hides price and cost when there is no price', () => {
    render(<FuelLogItem log={log()} />);
    expect(screen.queryByText(/\/L$/)).toBeNull();
    expect(screen.queryByText(/Cost/)).toBeNull();
  });

  it('only offers edit and delete when handlers are given', () => {
    const { rerender } = render(<FuelLogItem log={log()} />);
    expect(screen.queryByLabelText('Edit entry')).toBeNull();
    expect(screen.queryByLabelText('Delete entry')).toBeNull();
    rerender(<FuelLogItem log={log()} onEdit={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.getByLabelText('Edit entry')).toBeTruthy();
    expect(screen.getByLabelText('Delete entry')).toBeTruthy();
  });

  it('edit calls straight back', () => {
    const onEdit = jest.fn();
    render(<FuelLogItem log={log()} onEdit={onEdit} />);
    fireEvent.press(screen.getByLabelText('Edit entry'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('delete asks first, and only deletes on "Delete"', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDelete = jest.fn();
    render(<FuelLogItem log={log()} onDelete={onDelete} />);

    fireEvent.press(screen.getByLabelText('Delete entry'));

    expect(onDelete).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alert.mock.calls[0];
    expect(title).toBe('Delete entry?');
    const cancel = buttons!.find((b) => b.text === 'Cancel')!;
    const del = buttons!.find((b) => b.text === 'Delete')!;
    expect(del.style).toBe('destructive');
    expect(cancel.onPress).toBeUndefined(); // cancel just closes the alert

    del.onPress!();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

// ─── MaintenanceItemCard ──────────────────────────────────────────────────────

describe('MaintenanceItemCard', () => {
  const item = (over: Partial<MaintenanceItem> = {}): MaintenanceItem => ({
    id: 1,
    vehicle_id: 1,
    category: 'Engine Oil',
    vehicle_type_scope: 'universal',
    updated_at: '',
    status: 'ok',
    ...over,
  });

  describe('full card', () => {
    it('shows the category and its status badge', () => {
      render(<MaintenanceItemCard item={item({ status: 'urgent' })} />);
      expect(screen.getByText('Engine Oil')).toBeTruthy();
      expect(screen.getByText('Urgent')).toBeTruthy();
    });

    it('treats a missing status as OK', () => {
      render(<MaintenanceItemCard item={item({ status: undefined })} />);
      expect(screen.getByText('OK')).toBeTruthy();
    });

    it('is a button labelled with the category and status, and calls onPress', () => {
      const onPress = jest.fn();
      render(<MaintenanceItemCard item={item({ status: 'overdue' })} onPress={onPress} />);
      fireEvent.press(screen.getByLabelText('Engine Oil — overdue'));
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('overdue with no figures says just "Overdue" (next to the Overdue badge)', () => {
      render(<MaintenanceItemCard item={item({ status: 'overdue' })} />);
      expect(screen.getAllByText('Overdue')).toHaveLength(2); // the text line + the badge
    });

    it.each<[string, Partial<MaintenanceItem>, string]>([
      ['km overdue', { status: 'overdue', km_remaining: -1200.4 }, `${n(1200)} km overdue`],
      ['days overdue', { status: 'overdue', days_remaining: -3 }, '3 days overdue'],
      ['overdue by date even though km is fine', { status: 'overdue', km_remaining: 500, days_remaining: -2 }, '2 days overdue'],
      ['due by km', { status: 'due', km_remaining: 700.4, next_due_odo: 6000 }, `Due at ${n(6000)} km · ${n(700)} km left`],
      ['due by date', { status: 'due', days_remaining: 12, next_due_date: '2026-12-01' }, 'Due 2026-12-01 · 12 days left'],
      ['km wins when both are set', { status: 'ok', km_remaining: 900, next_due_odo: 6000, days_remaining: 5, next_due_date: '2026-11-22' }, `Due at ${n(6000)} km · ${n(900)} km left`],
      ['nothing scheduled', { status: 'ok' }, 'No schedule set'],
    ])('%s', (_label, over, expected) => {
      render(<MaintenanceItemCard item={item(over)} />);
      expect(screen.getByText(expected)).toBeTruthy();
    });
  });

  describe('compact card', () => {
    it('overdue with no figures says just "Overdue" (next to the Overdue badge)', () => {
      render(<MaintenanceItemCard item={item({ status: 'overdue' })} compact />);
      expect(screen.getAllByText('Overdue')).toHaveLength(2); // the text line + the badge
    });

    it.each<[string, Partial<MaintenanceItem>, string]>([
      ['km over', { status: 'overdue', km_remaining: -150 }, '150 km over'],
      ['days over', { status: 'overdue', days_remaining: -4 }, '4d over'],
      ['km left', { status: 'due', km_remaining: 850 }, '850 km left'],
      ['days left', { status: 'due', days_remaining: 9 }, '9 days left'],
      ['nothing scheduled', { status: 'ok' }, 'No schedule'],
    ])('%s', (_label, over, expected) => {
      render(<MaintenanceItemCard item={item(over)} compact />);
      expect(screen.getByText(expected)).toBeTruthy();
    });

    it('is also a labelled button', () => {
      const onPress = jest.fn();
      render(<MaintenanceItemCard item={item({ category: 'Chain', status: 'due' })} compact onPress={onPress} />);
      fireEvent.press(screen.getByLabelText('Chain — due'));
      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });

  describe('progress bar', () => {
    const barWidth = () =>
      screen.UNSAFE_getAllByType(View)
        .map((v) => StyleSheet.flatten(v.props.style)?.width)
        .find((w) => typeof w === 'string' && w.endsWith('%'));

    it('is as wide as the share of the interval used', () => {
      render(<MaintenanceItemCard item={item({ progress_pct: 40 })} />);
      expect(barWidth()).toBe('40%');
    });

    it('is empty when no progress is known', () => {
      render(<MaintenanceItemCard item={item({ progress_pct: undefined })} />);
      expect(barWidth()).toBe('0%');
    });

    it('never grows past the full width', () => {
      render(<MaintenanceItemCard item={item({ progress_pct: 180 })} compact />);
      expect(barWidth()).toBe('100%');
    });
  });
});

// ─── VehicleCard ──────────────────────────────────────────────────────────────

describe('VehicleCard', () => {
  const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
    id: 1,
    nickname: 'Aerox',
    type: 'scooter',
    make: 'Yamaha',
    model: 'Aerox 155',
    plate_number: 'FBR2762C',
    current_odometer: 12345.6,
    created_at: '',
    updated_at: '',
    ...over,
  });

  it('shows the name, type, make · model · plate and odometer', () => {
    render(<VehicleCard vehicle={vehicle()} />);
    expect(screen.getByText('Aerox')).toBeTruthy();
    expect(screen.getByText('Scooter / CVT')).toBeTruthy();
    expect(screen.getByText('Yamaha · Aerox 155 · FBR2762C')).toBeTruthy();
    expect(screen.getByText(`${n(12346)} km`)).toBeTruthy();
  });

  it.each([
    ['scooter', 'Scooter / CVT'],
    ['manual_bike', 'Manual Motorcycle'],
    ['car', 'Car'],
    ['other', 'Vehicle'],
  ] as const)('labels a %s as "%s"', (type, label) => {
    render(<VehicleCard vehicle={vehicle({ type })} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('leaves out the detail line when there is no make, model or plate', () => {
    render(<VehicleCard vehicle={vehicle({ make: undefined, model: undefined, plate_number: undefined })} />);
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('shows only what exists on the detail line', () => {
    render(<VehicleCard vehicle={vehicle({ make: 'Honda', model: undefined, plate_number: undefined })} />);
    expect(screen.getByText('Honda')).toBeTruthy();
  });

  describe('status badge', () => {
    it('says "All good" with nothing due', () => {
      render(<VehicleCard vehicle={vehicle()} />);
      expect(screen.getByText('All good')).toBeTruthy();
    });

    it('counts due items', () => {
      render(<VehicleCard vehicle={vehicle()} dueCount={3} />);
      expect(screen.getByText('3 Due soon')).toBeTruthy();
    });

    it('overdue takes priority over due', () => {
      render(<VehicleCard vehicle={vehicle()} overdueCount={2} dueCount={5} />);
      expect(screen.getByText('2 Overdue')).toBeTruthy();
      expect(screen.queryByText(/Due soon/)).toBeNull();
    });
  });

  describe('stats', () => {
    it('shows the last refuel relative to today, and average consumption', () => {
      render(<VehicleCard vehicle={vehicle()} lastRefuelDate="2026-11-14" avgConsumption={4.56} />);
      expect(screen.getByText('3 days ago')).toBeTruthy();
      expect(screen.getByText('4.6 L')).toBeTruthy();
    });

    it('shows dashes when there is no data yet', () => {
      render(<VehicleCard vehicle={vehicle()} />);
      expect(screen.getAllByText('—')).toHaveLength(2);
    });
  });

  it('is a button that opens the vehicle', () => {
    const onPress = jest.fn();
    render(<VehicleCard vehicle={vehicle()} onPress={onPress} />);
    fireEvent.press(screen.getByLabelText('Aerox vehicle card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  describe('ride session', () => {
    it('manual mode (default) offers Start Ride', () => {
      const onStartRide = jest.fn();
      render(<VehicleCard vehicle={vehicle()} onStartRide={onStartRide} />);
      fireEvent.press(screen.getByLabelText('Start tracking this ride'));
      expect(onStartRide).toHaveBeenCalledTimes(1);
    });

    it('manual mode while tracking: shows the live distance and an End Ride button', () => {
      const onEndRide = jest.fn();
      render(<VehicleCard vehicle={vehicle()} isTracking isAnyRideActive rideDistanceKm={3.456} onEndRide={onEndRide} />);
      expect(screen.getByText('Live')).toBeTruthy();
      expect(screen.getByText('+3.5 km')).toBeTruthy();
      fireEvent.press(screen.getByLabelText('End ride and save distance'));
      expect(onEndRide).toHaveBeenCalledTimes(1);
    });

    it('auto mode has no Start/End button, but still shows live distance while tracking', () => {
      render(<VehicleCard vehicle={vehicle()} trackingMode="auto" isTracking rideDistanceKm={1.2} />);
      expect(screen.queryByLabelText('Start tracking this ride')).toBeNull();
      expect(screen.queryByLabelText('End ride and save distance')).toBeNull();
      expect(screen.getByText('+1.2 km')).toBeTruthy();
    });

    it('no live row when not tracking', () => {
      render(<VehicleCard vehicle={vehicle()} />);
      expect(screen.queryByText('Live')).toBeNull();
    });

    it('does not break when the ride handlers are not supplied', () => {
      render(<VehicleCard vehicle={vehicle()} />);
      expect(() => fireEvent.press(screen.getByLabelText('Start tracking this ride'))).not.toThrow();
    });
  });
});
