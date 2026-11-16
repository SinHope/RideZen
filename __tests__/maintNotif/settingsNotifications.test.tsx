/**
 * Settings → Reminders: the notification controls are real (saved, and they drive the sync).
 * Module under test (EXISTS, needs change): app/(tabs)/settings.tsx
 *
 *   Push notifications          [switch]   saved in app_settings; OFF cancels pending, ON asks permission + re-checks
 *     Notification time         row        opens the Android time dialog; saved as "HH:MM"; re-books date reminders
 *     Group into one summary    [switch]   saved; applies to the next check
 *   Default early warning / Default final reminder → saving a threshold re-checks (levels move with it)
 *
 * The time and summary controls are disabled while push notifications are OFF.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

// Native animation libs can't run in Node — use their official Jest mocks.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('expo-router', () => ({
  // run once on mount, like a screen that just got focus
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/utils/export', () => ({ exportAllDataAsPdf: jest.fn() }));
jest.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ vehicles: [] }) }));
jest.mock('@/hooks/useTrackingMode', () => ({
  useTrackingMode: () => ({ switchToAuto: jest.fn(), switchToManual: jest.fn() }),
}));
jest.mock('@/services/trackingPreferences', () => ({ getTrackingMode: () => 'manual' }));
jest.mock('@/db/client', () => ({
  // threshold settings fall back to their defaults; writes are no-ops
  getDb: () => ({ getFirstSync: () => null, runSync: jest.fn() }),
}));

let mockEnabled = true;
let mockTime = '09:00';
let mockGrouped = false;
jest.mock('@/services/notificationPreferences', () => ({
  getMaintenanceNotifEnabled: jest.fn(() => mockEnabled),
  setMaintenanceNotifEnabled: jest.fn((v: boolean) => {
    mockEnabled = v;
  }),
  getNotifyTime: jest.fn(() => mockTime),
  setNotifyTime: jest.fn((t: string) => {
    mockTime = t;
    return true;
  }),
  getNotifyGrouped: jest.fn(() => mockGrouped),
  setNotifyGrouped: jest.fn((v: boolean) => {
    mockGrouped = v;
  }),
}));
jest.mock('@/notifications/maintenanceNotifications', () => ({
  syncMaintenanceNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/notifications/scheduler', () => ({
  requestNotificationPermissions: jest.fn().mockResolvedValue(true),
}));
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));

import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as prefs from '@/services/notificationPreferences';
import { syncMaintenanceNotifications } from '@/notifications/maintenanceNotifications';
import { requestNotificationPermissions } from '@/notifications/scheduler';
import SettingsScreen from '../../app/(tabs)/settings';

const mPrefs = prefs as jest.Mocked<typeof prefs>;
const mSync = syncMaintenanceNotifications as jest.Mock;
const mAsk = requestNotificationPermissions as jest.Mock;
const mOpen = DateTimePickerAndroid.open as jest.Mock;

const pushSwitch = () => screen.getByLabelText('Toggle push notifications');
const groupSwitch = () => screen.getByLabelText('Toggle grouped summary');
// On Android the native switch exposes `on` (not `value`) and `enabled` (not `disabled`)
const isOn = (el: any) => el.props.on === true;
const isDisabled = (el: any) => el.props.enabled === false || el.props.accessibilityState?.disabled === true;

async function renderScreen() {
  render(<SettingsScreen />);
  await screen.findByText('Settings');
}

async function flip(el: any, value: boolean) {
  await act(async () => {
    fireEvent(el, 'valueChange', value);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnabled = true;
  mockTime = '09:00';
  mockGrouped = false;
  mAsk.mockResolvedValue(true);
  mSync.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('showing the saved settings', () => {
  it('push notifications ON, 9:00 AM, summary OFF by default', async () => {
    await renderScreen();
    expect(isOn(pushSwitch())).toBe(true);
    expect(isOn(groupSwitch())).toBe(false);
    expect(screen.getByText(/9:00 AM/)).toBeTruthy();
  });

  it('shows what was saved, not a hard-coded default', async () => {
    mockEnabled = false;
    mockTime = '20:30';
    mockGrouped = true;
    await renderScreen();
    expect(isOn(pushSwitch())).toBe(false);
    expect(isOn(groupSwitch())).toBe(true);
    expect(screen.getByText(/8:30 PM/)).toBeTruthy();
  });
});

describe('push notifications switch', () => {
  it('OFF: saves it and re-checks (which cancels what is pending)', async () => {
    await renderScreen();
    await flip(pushSwitch(), false);

    expect(mPrefs.setMaintenanceNotifEnabled).toHaveBeenCalledWith(false);
    expect(mSync).toHaveBeenCalledTimes(1);
    expect(mAsk).not.toHaveBeenCalled();
    expect(isOn(pushSwitch())).toBe(false);
  });

  it('ON: saves it, asks for permission, then re-checks (so anything missed while off is sent)', async () => {
    mockEnabled = false;
    await renderScreen();
    await flip(pushSwitch(), true);

    expect(mPrefs.setMaintenanceNotifEnabled).toHaveBeenCalledWith(true);
    expect(mAsk).toHaveBeenCalledTimes(1);
    expect(mSync).toHaveBeenCalledTimes(1);
    expect(mAsk.mock.invocationCallOrder[0]).toBeLessThan(mSync.mock.invocationCallOrder[0]);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('ON but the phone blocks notifications: explains how to allow them', async () => {
    mockEnabled = false;
    mAsk.mockResolvedValue(false);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await renderScreen();
    await flip(pushSwitch(), true);

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toMatch(/notifications/i);
    const open = buttons.find((b: any) => b.text === 'Open Settings');
    expect(open).toBeDefined();
    open.onPress();
    expect(openSettings).toHaveBeenCalled();
  });
});

describe('notification time', () => {
  it('opens the Android time dialog on the saved time', async () => {
    mockTime = '20:30';
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Notification time'));

    expect(mOpen).toHaveBeenCalledTimes(1);
    const opts = mOpen.mock.calls[0][0];
    expect(opts.mode).toBe('time');
    expect(opts.value.getHours()).toBe(20);
    expect(opts.value.getMinutes()).toBe(30);
  });

  it('saves the picked time and re-checks so date reminders move to it', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Notification time'));
    const { onChange } = mOpen.mock.calls[0][0];

    await act(async () => {
      onChange({ type: 'set' }, new Date(2026, 0, 1, 20, 30));
    });

    expect(mPrefs.setNotifyTime).toHaveBeenCalledWith('20:30');
    expect(mSync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/8:30 PM/)).toBeTruthy());
  });

  it('cancelling the dialog changes nothing', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Notification time'));
    const { onChange } = mOpen.mock.calls[0][0];

    await act(async () => {
      onChange({ type: 'dismissed' }, undefined);
    });

    expect(mPrefs.setNotifyTime).not.toHaveBeenCalled();
    expect(mSync).not.toHaveBeenCalled();
    expect(screen.getByText(/9:00 AM/)).toBeTruthy();
  });
});

describe('group into one summary', () => {
  it('saves the choice and re-checks', async () => {
    await renderScreen();
    await flip(groupSwitch(), true);

    expect(mPrefs.setNotifyGrouped).toHaveBeenCalledWith(true);
    expect(mSync).toHaveBeenCalledTimes(1);
    expect(isOn(groupSwitch())).toBe(true);
  });
});

describe('while push notifications are OFF', () => {
  beforeEach(() => {
    mockEnabled = false;
  });

  it('the summary switch is disabled', async () => {
    await renderScreen();
    expect(isDisabled(groupSwitch())).toBe(true);
  });

  it('the time row does not open the dialog', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Notification time'));
    expect(mOpen).not.toHaveBeenCalled();
  });

  it('turning push notifications ON enables them again', async () => {
    await renderScreen();
    await flip(pushSwitch(), true);
    expect(isDisabled(groupSwitch())).toBe(false);
    fireEvent.press(screen.getByLabelText('Notification time'));
    expect(mOpen).toHaveBeenCalledTimes(1);
  });
});

describe('changing a reminder threshold', () => {
  it('re-checks, because the due / urgent levels move with the thresholds', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Default early warning'));
    fireEvent.changeText(await screen.findByLabelText('km before due'), '800');
    fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(mSync).toHaveBeenCalledTimes(1));
  });

  it('does not re-check when the change is cancelled', async () => {
    await renderScreen();
    fireEvent.press(screen.getByLabelText('Default early warning'));
    await screen.findByLabelText('km before due');
    fireEvent.press(screen.getByText('Cancel'));
    expect(mSync).not.toHaveBeenCalled();
  });
});
