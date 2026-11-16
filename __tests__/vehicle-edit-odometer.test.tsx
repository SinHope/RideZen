/**
 * Edit Vehicle screen — odometer field behaviour.
 *
 * Covers two bugs:
 *  1. Keyboard hides the odometer field on Android.
 *  2. Odometer shows long GPS decimals (e.g. 12345.678912).
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import type { Vehicle } from '@/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Native animation libs can't run in Node — use their official Jest mocks.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: '1' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/repositories/vehicleRepo', () => ({
  vehicleRepo: {
    getById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

import { vehicleRepo } from '@/repositories/vehicleRepo';
import VehicleDetailScreen from '../app/vehicle/[id]';

const mockRepo = vehicleRepo as jest.Mocked<typeof vehicleRepo>;

// A vehicle whose odometer has GPS decimals from ride tracking
const VEHICLE: Vehicle = {
  id: 1,
  nickname: 'Aerox',
  type: 'scooter',
  make: 'Yamaha',
  model: 'Aerox 155',
  year: 2019,
  plate_number: 'FBR2762C',
  current_odometer: 12345.678912,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const ODOMETER_PLACEHOLDER = '0'; // only the odometer input uses this placeholder

async function renderScreen() {
  render(<VehicleDetailScreen />);
  return screen.findByPlaceholderText(ODOMETER_PLACEHOLDER);
}

async function pressUpdateAndConfirm() {
  fireEvent.press(screen.getByLabelText('Update vehicle'));
  fireEvent.press(await screen.findByText('Yes, update'));
  await waitFor(() => expect(mockRepo.update).toHaveBeenCalledTimes(1));
  return mockRepo.update.mock.calls[0][1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.getById.mockResolvedValue({ data: { ...VEHICLE }, error: null });
  mockRepo.update.mockResolvedValue({ data: undefined, error: null });
});

// ─── Bug 2: decimals ──────────────────────────────────────────────────────────
describe('odometer display', () => {
  it('shows the odometer rounded to a whole number', async () => {
    const input = await renderScreen();
    expect(input.props.value).toBe('12346');
  });

  it('rounds down correctly too', async () => {
    mockRepo.getById.mockResolvedValue({ data: { ...VEHICLE, current_odometer: 500.4 }, error: null });
    const input = await renderScreen();
    expect(input.props.value).toBe('500');
  });

  it('uses a whole-number keyboard (no decimal key)', async () => {
    const input = await renderScreen();
    expect(input.props.keyboardType).toBe('number-pad');
  });
});

// ─── Bug 2: saving ────────────────────────────────────────────────────────────
describe('saving', () => {
  it('does NOT overwrite the precise odometer when only another field changed', async () => {
    await renderScreen();
    fireEvent.changeText(screen.getByDisplayValue('Aerox'), 'Aerox Blue');

    const payload = await pressUpdateAndConfirm();
    expect(payload.nickname).toBe('Aerox Blue');
    // undefined → vehicleRepo.update skips the column, keeping 12345.678912 in the DB
    expect(payload.current_odometer).toBeUndefined();
  });

  it('saves the new whole number when the user edits the odometer', async () => {
    const input = await renderScreen();
    fireEvent.changeText(input, '13000');

    const payload = await pressUpdateAndConfirm();
    expect(payload.current_odometer).toBe(13000);
  });
});

// ─── Bug 1: keyboard ──────────────────────────────────────────────────────────
describe('keyboard handling', () => {
  afterEach(() => jest.restoreAllMocks());

  it('pushes content above the keyboard on Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderScreen();
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
  });

  it('scrolls to the odometer field when it is tapped', async () => {
    jest.useFakeTimers();
    try {
      const scrollToEnd = (ScrollView.prototype as any).scrollToEnd as jest.Mock;
      scrollToEnd.mockClear();

      const input = await renderScreen();
      fireEvent(input, 'focus');
      act(() => { jest.advanceTimersByTime(500); });

      expect(scrollToEnd).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
