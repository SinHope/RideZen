/**
 * app/_layout.tsx — the root of the app: start-up (migrations, notification channels), the splash and tutorial,
 * the launch checks, and the list of screens.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

// Modules that must load BEFORE anything renders (they register background tasks / listeners). The factories
// record the order they were first required in.
// (a function declaration, so it exists when the hoisted factories run)
function mockNoteLoad(name: string) {
  const g = globalThis as any;
  (g.__loadOrder ??= []).push(name);
}

jest.mock('../../src/global.css', () => ({}));
jest.mock('@/services/backgroundLocationTask', () => (mockNoteLoad('backgroundLocationTask'), {}));
jest.mock('@/notifications/idleResponseHandler', () => (mockNoteLoad('idleResponseHandler'), {}));
jest.mock('@/notifications/maintenanceResponseHandler', () => {
  mockNoteLoad('maintenanceResponseHandler');
  return { handleLastMaintenanceResponse: jest.fn() };
});
jest.mock('@/services/maintenanceBackgroundTask', () => (mockNoteLoad('maintenanceBackgroundTask'), {}));

const mockStackScreens: { name: string; options?: any }[] = [];
const mockNav = { key: 'root' as string | undefined };
jest.mock('expo-router', () => {
  mockNoteLoad('expo-router');
  const Stack: any = ({ children }: any) => <>{children}</>;
  Stack.Screen = (props: any) => {
    mockStackScreens.push({ name: props.name, options: props.options });
    return null;
  };
  return { Stack, useRootNavigationState: () => ({ key: mockNav.key }) };
});
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: any) => <>{children}</>,
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: any) => <>{children}</> }));

// the layout calls preventAutoHideAsync() as soon as it is imported, so these must exist inside the factory
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn() }));

const mockFonts = { loaded: true };
jest.mock('@expo-google-fonts/playfair-display', () => ({
  useFonts: () => [mockFonts.loaded],
  PlayfairDisplay_400Regular: 1,
  PlayfairDisplay_500Medium: 2,
  PlayfairDisplay_600SemiBold: 3,
}));
jest.mock('@expo-google-fonts/inter', () => ({
  Inter_300Light: 1,
  Inter_400Regular: 2,
  Inter_500Medium: 3,
  Inter_600SemiBold: 4,
}));

jest.mock('@/db/client', () => ({ getDb: jest.fn(() => ({ fake: 'db' })) }));
jest.mock('@/db/migrations', () => ({ runMigrations: jest.fn() }));
jest.mock('@/notifications/scheduler', () => ({ setupAndroidChannel: jest.fn() }));
jest.mock('@/notifications/idleReminder', () => ({ setupIdleReminderCategory: jest.fn() }));
const mockUnsubscribe = jest.fn();
jest.mock('@/notifications/maintenanceBootstrap', () => ({
  initMaintenanceNotifications: jest.fn(),
  attachMaintenanceAppStateSync: jest.fn(() => mockUnsubscribe),
}));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('@/contexts/RideSessionContext', () => ({ RideSessionProvider: ({ children }: any) => <>{children}</> }));
const mockRecheck = jest.fn();
jest.mock('@/hooks/useTrackingMode', () => ({ useTrackingMode: () => ({ recheckOnLaunch: mockRecheck }) }));
const mockTutorial = { shown: false };
jest.mock('@/services/trackingPreferences', () => ({ isTutorialShown: () => mockTutorial.shown }));
jest.mock('@/components/AnimatedSplash', () => {
  const { Pressable } = require('react-native');
  return { AnimatedSplash: ({ onFinish }: any) => <Pressable testID="splash" onPress={onFinish} /> };
});
jest.mock('@/components/TutorialModal', () => {
  const { Text } = require('react-native');
  return { TutorialModal: ({ visible }: any) => <Text testID="tutorial">{visible ? 'tutorial-open' : 'tutorial-closed'}</Text> };
});

import * as SplashScreen from 'expo-splash-screen';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrations';
import { setupIdleReminderCategory } from '@/notifications/idleReminder';
import { attachMaintenanceAppStateSync, initMaintenanceNotifications } from '@/notifications/maintenanceBootstrap';
import { handleLastMaintenanceResponse } from '@/notifications/maintenanceResponseHandler';
import { setupAndroidChannel } from '@/notifications/scheduler';
import RootLayout from '../../app/_layout';

// captured once at import, before any beforeEach clears the mocks
const loadOrder: string[] = [...(globalThis as any).__loadOrder];
const preventAutoHideCalls = (SplashScreen.preventAutoHideAsync as jest.Mock).mock.calls.length;

const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];

async function renderRoot() {
  render(<RootLayout />);
  await act(async () => {}); // let the async start-up finish
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStackScreens.length = 0;
  mockFonts.loaded = true;
  mockNav.key = 'root';
  mockTutorial.shown = false;
  mockRecheck.mockResolvedValue({ changed: false });
  (runMigrations as jest.Mock).mockResolvedValue(undefined);
  (setupAndroidChannel as jest.Mock).mockResolvedValue(undefined);
  (setupIdleReminderCategory as jest.Mock).mockResolvedValue(undefined);
  (initMaintenanceNotifications as jest.Mock).mockResolvedValue(undefined);
  (attachMaintenanceAppStateSync as jest.Mock).mockReturnValue(mockUnsubscribe);
});
afterEach(() => jest.restoreAllMocks());

describe('loading order', () => {
  it('registers the background task and notification listeners before the app renders', () => {
    const early = loadOrder.slice(0, 4).sort();
    expect(early).toEqual(['backgroundLocationTask', 'idleResponseHandler', 'maintenanceBackgroundTask', 'maintenanceResponseHandler']);
    expect(loadOrder.indexOf('expo-router')).toBeGreaterThan(3);
  });

  it('holds the native splash screen from the very start', () => {
    expect(preventAutoHideCalls).toBe(1);
  });
});

describe('fonts', () => {
  it('renders nothing — and keeps the native splash up — until the fonts are ready', async () => {
    mockFonts.loaded = false;
    await renderRoot();
    expect(screen.queryByTestId('splash')).toBeNull();
    expect((SplashScreen.hideAsync as jest.Mock)).not.toHaveBeenCalled();
  });

  it('once ready, hides the native splash and shows the app', async () => {
    await renderRoot();
    expect((SplashScreen.hideAsync as jest.Mock)).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('splash')).toBeTruthy();
  });
});

describe('start-up', () => {
  it('runs migrations, then sets up notification channels, then starts maintenance notifications — in that order', async () => {
    await renderRoot();
    expect(runMigrations).toHaveBeenCalledWith({ fake: 'db' });
    expect(getDb).toHaveBeenCalled();
    const steps = [runMigrations, setupAndroidChannel, setupIdleReminderCategory, initMaintenanceNotifications] as jest.Mock[];
    steps.forEach((step) => expect(step).toHaveBeenCalledTimes(1));
    for (let i = 1; i < steps.length; i++) expect(order(steps[i - 1])).toBeLessThan(order(steps[i]));
  });

  it('if a step fails, logs it, skips the rest, and still shows the app', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    (runMigrations as jest.Mock).mockRejectedValue(new Error('disk full'));
    await renderRoot();
    expect(error).toHaveBeenCalledWith('Init failed:', expect.any(Error));
    expect(setupAndroidChannel).not.toHaveBeenCalled();
    expect(initMaintenanceNotifications).not.toHaveBeenCalled();
    expect(screen.getByTestId('splash')).toBeTruthy();
  });

  it('re-checks maintenance notifications whenever the app comes back to the foreground, and stops on exit', async () => {
    render(<RootLayout />);
    expect(attachMaintenanceAppStateSync).toHaveBeenCalledTimes(1);
    screen.unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('splash and tutorial', () => {
  it('first run: when the splash finishes, shows the tutorial', async () => {
    await renderRoot();
    expect(screen.getByTestId('tutorial').props.children).toBe('tutorial-closed');
    fireEvent.press(screen.getByTestId('splash'));
    expect(screen.queryByTestId('splash')).toBeNull();
    expect(screen.getByTestId('tutorial').props.children).toBe('tutorial-open');
  });

  it('later runs: the splash just goes away', async () => {
    mockTutorial.shown = true;
    await renderRoot();
    fireEvent.press(screen.getByTestId('splash'));
    expect(screen.queryByTestId('splash')).toBeNull();
    expect(screen.getByTestId('tutorial').props.children).toBe('tutorial-closed');
  });
});

describe('launch checks', () => {
  it('re-checks auto-track permission once at launch', async () => {
    await renderRoot();
    expect(mockRecheck).toHaveBeenCalledTimes(1);
  });

  it('survives that check failing', async () => {
    mockRecheck.mockRejectedValue(new Error('boom'));
    await expect(renderRoot()).resolves.toBeUndefined();
    expect(screen.getByTestId('splash')).toBeTruthy();
  });

  it('opens the screen for a maintenance notification that launched the app — once the navigator is ready', async () => {
    mockNav.key = undefined;
    const { rerender } = render(<RootLayout />);
    await act(async () => {});
    expect(handleLastMaintenanceResponse).not.toHaveBeenCalled();

    mockNav.key = 'root';
    rerender(<RootLayout />);
    await act(async () => {});
    expect(handleLastMaintenanceResponse).toHaveBeenCalledTimes(1);
  });
});

describe('screens', () => {
  it('declares every screen, with the forms and the service log as modals', async () => {
    await renderRoot();
    const byName = Object.fromEntries(mockStackScreens.map((s) => [s.name, s.options?.presentation]));
    expect(byName).toEqual({
      '(tabs)': undefined,
      'vehicle/add': 'modal',
      'vehicle/[id]': undefined,
      'fuel/add/[vehicleId]': 'modal',
      'fuel/edit/[logId]': 'modal',
      'maintenance/log/[itemId]': 'modal',
    });
  });
});
