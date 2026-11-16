/**
 * The modals: TutorialModal, TrackingOnboardingModal, CurrencyPickerModal and DateWheelPickerModal.
 * FlashList (which needs real layout) is replaced by a plain list; everything else is the real component.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Dimensions, Linking, ScrollView } from 'react-native';

// Native animation libs can't run in Node — use their official Jest mocks.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

const mockScrollToIndex = jest.fn();
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  const FlashList = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ scrollToIndex: mockScrollToIndex }));
    const { data, renderItem, keyExtractor, ListEmptyComponent, onMomentumScrollEnd } = props;
    return (
      <View testID="list" onMomentumScrollEnd={onMomentumScrollEnd}>
        {data && data.length > 0
          ? data.map((item: any, index: number) => (
              <View key={keyExtractor ? keyExtractor(item, index) : index}>{renderItem({ item, index })}</View>
            ))
          : ListEmptyComponent}
      </View>
    );
  });
  return { FlashList };
});

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: any[]) => mockRouterPush(...a) } }));

jest.mock('@/services/trackingPreferences', () => ({
  setTutorialShown: jest.fn(),
  setOnboardingShown: jest.fn(),
}));
const mockSwitchToAuto = jest.fn();
jest.mock('@/hooks/useTrackingMode', () => ({
  useTrackingMode: () => ({ switchToAuto: mockSwitchToAuto }),
}));

import { CurrencyPickerModal } from '@/components/CurrencyPickerModal';
import { DateWheelPickerModal } from '@/components/DateWheelPicker';
import { TrackingOnboardingModal } from '@/components/TrackingOnboardingModal';
import { TutorialModal } from '@/components/TutorialModal';
import { SUPPORTED_CURRENCIES, addRecentCurrency, getRecentCurrencies } from '@/services/currencyService';
import { setOnboardingShown, setTutorialShown } from '@/services/trackingPreferences';
import { TestDb, createMigratedDb, setCurrentDb } from '../helpers/testDb';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ─── TutorialModal ────────────────────────────────────────────────────────────

describe('TutorialModal', () => {
  const W = Dimensions.get('window').width;
  const setup = () => {
    const onDone = jest.fn();
    render(<TutorialModal visible onDone={onDone} />);
    return { onDone };
  };
  const goToLastSlide = () => {
    for (let i = 0; i < 5; i++) fireEvent.press(screen.getByLabelText('Next'));
  };

  it('opens on the welcome slide with Next and Skip', () => {
    setup();
    expect(screen.getByText('Welcome to RideZen')).toBeTruthy();
    expect(screen.getByLabelText('Next')).toBeTruthy();
    expect(screen.getByLabelText('Skip tutorial')).toBeTruthy();
  });

  it('has a slide for each part of the app', () => {
    setup();
    for (const title of ['Welcome to RideZen', 'My Garage', 'Odometer Tracking', 'Maintenance', 'Fuel Log']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('Next scrolls the slides along, one at a time', () => {
    setup();
    fireEvent.press(screen.getByLabelText('Next'));
    expect(mockScrollToIndex).toHaveBeenLastCalledWith({ index: 1, animated: true });
    fireEvent.press(screen.getByLabelText('Next'));
    expect(mockScrollToIndex).toHaveBeenLastCalledWith({ index: 2, animated: true });
  });

  it('Skip remembers the tutorial was seen and closes it', () => {
    const { onDone } = setup();
    fireEvent.press(screen.getByLabelText('Skip tutorial'));
    expect(setTutorialShown).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  describe('on the last slide', () => {
    it('swaps Next / Skip for "Add my first vehicle" / "Maybe later"', () => {
      setup();
      goToLastSlide();
      expect(screen.getByLabelText('Add your first vehicle')).toBeTruthy();
      expect(screen.getByText('Maybe later')).toBeTruthy();
      expect(screen.queryByLabelText('Next')).toBeNull();
      expect(screen.queryByLabelText('Skip tutorial')).toBeNull();
    });

    it('"Add my first vehicle" closes the tutorial and opens the add-vehicle screen', () => {
      const { onDone } = setup();
      goToLastSlide();
      fireEvent.press(screen.getByLabelText('Add your first vehicle'));
      expect(setTutorialShown).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith('/vehicle/add');
    });

    it('"Maybe later" closes it without opening the add-vehicle screen', () => {
      const { onDone } = setup();
      goToLastSlide();
      fireEvent.press(screen.getByText('Maybe later'));
      expect(setTutorialShown).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });

  it('swiping to the last slide updates the buttons too', () => {
    setup();
    act(() => {
      fireEvent(screen.getByTestId('list'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: W * 5 } } });
    });
    expect(screen.getByLabelText('Add your first vehicle')).toBeTruthy();
  });

  it('swiping back to an earlier slide brings Next back', () => {
    setup();
    goToLastSlide();
    act(() => {
      fireEvent(screen.getByTestId('list'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: W * 2 } } });
    });
    expect(screen.getByLabelText('Next')).toBeTruthy();
  });

  it('ignores a scroll position outside the slides', () => {
    setup();
    act(() => {
      fireEvent(screen.getByTestId('list'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: W * 99 } } });
    });
    // still on slide 1, so Next goes to slide 2 (not to slide 100)
    fireEvent.press(screen.getByLabelText('Next'));
    expect(mockScrollToIndex).toHaveBeenLastCalledWith({ index: 1, animated: true });
  });

  it('shows nothing while hidden', () => {
    render(<TutorialModal visible={false} onDone={jest.fn()} />);
    expect(screen.queryByText('Welcome to RideZen')).toBeNull();
  });

  it('starts again from the first slide each time it is opened', () => {
    jest.useFakeTimers();
    try {
      const { rerender } = render(<TutorialModal visible onDone={jest.fn()} />);
      goToLastSlide();
      rerender(<TutorialModal visible={false} onDone={jest.fn()} />);
      rerender(<TutorialModal visible onDone={jest.fn()} />);
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(screen.getByLabelText('Next')).toBeTruthy();
      expect(mockScrollToIndex).toHaveBeenLastCalledWith({ index: 0, animated: false });
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── TrackingOnboardingModal ──────────────────────────────────────────────────

describe('TrackingOnboardingModal', () => {
  const setup = (visible = true) => {
    const onComplete = jest.fn();
    const utils = render(<TrackingOnboardingModal visible={visible} vehicleId={7} onComplete={onComplete} />);
    return { onComplete, ...utils };
  };
  const toStep2 = () => fireEvent.press(screen.getByLabelText('Continue to explanation'));
  const finish = async () => {
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Confirm and close onboarding'));
    });
  };

  it('step 1 offers Manual and Auto-track', () => {
    setup();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.getByText('Manual Ride Session')).toBeTruthy();
    expect(screen.getByText('Auto-track Always')).toBeTruthy();
  });

  it('step 2 explains what the chosen mode means, and the privacy notice', () => {
    setup();
    toStep2();
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(screen.getByText(/Start\/End Ride button on your home screen/)).toBeTruthy(); // manual is the default
    expect(screen.getByText('Privacy & Permissions')).toBeTruthy();
  });

  it('explains auto-track when that was chosen', () => {
    setup();
    fireEvent.press(screen.getByLabelText('Select auto-track always'));
    toStep2();
    expect(screen.getByText(/track your distance in the background automatically/)).toBeTruthy();
  });

  it('"Change selection" goes back to step 1', () => {
    setup();
    toStep2();
    fireEvent.press(screen.getByText('← Change selection'));
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });

  it('opens the privacy policy', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);
    setup();
    toStep2();
    fireEvent.press(screen.getByText(/Privacy Policy/));
    expect(openURL).toHaveBeenCalledWith('https://ridezen.app/privacy');
  });

  describe('finishing with Manual', () => {
    it('remembers onboarding was shown and completes — without touching permissions', async () => {
      const { onComplete } = setup();
      toStep2();
      await finish();
      expect(setOnboardingShown).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(mockSwitchToAuto).not.toHaveBeenCalled();
      expect(Alert.alert).not.toHaveBeenCalled();
    });
  });

  describe('finishing with Auto-track', () => {
    const chooseAuto = async (outcome: string) => {
      mockSwitchToAuto.mockResolvedValue(outcome);
      const utils = setup();
      fireEvent.press(screen.getByLabelText('Select auto-track always'));
      toStep2();
      await finish();
      return utils;
    };

    it('switches this vehicle to auto-track and completes', async () => {
      const { onComplete } = await chooseAuto('granted');
      expect(setOnboardingShown).toHaveBeenCalledTimes(1);
      expect(mockSwitchToAuto).toHaveBeenCalledWith(7);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('says nothing when permission was granted', async () => {
      await chooseAuto('granted');
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    it.each(['foreground_denied', 'background_only_while_using'])('%s: explains it needs "Always Allow" and that they stay on Manual', async (outcome) => {
      await chooseAuto(outcome);
      expect(Alert.alert).toHaveBeenCalledTimes(1);
      const [title, message] = (Alert.alert as jest.Mock).mock.calls[0];
      expect(title).toBe('Auto-track needs "Always Allow"');
      expect(message).toMatch(/kept on Manual/);
    });

    it.each(['foreground_never_ask', 'background_never_ask'])('%s: sends the rider to the phone settings', async (outcome) => {
      const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
      await chooseAuto(outcome);
      const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
      expect(title).toBe('Permission required');
      buttons.find((b: any) => b.text === 'Open Settings').onPress();
      expect(openSettings).toHaveBeenCalledTimes(1);
      expect(buttons.find((b: any) => b.text === 'Cancel')).toBeDefined();
    });

    it('background_denied: says it could not start and they stay on Manual', async () => {
      await chooseAuto('background_denied');
      const [title, message] = (Alert.alert as jest.Mock).mock.calls[0];
      expect(title).toBe('Could not start auto-track');
      expect(message).toMatch(/kept on Manual/);
    });

    it('completes (closes) before showing the permission message', async () => {
      const { onComplete } = await chooseAuto('background_denied');
      expect(onComplete.mock.invocationCallOrder[0]).toBeLessThan((Alert.alert as jest.Mock).mock.invocationCallOrder[0]);
    });
  });

  it('starts again at step 1 with Manual selected each time it opens', () => {
    const { rerender } = setup();
    fireEvent.press(screen.getByLabelText('Select auto-track always'));
    toStep2();
    rerender(<TrackingOnboardingModal visible={false} vehicleId={7} onComplete={jest.fn()} />);
    rerender(<TrackingOnboardingModal visible vehicleId={7} onComplete={jest.fn()} />);
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    toStep2();
    expect(screen.getByText(/Start\/End Ride button on your home screen/)).toBeTruthy(); // back to Manual
  });

  it('shows nothing while hidden', () => {
    setup(false);
    expect(screen.queryByText('Manual Ride Session')).toBeNull();
  });
});

// ─── CurrencyPickerModal ──────────────────────────────────────────────────────

describe('CurrencyPickerModal', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await createMigratedDb();
    setCurrentDb(db);
  });
  afterEach(() => setCurrentDb(null));

  const setup = (props: Partial<React.ComponentProps<typeof CurrencyPickerModal>> = {}) => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    render(<CurrencyPickerModal visible selected="SGD" onSelect={onSelect} onClose={onClose} {...props} />);
    return { onSelect, onClose };
  };
  const search = (text: string) => fireEvent.changeText(screen.getByLabelText('Search currencies'), text);

  it('shows the title and how many currencies are supported', () => {
    setup();
    expect(screen.getByText('Select Currency')).toBeTruthy();
    expect(screen.getByText(`${SUPPORTED_CURRENCIES.length} currencies supported`)).toBeTruthy();
  });

  it('lists the currencies', () => {
    setup();
    expect(screen.getByLabelText('SGD Singapore Dollar')).toBeTruthy();
    expect(screen.getByLabelText('MYR Malaysian Ringgit')).toBeTruthy();
  });

  it('shows nothing while hidden', () => {
    setup({ visible: false });
    expect(screen.queryByText('Select Currency')).toBeNull();
  });

  describe('searching', () => {
    it('matches by code', () => {
      setup();
      search('myr');
      expect(screen.getByLabelText('MYR Malaysian Ringgit')).toBeTruthy();
      expect(screen.queryByLabelText('SGD Singapore Dollar')).toBeNull();
    });

    it('matches by currency name', () => {
      setup();
      search('ringgit');
      expect(screen.getByLabelText('MYR Malaysian Ringgit')).toBeTruthy();
    });

    it('matches by country', () => {
      setup();
      search('thailand');
      expect(screen.getByLabelText('THB Thai Baht')).toBeTruthy();
    });

    it('is not fussy about case or surrounding spaces', () => {
      setup();
      search('  JpY ');
      expect(screen.getByLabelText('JPY Japanese Yen')).toBeTruthy();
    });

    it('counts the results (singular and plural)', () => {
      setup();
      search('thb');
      expect(screen.getByText('1 result')).toBeTruthy();
      search('dollar');
      expect(screen.getByText(/^\d+ results$/)).toBeTruthy();
    });

    it('says so when nothing matches', () => {
      setup();
      search('zzzz');
      expect(screen.getByText('No currencies match "zzzz"')).toBeTruthy();
    });

    it('the ✕ button clears the search', () => {
      setup();
      search('myr');
      fireEvent.press(screen.getByText('✕'));
      expect(screen.getByLabelText('SGD Singapore Dollar')).toBeTruthy();
      expect(screen.queryByText('✕')).toBeNull();
    });

    it('starts empty each time it opens', () => {
      const props = { selected: 'SGD', onSelect: jest.fn(), onClose: jest.fn() };
      const { rerender } = render(<CurrencyPickerModal visible {...props} />);
      search('myr');
      rerender(<CurrencyPickerModal visible={false} {...props} />);
      rerender(<CurrencyPickerModal visible {...props} />);
      expect(screen.getByLabelText('Search currencies').props.value).toBe('');
    });
  });

  describe('choosing', () => {
    it('reports the choice, remembers it as recent, and closes', () => {
      const { onSelect, onClose } = setup();
      fireEvent.press(screen.getByLabelText('MYR Malaysian Ringgit'));
      expect(onSelect).toHaveBeenCalledWith('MYR');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(getRecentCurrencies()).toEqual(['MYR']);
    });

    // KNOWN GAP — the rows of the full list come from useCallback(..., [selected]), so they keep the `onSelect` from an
    // old render. A parent that re-renders with new state (as the refuel form does) gets its OLD handler called.
    // The "Most Recent" rows are not affected. When fixed, change `it.failing` to `it`.
    it.failing('calls the latest onSelect after the parent re-renders', () => {
      const first = jest.fn();
      const latest = jest.fn();
      const props = { visible: true, selected: 'SGD', onClose: jest.fn() };
      const { rerender } = render(<CurrencyPickerModal {...props} onSelect={first} />);
      rerender(<CurrencyPickerModal {...props} onSelect={latest} />);
      fireEvent.press(screen.getByLabelText('MYR Malaysian Ringgit'));
      expect(latest).toHaveBeenCalledWith('MYR');
      expect(first).not.toHaveBeenCalled();
    });

    it('the back button closes without choosing', () => {
      const { onSelect, onClose } = setup();
      fireEvent.press(screen.getByLabelText('Close'));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe('most recent', () => {
    it('is hidden when nothing was chosen before', () => {
      setup();
      expect(screen.queryByText('Most Recent')).toBeNull();
      expect(screen.queryByText('All Currencies')).toBeNull();
    });

    it('lists recently chosen currencies, newest first, above the full list', () => {
      addRecentCurrency('JPY');
      addRecentCurrency('MYR');
      setup();
      expect(screen.getByText('Most Recent')).toBeTruthy();
      expect(screen.getByText('All Currencies')).toBeTruthy();
      // each recent currency appears twice: once in the recent section, once in the full list
      expect(screen.getAllByLabelText('MYR Malaysian Ringgit')).toHaveLength(2);
      const order = screen
        .getAllByLabelText(/^(MYR|JPY) /)
        .slice(0, 2)
        .map((el) => el.props.accessibilityLabel.slice(0, 3));
      expect(order).toEqual(['MYR', 'JPY']);
    });

    it('can be picked from the recent section', () => {
      addRecentCurrency('JPY');
      const { onSelect } = setup();
      fireEvent.press(screen.getAllByLabelText('JPY Japanese Yen')[0]);
      expect(onSelect).toHaveBeenCalledWith('JPY');
    });

    it('is hidden while searching', () => {
      addRecentCurrency('JPY');
      setup();
      search('yen');
      expect(screen.queryByText('Most Recent')).toBeNull();
    });
  });
});

// ─── DateWheelPickerModal ─────────────────────────────────────────────────────

describe('DateWheelPickerModal', () => {
  const YEAR = new Date().getFullYear();
  const ITEM_H = 52;
  const setup = (value: string, visible = true) => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    const utils = render(<DateWheelPickerModal visible={visible} value={value} onConfirm={onConfirm} onClose={onClose} />);
    return { onConfirm, onClose, ...utils };
  };
  /** Scroll one wheel (0 = day, 1 = month, 2 = year) so that item `index` is centred. */
  const scrollWheel = (wheel: 0 | 1 | 2, index: number) => {
    const wheels = screen.UNSAFE_getAllByType(ScrollView);
    act(() => {
      fireEvent(wheels[wheel], 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: index * ITEM_H } } });
    });
  };

  it('shows the three wheels with the current date picked', () => {
    setup(`${YEAR}-03-15`);
    expect(screen.getByText('Select Date')).toBeTruthy();
    expect(screen.getByText('March')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText(String(YEAR))).toBeTruthy();
  });

  it('offers five years back to ten years ahead', () => {
    setup(`${YEAR}-03-15`);
    expect(screen.getByText(String(YEAR - 5))).toBeTruthy();
    expect(screen.getByText(String(YEAR + 10))).toBeTruthy();
    expect(screen.queryByText(String(YEAR - 6))).toBeNull();
  });

  it('Done confirms the date as shown and closes', () => {
    const { onConfirm, onClose } = setup(`${YEAR}-03-15`);
    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith(`${YEAR}-03-15`);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes without confirming', () => {
    const { onConfirm, onClose } = setup(`${YEAR}-03-15`);
    fireEvent.press(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('tapping the dimmed background closes without confirming', () => {
    const { onConfirm, onClose } = setup(`${YEAR}-03-15`);
    // the backdrop is the first touchable in the modal, before the sheet
    fireEvent.press(screen.UNSAFE_getAllByProps({ activeOpacity: 1 })[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('scrolling a wheel changes that part of the date', () => {
    const { onConfirm } = setup(`${YEAR}-03-15`);
    scrollWheel(0, 19); // day → 20
    scrollWheel(1, 5); // month → June
    scrollWheel(2, 7); // year → YEAR + 2
    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith(`${YEAR + 2}-06-20`);
  });

  it('pulls the day back when the new month is shorter (31 Mar → 28/29 Feb)', () => {
    const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const { onConfirm } = setup(`${YEAR}-03-31`);
    scrollWheel(1, 1); // February
    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith(`${YEAR}-02-${leap(YEAR) ? 29 : 28}`);
  });

  it('knows leap years: 29 Feb is allowed in a leap year', () => {
    const leapYear = [YEAR - 5, YEAR - 4, YEAR - 3, YEAR - 2, YEAR - 1, YEAR, YEAR + 1, YEAR + 2, YEAR + 3, YEAR + 4].find(
      (y) => y % 4 === 0 && y % 100 !== 0
    )!;
    const { onConfirm } = setup(`${leapYear}-02-29`);
    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith(`${leapYear}-02-29`);
  });

  it('keeps the wheel inside its list when scrolled past the end', () => {
    const { onConfirm } = setup(`${YEAR}-03-15`);
    scrollWheel(1, 99); // way past December
    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith(`${YEAR}-12-15`);
  });

  it('falls back to today when given a date it cannot read', () => {
    const today = new Date();
    const { onConfirm } = setup('not-a-date');
    fireEvent.press(screen.getByText('Done'));
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(onConfirm).toHaveBeenCalledWith(iso);
  });

  it('shows the new value each time it is reopened', () => {
    const onConfirm = jest.fn();
    const props = { onConfirm, onClose: jest.fn() };
    const { rerender } = render(<DateWheelPickerModal visible value={`${YEAR}-03-15`} {...props} />);
    scrollWheel(1, 8); // user wanders off to September...
    rerender(<DateWheelPickerModal visible={false} value={`${YEAR}-07-04`} {...props} />);
    rerender(<DateWheelPickerModal visible value={`${YEAR}-07-04`} {...props} />);
    fireEvent.press(screen.getByText('Done'));
    expect(onConfirm).toHaveBeenCalledWith(`${YEAR}-07-04`); // ...but reopening resets to the value passed in
  });

  it('shows nothing while hidden', () => {
    setup(`${YEAR}-03-15`, false);
    expect(screen.queryByText('Select Date')).toBeNull();
  });
});
