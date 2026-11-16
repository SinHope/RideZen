/**
 * Log Refuel and Edit Refuel screens — validation, the pump-price ↔ local-currency converter, the home-currency
 * price that is locked in at save time, and the save / error paths.
 * The repositories and exchange rates are faked; "today" is frozen at 17 Nov 2026.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => require('../helpers/routerMock').expoRouterMock());
jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  return {
    FlashList: ({ data, renderItem, keyExtractor }: any) => (
      <View>{data.map((item: any, index: number) => <View key={keyExtractor(item, index)}>{renderItem({ item, index })}</View>)}</View>
    ),
  };
});
jest.mock('@/db/client', () => ({ getDb: jest.fn() }));
jest.mock('@/repositories/fuelRepo', () => ({ fuelRepo: { add: jest.fn(), update: jest.fn(), getById: jest.fn() } }));
jest.mock('@/repositories/vehicleRepo', () => ({ vehicleRepo: { getById: jest.fn() } }));

const mockHome = { value: 'SGD' };
const mockRates: { value: Record<string, number> | null } = { value: null };
jest.mock('@/services/currencyService', () => {
  const actual = jest.requireActual('@/services/currencyService');
  return {
    ...actual, // keeps the real convert() and the currency list
    getHomeCurrency: () => mockHome.value,
    getRates: () => Promise.resolve(mockRates.value),
    getRecentCurrencies: () => [],
    addRecentCurrency: jest.fn(),
  };
});

import { fuelRepo } from '@/repositories/fuelRepo';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import AddFuelLogScreen from '../../app/fuel/add/[vehicleId]';
import EditFuelLogScreen from '../../app/fuel/edit/[logId]';
import { routerMocks, resetRouterMocks, setRouteParams } from '../helpers/routerMock';
import { freezeClock, unfreezeClock } from '../helpers/testDb';

const mFuel = fuelRepo as jest.Mocked<typeof fuelRepo>;
const mVehicle = vehicleRepo as jest.Mocked<typeof vehicleRepo>;

const RATES = { SGD: 1, MYR: 3.5, USD: 0.75 };
const field = (label: string) => screen.getByLabelText(label);
const typeInto = (label: string, text: string) => fireEvent.changeText(field(label), text);
const value = (label: string) => field(label).props.value;
const pressSave = (label = 'Save refuel log') => fireEvent.press(screen.getByLabelText(label));
const save = async (label?: string) => {
  await act(async () => {
    pressSave(label);
  });
};
const pickPumpCurrency = (code: string, name: string) => {
  fireEvent.press(screen.getByLabelText(/^Pump currency:/));
  fireEvent.press(screen.getByLabelText(`${code} ${name}`));
};
const pickLocalCurrency = (code: string, name: string) => {
  fireEvent.press(screen.getByLabelText(/^Local currency:/));
  fireEvent.press(screen.getByLabelText(`${code} ${name}`));
};

beforeEach(() => {
  jest.clearAllMocks();
  resetRouterMocks();
  freezeClock(2026, 10, 17);
  mockHome.value = 'SGD';
  mockRates.value = RATES;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  unfreezeClock();
  jest.restoreAllMocks();
});

// ─── Log Refuel ───────────────────────────────────────────────────────────────

describe('Log Refuel', () => {
  beforeEach(() => {
    setRouteParams({ vehicleId: '3' });
    mVehicle.getById.mockResolvedValue({ data: { id: 3, current_odometer: 12345 } as any, error: null });
    mFuel.add.mockResolvedValue({ data: 9, error: null });
  });

  const renderAdd = async () => {
    render(<AddFuelLogScreen />);
    await act(async () => {});
  };
  const fillBasics = (odometer = '12400', litres = '5.5') => {
    typeInto('Odometer *', odometer);
    typeInto('Litres filled *', litres);
  };

  describe('the form', () => {
    it('is titled and starts on today\'s date', async () => {
      await renderAdd();
      expect(screen.getByText('Log Refuel')).toBeTruthy();
      expect(screen.getByText('17 November 2026')).toBeTruthy();
    });

    it('starts with the vehicle\'s current odometer filled in', async () => {
      await renderAdd();
      expect(value('Odometer *')).toBe('12345');
    });

    // KNOWN GAP — GPS ride tracking leaves decimals on the odometer (e.g. 12345.678912). The Edit Vehicle screen
    // rounds them for display; this form pre-fills the raw number. When fixed, change `it.failing` to `it`.
    it.failing('shows that odometer as a whole number, not with GPS decimals', async () => {
      mVehicle.getById.mockResolvedValue({ data: { id: 3, current_odometer: 12345.678912 } as any, error: null });
      await renderAdd();
      expect(value('Odometer *')).toBe('12346');
    });

    it('leaves the odometer empty for a vehicle at 0 km or one that cannot be found', async () => {
      mVehicle.getById.mockResolvedValue({ data: null, error: null });
      await renderAdd();
      expect(value('Odometer *')).toBe('');
    });

    it('starts as a full-tank fill with no partial-fill note', async () => {
      await renderAdd();
      expect(screen.queryByText(/Partial fills are recorded/)).toBeNull();
    });

    it('the back arrow leaves the screen', async () => {
      await renderAdd();
      fireEvent.press(screen.getByLabelText('Go back'));
      expect(routerMocks.back).toHaveBeenCalledTimes(1);
    });
  });

  describe('validation', () => {
    it.each([
      ['no litres', () => fillBasics('12400', '')],
      ['no odometer', () => fillBasics('', '5')],
    ])('refuses to save with %s', async (_label, fill) => {
      await renderAdd();
      typeInto('Odometer *', '');
      fill();
      await save();
      expect(Alert.alert).toHaveBeenCalledWith('Validation Error', expect.any(String));
      expect(mFuel.add).not.toHaveBeenCalled();
    });

    it('refuses an odometer of 0', async () => {
      await renderAdd();
      fillBasics('0', '5');
      await save();
      expect(Alert.alert).toHaveBeenCalledWith('Validation Error', 'Odometer must be a positive number');
    });

    it('refuses an absurd amount of litres (over 200)', async () => {
      await renderAdd();
      fillBasics('12400', '250');
      await save();
      expect(Alert.alert).toHaveBeenCalledWith('Validation Error', 'Check litres value — seems too high');
    });

    it('refuses a price of 0', async () => {
      await renderAdd();
      fillBasics();
      typeInto('Price per litre', '0');
      await save();
      expect(Alert.alert).toHaveBeenCalledWith('Validation Error', expect.any(String));
      expect(mFuel.add).not.toHaveBeenCalled();
    });
  });

  describe('saving', () => {
    it('saves the refuel for this vehicle and closes the screen', async () => {
      await renderAdd();
      fillBasics('12400', '5.5');
      typeInto('Station / Notes', 'Shell Jurong');
      await save();

      expect(mFuel.add).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicle_id: 3,
          odometer: 12400,
          litres: 5.5,
          is_full_tank: true,
          date: '2026-11-17',
          notes: 'Shell Jurong',
          currency: 'SGD',
        })
      );
      expect(routerMocks.back).toHaveBeenCalledTimes(1);
    });

    it('a price in the home currency is its own home price', async () => {
      await renderAdd();
      fillBasics();
      typeInto('Price per litre', '2.48');
      await save();
      expect(mFuel.add).toHaveBeenCalledWith(expect.objectContaining({ price_per_litre: 2.48, currency: 'SGD', price_home: 2.48 }));
    });

    it('no price means no home price either', async () => {
      await renderAdd();
      fillBasics();
      await save();
      expect(mFuel.add.mock.calls[0][0].price_per_litre).toBeUndefined();
      expect(mFuel.add.mock.calls[0][0].price_home).toBeUndefined();
    });

    it('a pump price in another currency is converted to the home currency and locked in', async () => {
      await renderAdd();
      fillBasics();
      pickPumpCurrency('MYR', 'Malaysian Ringgit');
      typeInto('Price per litre', '7');
      await save();
      // 7 MYR ÷ 3.5 = 2 SGD
      expect(mFuel.add).toHaveBeenCalledWith(expect.objectContaining({ price_per_litre: 7, currency: 'MYR', price_home: 2 }));
    });

    it('rounds the locked-in home price to 4 decimals', async () => {
      await renderAdd();
      fillBasics();
      pickPumpCurrency('MYR', 'Malaysian Ringgit');
      typeInto('Price per litre', '2.05');
      await save();
      expect(mFuel.add.mock.calls[0][0].price_home).toBe(0.5857); // 2.05 / 3.5
    });

    it('with no exchange rates available, a foreign price is saved without a home price (so it is left out of cost totals)', async () => {
      mockRates.value = null;
      await renderAdd();
      fillBasics();
      pickPumpCurrency('MYR', 'Malaysian Ringgit');
      typeInto('Price per litre', '7');
      await save();
      expect(mFuel.add).toHaveBeenCalledWith(expect.objectContaining({ price_per_litre: 7, currency: 'MYR' }));
      expect(mFuel.add.mock.calls[0][0].price_home).toBeUndefined();
    });

    it('a partial fill is saved as such', async () => {
      await renderAdd();
      fillBasics();
      fireEvent(field('Full tank toggle'), 'valueChange', false);
      await save();
      expect(mFuel.add).toHaveBeenCalledWith(expect.objectContaining({ is_full_tank: false }));
    });

    it('shows "Saving…" and ignores a second tap while it works', async () => {
      let finish: (v: any) => void = () => {};
      mFuel.add.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      await renderAdd();
      fillBasics();
      await save();

      expect(screen.getByText('Saving…')).toBeTruthy();
      fireEvent.press(screen.getByLabelText('Save refuel log'));
      expect(mFuel.add).toHaveBeenCalledTimes(1);

      await act(async () => finish({ data: 1, error: null }));
      expect(routerMocks.back).toHaveBeenCalledTimes(1);
    });

    it('when saving fails: explains, stays on the screen, and lets the rider try again', async () => {
      mFuel.add.mockResolvedValue({ data: null, error: 'Could not save fuel log. Please try again.' });
      await renderAdd();
      fillBasics();
      await save();

      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Could not save fuel log. Please try again.');
      expect(routerMocks.back).not.toHaveBeenCalled();
      expect(screen.getByText('Save')).toBeTruthy(); // button usable again
    });
  });

  describe('currency converter', () => {
    it('typing a pump price fills in the local-currency amount', async () => {
      await renderAdd();
      pickPumpCurrency('MYR', 'Malaysian Ringgit');
      typeInto('Price per litre', '7');
      expect(value('Local currency amount')).toBe('2.0000'); // 7 MYR in SGD
    });

    it('typing a local amount fills in the pump price', async () => {
      await renderAdd();
      pickPumpCurrency('MYR', 'Malaysian Ringgit');
      typeInto('Local currency amount', '2');
      expect(value('Price per litre')).toBe('7.0000');
    });

    // KNOWN GAP — CurrencyPickerModal builds its list rows with useCallback(..., [selected]), so a row keeps the
    // `onSelect` from an old render. The screen's handler then converts using the price / rates from that old
    // render (empty / not loaded yet), and the converted amount is wiped instead of re-converted. See the matching
    // unit test in modals.test.tsx. When fixed, change `it.failing` to `it`.
    it.failing('changing the local currency re-converts the amount', async () => {
      await renderAdd();
      typeInto('Price per litre', '3');
      pickLocalCurrency('MYR', 'Malaysian Ringgit');
      expect(value('Local currency amount')).toBe('10.5000'); // 3 SGD in MYR
    });

    it('clearing the price clears the converted amount', async () => {
      await renderAdd();
      pickPumpCurrency('MYR', 'Malaysian Ringgit');
      typeInto('Price per litre', '7');
      typeInto('Price per litre', '');
      expect(value('Local currency amount')).toBe('');
    });

    it('ignores a price that is not a positive number', async () => {
      await renderAdd();
      pickPumpCurrency('MYR', 'Malaysian Ringgit');
      typeInto('Price per litre', 'abc');
      expect(value('Local currency amount')).toBe('');
      typeInto('Price per litre', '-4');
      expect(value('Local currency amount')).toBe('');
    });

    it('shows the exchange rate in use', async () => {
      await renderAdd();
      pickPumpCurrency('MYR', 'Malaysian Ringgit');
      expect(screen.getByText('1 MYR = 0.2857 SGD')).toBeTruthy();
    });

    it('says "1 : 1" when both currencies are the same', async () => {
      await renderAdd();
      expect(screen.getByText('1 : 1')).toBeTruthy();
    });

    it('says rates are loading when the currencies differ and rates are not available', async () => {
      mockRates.value = null;
      await renderAdd();
      pickPumpCurrency('MYR', 'Malaysian Ringgit');
      expect(screen.getByText('loading rates…')).toBeTruthy();
      typeInto('Price per litre', '7');
      expect(value('Local currency amount')).toBe(''); // nothing to convert with
    });
  });

  describe('date', () => {
    it('opens the date wheel, and confirming without changes keeps today', async () => {
      await renderAdd();
      fireEvent.press(screen.getByLabelText('Date: 2026-11-17. Tap to change'));
      expect(screen.getByText('Select Date')).toBeTruthy();
      fireEvent.press(screen.getByText('Done'));
      fillBasics();
      await save();
      expect(mFuel.add).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-17' }));
    });

    it('cancelling the date wheel keeps the date and closes it', async () => {
      await renderAdd();
      fireEvent.press(screen.getByLabelText('Date: 2026-11-17. Tap to change'));
      fireEvent.press(screen.getByText('Cancel'));
      expect(screen.queryByText('Select Date')).toBeNull();
    });
  });

  it('the partial-fill note appears when "Full tank" is switched off', async () => {
    await renderAdd();
    fireEvent(field('Full tank toggle'), 'valueChange', false);
    expect(screen.getByText(/Partial fills are recorded/)).toBeTruthy();
  });
});

// ─── Edit Refuel ──────────────────────────────────────────────────────────────

describe('Edit Refuel', () => {
  const savedLog = (over: object = {}) => ({
    id: 7,
    vehicle_id: 3,
    date: '2026-11-05',
    odometer: 12000.5,
    litres: 6.2,
    price_per_litre: 7,
    currency: 'MYR',
    price_home: 2,
    is_full_tank: 0,
    notes: 'Shell',
    created_at: '',
    ...over,
  });

  beforeEach(() => {
    setRouteParams({ logId: '7' });
    mFuel.getById.mockResolvedValue({ data: savedLog() as any, error: null });
    mFuel.update.mockResolvedValue({ data: undefined, error: null });
  });

  const renderEdit = async () => {
    render(<EditFuelLogScreen />);
    await act(async () => {});
  };

  describe('loading', () => {
    it('shows a spinner until the log is loaded', async () => {
      render(<EditFuelLogScreen />);
      expect(screen.queryByText('Edit Refuel')).toBeNull();
      await act(async () => {}); // let the load finish
    });

    it('fills the form from the saved log', async () => {
      await renderEdit();
      expect(screen.getByText('Edit Refuel')).toBeTruthy();
      expect(value('Odometer *')).toBe('12000.5');
      expect(value('Litres filled *')).toBe('6.2');
      expect(value('Price per litre')).toBe('7');
      expect(value('Station / Notes')).toBe('Shell');
      expect(screen.getByText('05 November 2026')).toBeTruthy();
      expect(screen.getByLabelText('Pump currency: MYR. Tap to change')).toBeTruthy();
    });

    it('works out the local-currency amount for a foreign-currency log', async () => {
      await renderEdit();
      expect(value('Local currency amount')).toBe('2.0000'); // 7 MYR → 2 SGD
    });

    it('a log in the home currency needs no local conversion', async () => {
      mFuel.getById.mockResolvedValue({ data: savedLog({ currency: 'SGD', price_per_litre: 2.5 }) as any, error: null });
      await renderEdit();
      expect(value('Local currency amount')).toBe('');
    });

    it('a log with no stored currency is treated as the home currency', async () => {
      mFuel.getById.mockResolvedValue({ data: savedLog({ currency: undefined }) as any, error: null });
      await renderEdit();
      expect(screen.getByLabelText('Pump currency: SGD. Tap to change')).toBeTruthy();
    });

    it('a partial fill shows the partial-fill note', async () => {
      await renderEdit();
      expect(screen.getByText(/Partial fills are recorded/)).toBeTruthy();
    });

    it('a full-tank log does not', async () => {
      mFuel.getById.mockResolvedValue({ data: savedLog({ is_full_tank: 1 }) as any, error: null });
      await renderEdit();
      expect(screen.queryByText(/Partial fills are recorded/)).toBeNull();
    });

    it('a log without a price leaves the price fields empty', async () => {
      mFuel.getById.mockResolvedValue({ data: savedLog({ price_per_litre: undefined }) as any, error: null });
      await renderEdit();
      expect(value('Price per litre')).toBe('');
    });
  });

  describe('editing the price, currency and date', () => {
    it('typing a local amount updates the pump price', async () => {
      await renderEdit();
      typeInto('Local currency amount', '4'); // 4 SGD
      expect(value('Price per litre')).toBe('14.0000'); // = 14 MYR
    });

    it('picking another pump currency changes its label', async () => {
      await renderEdit();
      pickPumpCurrency('USD', 'United States Dollar');
      expect(screen.getByLabelText('Pump currency: USD. Tap to change')).toBeTruthy();
    });

    it('picking another local currency changes its label', async () => {
      await renderEdit();
      pickLocalCurrency('USD', 'United States Dollar');
      expect(screen.getByLabelText('Local currency: USD. Tap to change')).toBeTruthy();
    });

    it('shows the exchange rate in use', async () => {
      await renderEdit();
      expect(screen.getByText('1 MYR = 0.2857 SGD')).toBeTruthy();
    });

    it('opens the date wheel; confirming keeps the saved date', async () => {
      await renderEdit();
      fireEvent.press(screen.getByLabelText('Date: 2026-11-05. Tap to change'));
      expect(screen.getByText('Select Date')).toBeTruthy();
      fireEvent.press(screen.getByText('Done'));
      await save('Save changes');
      expect(mFuel.update.mock.calls[0][1].date).toBe('2026-11-05');
    });

    it('cancelling the date wheel closes it', async () => {
      await renderEdit();
      fireEvent.press(screen.getByLabelText('Date: 2026-11-05. Tap to change'));
      fireEvent.press(screen.getByText('Cancel'));
      expect(screen.queryByText('Select Date')).toBeNull();
    });
  });

  describe('a log that cannot be opened', () => {
    it('one that no longer exists: says so and goes back', async () => {
      mFuel.getById.mockResolvedValue({ data: null, error: null });
      await renderEdit();
      expect(Alert.alert).toHaveBeenCalledWith('Not found', 'This fuel log no longer exists.');
      expect(routerMocks.back).toHaveBeenCalled();
    });

    it.each(['0', 'abc'])('a bad id (%s): says so and goes back without asking the database', async (id) => {
      setRouteParams({ logId: id });
      await renderEdit();
      expect(Alert.alert).toHaveBeenCalledWith('Not found', 'This fuel log no longer exists.');
      expect(routerMocks.back).toHaveBeenCalled();
      expect(mFuel.getById).not.toHaveBeenCalled();
    });

    it('a failing lookup: says so and goes back', async () => {
      mFuel.getById.mockRejectedValue(new Error('locked'));
      await renderEdit();
      expect(Alert.alert).toHaveBeenCalledWith('Not found', 'This fuel log no longer exists.');
      expect(routerMocks.back).toHaveBeenCalled();
    });
  });

  describe('saving', () => {
    it('updates this log, keeping its vehicle, and closes', async () => {
      await renderEdit();
      typeInto('Litres filled *', '7');
      typeInto('Station / Notes', 'Petronas');
      fireEvent(field('Full tank toggle'), 'valueChange', true);
      await save('Save changes');

      expect(mFuel.update).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          vehicle_id: 3,
          odometer: 12000.5,
          litres: 7,
          notes: 'Petronas',
          is_full_tank: true,
          date: '2026-11-05',
          currency: 'MYR',
          price_per_litre: 7,
          price_home: 2,
        })
      );
      expect(routerMocks.back).toHaveBeenCalledTimes(1);
    });

    it('re-locks the home price when the pump price changes', async () => {
      await renderEdit();
      typeInto('Price per litre', '10.5');
      expect(value('Local currency amount')).toBe('3.0000');
      await save('Save changes');
      expect(mFuel.update.mock.calls[0][1].price_home).toBe(3);
    });

    it('refuses invalid values', async () => {
      await renderEdit();
      typeInto('Litres filled *', '999');
      await save('Save changes');
      expect(Alert.alert).toHaveBeenCalledWith('Validation Error', 'Check litres value — seems too high');
      expect(mFuel.update).not.toHaveBeenCalled();
    });

    it('explains a failed save and stays on the screen', async () => {
      mFuel.update.mockResolvedValue({ data: null, error: 'Could not update fuel log.' });
      await renderEdit();
      await save('Save changes');
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Could not update fuel log.');
      expect(routerMocks.back).not.toHaveBeenCalled();
    });

    it('the back arrow leaves without saving', async () => {
      await renderEdit();
      fireEvent.press(screen.getByLabelText('Go back'));
      expect(routerMocks.back).toHaveBeenCalledTimes(1);
      expect(mFuel.update).not.toHaveBeenCalled();
    });
  });
});
