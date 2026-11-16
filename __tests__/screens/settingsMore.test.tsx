/**
 * Settings screen — everything the notification tests (maintNotif/settingsNotifications.test.tsx) do not cover:
 * the header, tracking mode, PDF export, the privacy policy, the reminder thresholds (saved to a real SQLite
 * database via sql.js) and the iOS time picker.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Linking, Platform } from 'react-native';

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => require('../helpers/routerMock').expoRouterMock());
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('@/utils/export', () => ({ exportAllDataAsPdf: jest.fn() }));

const mockVehicles: { list: any[] } = { list: [] };
jest.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ vehicles: mockVehicles.list }) }));

const mockSwitchToAuto = jest.fn();
const mockSwitchToManual = jest.fn();
jest.mock('@/hooks/useTrackingMode', () => ({
  useTrackingMode: () => ({ switchToAuto: mockSwitchToAuto, switchToManual: mockSwitchToManual }),
}));
jest.mock('@/notifications/maintenanceNotifications', () => ({ syncMaintenanceNotifications: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/notifications/scheduler', () => ({ requestNotificationPermissions: jest.fn().mockResolvedValue(true) }));

const mockPicker: { props: any } = { props: null };
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: any) => {
    mockPicker.props = props;
    return null;
  },
  DateTimePickerAndroid: { open: jest.fn() },
}));

import { syncMaintenanceNotifications } from '@/notifications/maintenanceNotifications';
import { setTrackingMode } from '@/services/trackingPreferences';
import { getNotifyTime } from '@/services/notificationPreferences';
import { exportAllDataAsPdf } from '@/utils/export';
import SettingsScreen from '../../app/(tabs)/settings';
import { resetRouterMocks } from '../helpers/routerMock';
import { TestDb, createMigratedDb, setCurrentDb } from '../helpers/testDb';

const mExport = exportAllDataAsPdf as jest.Mock;
const mSync = syncMaintenanceNotifications as jest.Mock;

let db: TestDb;
const setting = (key: string) => db.getFirstSync<any>('SELECT value FROM app_settings WHERE key = ?', [key])?.value ?? null;
const vehicles = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, nickname: `V${i + 1}` }));

async function renderSettings() {
  render(<SettingsScreen />);
  await act(async () => {});
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetRouterMocks();
  db = await createMigratedDb();
  setCurrentDb(db);
  mockVehicles.list = [];
  mockPicker.props = null;
  mockSwitchToAuto.mockResolvedValue('granted');
  mockSwitchToManual.mockResolvedValue(undefined);
  mExport.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  setCurrentDb(null);
  jest.restoreAllMocks();
});

// ─── header & footer ──────────────────────────────────────────────────────────

describe('header', () => {
  it.each([
    [0, '0 vehicles'],
    [1, '1 vehicle'],
    [3, '3 vehicles'],
  ])('with %i vehicle(s) it says "%s"', async (n, text) => {
    mockVehicles.list = vehicles(n);
    await renderSettings();
    expect(screen.getByText(new RegExp(`^${text} · Local storage · Free$`))).toBeTruthy();
  });

  it('shows the app version and studio', async () => {
    await renderSettings();
    expect(screen.getByText('RideZen v1.0.0 · TulusNas Software Studio')).toBeTruthy();
  });

  it('shows the Pro upgrade as coming soon', async () => {
    await renderSettings();
    expect(screen.getByText('RideZen Pro')).toBeTruthy();
    expect(screen.getByText('Coming Soon')).toBeTruthy();
  });
});

// ─── tracking mode ────────────────────────────────────────────────────────────

describe('odometer tracking mode', () => {
  const pressAuto = async () => {
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Select auto-track always'));
    });
  };

  it('shows manual as the current mode by default', async () => {
    await renderSettings();
    expect(screen.getAllByText('✓')).toHaveLength(1);
  });

  it('shows auto when that is what was saved', async () => {
    setTrackingMode('auto');
    await renderSettings();
    expect(screen.getAllByText('✓')).toHaveLength(1);
    // pressing the active mode does nothing
    fireEvent.press(screen.getByLabelText('Select auto-track always'));
    expect(mockSwitchToAuto).not.toHaveBeenCalled();
  });

  it('needs a vehicle before auto-track can be enabled', async () => {
    await renderSettings();
    await pressAuto();
    expect(Alert.alert).toHaveBeenCalledWith('No vehicle', 'Add a vehicle first before enabling auto-track.');
    expect(mockSwitchToAuto).not.toHaveBeenCalled();
  });

  it('switching to auto uses the first vehicle and becomes the current mode', async () => {
    mockVehicles.list = vehicles(2);
    await renderSettings();
    await pressAuto();
    expect(mockSwitchToAuto).toHaveBeenCalledWith(1);
    // now auto is current: pressing it again does nothing, and manual can be chosen
    mockSwitchToAuto.mockClear();
    fireEvent.press(screen.getByLabelText('Select auto-track always'));
    expect(mockSwitchToAuto).not.toHaveBeenCalled();
  });

  it('shows "Requesting permissions…" while it works', async () => {
    mockVehicles.list = vehicles(1);
    let finish: (v: any) => void = () => {};
    mockSwitchToAuto.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderSettings();
    await pressAuto();
    expect(screen.getByText('Requesting permissions…')).toBeTruthy();
    await act(async () => finish('granted'));
    expect(screen.queryByText('Requesting permissions…')).toBeNull();
  });

  it.each(['foreground_denied', 'background_only_while_using'])('%s: explains it needs "Always Allow"', async (outcome) => {
    mockVehicles.list = vehicles(1);
    mockSwitchToAuto.mockResolvedValue(outcome);
    await renderSettings();
    await pressAuto();
    expect(Alert.alert).toHaveBeenCalledWith('Auto-track needs "Always Allow"', expect.stringContaining('Tap again to retry'), [{ text: 'OK' }]);
  });

  it.each(['foreground_never_ask', 'background_never_ask'])('%s: points to the phone settings', async (outcome) => {
    mockVehicles.list = vehicles(1);
    mockSwitchToAuto.mockResolvedValue(outcome);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await renderSettings();
    await pressAuto();
    const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
    expect(title).toBe('Permission required');
    buttons.find((b: any) => b.text === 'Open Settings').onPress();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('background_denied: says it could not start', async () => {
    mockVehicles.list = vehicles(1);
    mockSwitchToAuto.mockResolvedValue('background_denied');
    await renderSettings();
    await pressAuto();
    expect(Alert.alert).toHaveBeenCalledWith('Could not start auto-track', 'Please try again.', [{ text: 'OK' }]);
  });

  it('a refused switch leaves manual as the current mode', async () => {
    mockVehicles.list = vehicles(1);
    mockSwitchToAuto.mockResolvedValue('background_denied');
    await renderSettings();
    await pressAuto();
    mockSwitchToAuto.mockClear();
    fireEvent.press(screen.getByLabelText('Select manual ride session'));
    expect(mockSwitchToManual).not.toHaveBeenCalled(); // already manual
  });

  it('switching back to manual', async () => {
    setTrackingMode('auto');
    await renderSettings();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Select manual ride session'));
    });
    expect(mockSwitchToManual).toHaveBeenCalledTimes(1);
  });
});

// ─── export ───────────────────────────────────────────────────────────────────

describe('export data', () => {
  const pressExport = async () => {
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Export data'));
    });
  };

  it('needs a vehicle', async () => {
    await renderSettings();
    await pressExport();
    expect(Alert.alert).toHaveBeenCalledWith('No vehicle', 'Add a vehicle first.');
    expect(mExport).not.toHaveBeenCalled();
  });

  it('exports the report', async () => {
    mockVehicles.list = vehicles(1);
    await renderSettings();
    await pressExport();
    expect(mExport).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('says "Generating PDF…" while it works, and ignores another tap', async () => {
    mockVehicles.list = vehicles(1);
    let finish: () => void = () => {};
    mExport.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    await renderSettings();
    await pressExport();

    expect(screen.getByText('Generating PDF…')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Export data'));
    expect(mExport).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(screen.getByText('PDF report of all your data')).toBeTruthy();
  });

  it('shows the reason when the export fails, and can be tried again', async () => {
    mockVehicles.list = vehicles(1);
    mExport.mockRejectedValueOnce(new Error('Could not generate PDF. Please try again.'));
    await renderSettings();
    await pressExport();
    expect(Alert.alert).toHaveBeenCalledWith('Export failed', 'Could not generate PDF. Please try again.');
    expect(screen.getByText('PDF report of all your data')).toBeTruthy();

    await pressExport();
    expect(mExport).toHaveBeenCalledTimes(2);
  });
});

// ─── privacy ──────────────────────────────────────────────────────────────────

describe('privacy policy', () => {
  it('opens and closes', async () => {
    await renderSettings();
    expect(screen.queryByText('Privacy Policy')).toBeNull();
    fireEvent.press(screen.getByLabelText('Privacy'));
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
    fireEvent.press(screen.getByText('← Close'));
    expect(screen.queryByText('Privacy Policy')).toBeNull();
  });

  it('says what the app does with the rider\'s data', async () => {
    await renderSettings();
    fireEvent.press(screen.getByLabelText('Privacy'));
    for (const title of ['Your data stays on your device', 'Location data', 'No accounts required', 'No analytics or tracking', 'Export and backup', 'Data deletion', 'Contact']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });
});

// ─── reminder thresholds ──────────────────────────────────────────────────────

describe('reminder thresholds', () => {
  it('start at the defaults', async () => {
    await renderSettings();
    expect(screen.getByText(`${(1000).toLocaleString()} km · 14 days before`)).toBeTruthy(); // early warning
    expect(screen.getByText('200 km · 3 days before')).toBeTruthy(); // final reminder
  });

  it('show what was saved', async () => {
    db.runSync(`INSERT INTO app_settings (key, value) VALUES ('early_warning_km', '1500'), ('early_warning_days', '30')`);
    await renderSettings();
    expect(screen.getByText(`${(1500).toLocaleString()} km · 30 days before`)).toBeTruthy();
  });

  describe('the editor', () => {
    const open = (label: string) => fireEvent.press(screen.getByLabelText(label));
    const km = (text: string) => fireEvent.changeText(screen.getByLabelText('km before due'), text);
    const days = (text: string) => fireEvent.changeText(screen.getByLabelText('days before due'), text);
    const saveModal = () => fireEvent.press(screen.getByText('Save'));

    it('opens on the current values', async () => {
      db.runSync(`INSERT INTO app_settings (key, value) VALUES ('final_reminder_km', '350'), ('final_reminder_days', '5')`);
      await renderSettings();
      open('Default final reminder');
      expect(screen.getByText('Default Final Reminder')).toBeTruthy();
      expect(screen.getByLabelText('km before due').props.value).toBe('350');
      expect(screen.getByLabelText('days before due').props.value).toBe('5');
    });

    it('saves new early-warning values, updates the row and re-checks notifications', async () => {
      await renderSettings();
      open('Default early warning');
      km('800');
      days('20');
      saveModal();

      expect(setting('early_warning_km')).toBe('800');
      expect(setting('early_warning_days')).toBe('20');
      expect(screen.getByText('800 km · 20 days before')).toBeTruthy();
      expect(screen.queryByText('Default Early Warning')).toBeNull(); // modal closed
      expect(mSync).toHaveBeenCalledTimes(1);
    });

    it('saves new final-reminder values to their own keys', async () => {
      await renderSettings();
      open('Default final reminder');
      km('250');
      days('4');
      saveModal();
      expect(setting('final_reminder_km')).toBe('250');
      expect(setting('final_reminder_days')).toBe('4');
      expect(setting('early_warning_km')).toBeNull();
    });

    it('keeps whole days and allows fractional km', async () => {
      await renderSettings();
      open('Default early warning');
      km('750.5');
      days('2.7');
      saveModal();
      expect(setting('early_warning_km')).toBe('750.5');
      expect(setting('early_warning_days')).toBe('2');
    });

    it.each([
      ['abc', 'Enter a valid km value.'],
      ['-5', 'Enter a valid km value.'],
      ['0', 'Enter a valid km value.'],
    ])('refuses km "%s"', async (bad, message) => {
      await renderSettings();
      open('Default early warning');
      km(bad);
      saveModal();
      expect(Alert.alert).toHaveBeenCalledWith('Invalid', message);
      expect(setting('early_warning_km')).toBeNull();
      expect(screen.getByText('Default Early Warning')).toBeTruthy(); // stays open
      expect(mSync).not.toHaveBeenCalled();
    });

    it.each(['abc', '0', '-2'])('refuses days "%s"', async (bad) => {
      await renderSettings();
      open('Default early warning');
      days(bad);
      saveModal();
      expect(Alert.alert).toHaveBeenCalledWith('Invalid', 'Enter a valid number of days.');
      expect(setting('early_warning_days')).toBeNull();
    });

    it('Cancel saves nothing and does not re-check', async () => {
      await renderSettings();
      open('Default early warning');
      km('800');
      fireEvent.press(screen.getByText('Cancel'));
      expect(setting('early_warning_km')).toBeNull();
      expect(screen.queryByText('Default Early Warning')).toBeNull();
      expect(mSync).not.toHaveBeenCalled();
    });

    it('can be left blank: those values stay as they were', async () => {
      db.runSync(`INSERT INTO app_settings (key, value) VALUES ('early_warning_km', '900')`);
      await renderSettings();
      open('Default early warning');
      km('');
      days('');
      saveModal();
      expect(setting('early_warning_km')).toBe('900');
    });

    it('reopens on the saved values, not stale ones', async () => {
      await renderSettings();
      open('Default early warning');
      km('800');
      saveModal();
      open('Default early warning');
      expect(screen.getByLabelText('km before due').props.value).toBe('800');
    });
  });
});

// ─── iOS time picker ──────────────────────────────────────────────────────────

describe('notification time on iOS', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'ios');
  });

  it('opens an inline picker on the saved time', async () => {
    await renderSettings();
    expect(mockPicker.props).toBeNull();
    fireEvent.press(screen.getByLabelText('Notification time'));
    expect(mockPicker.props).not.toBeNull();
    expect(mockPicker.props.mode).toBe('time');
    expect(mockPicker.props.value.getHours()).toBe(9);
  });

  it('picking a time saves it and re-checks notifications', async () => {
    await renderSettings();
    fireEvent.press(screen.getByLabelText('Notification time'));
    await act(async () => {
      mockPicker.props.onChange({ type: 'set' }, new Date(2026, 0, 1, 18, 45));
    });
    expect(getNotifyTime()).toBe('18:45');
    expect(screen.getByText(/6:45 PM/)).toBeTruthy();
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it('dismissing the picker changes nothing', async () => {
    await renderSettings();
    fireEvent.press(screen.getByLabelText('Notification time'));
    await act(async () => {
      mockPicker.props.onChange({ type: 'dismissed' }, undefined);
    });
    expect(getNotifyTime()).toBe('09:00');
    expect(mSync).not.toHaveBeenCalled();
  });
});
