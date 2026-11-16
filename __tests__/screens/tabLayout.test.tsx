/**
 * The bottom tab bar: Home, Fuel, Service, Settings.
 */
import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }),
}));
jest.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ vehicles: [] }) }));
jest.mock('@/hooks/useMaintenance', () => ({ useMaintenance: () => ({ overdueCount: 0 }) }));
jest.mock('expo-router', () => {
  const { View } = require('react-native');
  const Tabs: any = ({ children, screenOptions }: any) => {
    (globalThis as any).__tabsScreenOptions = screenOptions;
    return <View>{children}</View>;
  };
  // render each tab's icon the way the real tab bar would, with Home focused
  Tabs.Screen = ({ name, options }: any) => <View testID={`tab-${name}`}>{options.tabBarIcon({ focused: name === 'index' })}</View>;
  return { Tabs };
});

import TabLayout from '../../app/(tabs)/_layout';

afterEach(() => jest.restoreAllMocks());

describe('tab bar', () => {
  it('has the four tabs, in order, with their labels', () => {
    render(<TabLayout />);
    const tabs = screen.getAllByTestId(/^tab-/).map((t) => t.props.testID);
    expect(tabs).toEqual(['tab-index', 'tab-fuel', 'tab-maintenance', 'tab-settings']);
    for (const label of ['Home', 'Fuel', 'Service', 'Settings']) expect(screen.getByText(label)).toBeTruthy();
  });

  it('draws its own labels, so the stock ones are switched off', () => {
    render(<TabLayout />);
    const options = (globalThis as any).__tabsScreenOptions;
    expect(options.tabBarShowLabel).toBe(false);
    expect(options.headerShown).toBe(false);
  });

  it('on Android the bar is 72 tall with 8 of bottom padding (no safe-area inset)', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<TabLayout />);
    const style = (globalThis as any).__tabsScreenOptions.tabBarStyle;
    expect(style.height).toBe(72);
    expect(style.paddingBottom).toBe(8);
  });

  it('on iOS the bar makes room for the home indicator', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    render(<TabLayout />);
    const style = (globalThis as any).__tabsScreenOptions.tabBarStyle;
    expect(style.height).toBe(64 + 20);
    expect(style.paddingBottom).toBe(20);
  });
});
