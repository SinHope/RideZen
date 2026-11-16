/**
 * Add Vehicle screen — two steps (type, then details), validation, the "have you confirmed?" prompt and what
 * happens after saving (home screen + the one-shot onboarding prompts).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => require('../helpers/routerMock').expoRouterMock());
jest.mock('@/repositories/vehicleRepo', () => ({ vehicleRepo: { create: jest.fn() } }));

import { vehicleRepo } from '@/repositories/vehicleRepo';
import { consumeMaintenancePromptPending, consumeTrackingOnboardingPending } from '@/utils/flags';
import AddVehicleScreen from '../../app/vehicle/add';
import { routerMocks, resetRouterMocks } from '../helpers/routerMock';

const mCreate = vehicleRepo.create as jest.Mock;

const chooseType = (label: string) => fireEvent.press(screen.getByLabelText(label));
const next = () => fireEvent.press(screen.getByLabelText('Continue to vehicle details'));
const type = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);
const pressSave = () => fireEvent.press(screen.getByLabelText('Save vehicle'));
const confirm = async () => {
  await act(async () => {
    fireEvent.press(screen.getByText('Yes, save'));
  });
};

/** Get to step 2 with a type chosen. */
function toDetails(label = 'Scooter / CVT') {
  render(<AddVehicleScreen />);
  chooseType(label);
  next();
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRouterMocks();
  mCreate.mockResolvedValue({ data: 5, error: null });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  consumeMaintenancePromptPending();
  consumeTrackingOnboardingPending();
  jest.restoreAllMocks();
});

describe('step 1: vehicle type', () => {
  it('offers the four types with examples', () => {
    render(<AddVehicleScreen />);
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    for (const label of ['Scooter / CVT', 'Manual Motorcycle', 'Car', 'Other']) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByText('Yamaha NVX, Honda PCX, etc.')).toBeTruthy();
  });

  it('explains why the type matters', () => {
    render(<AddVehicleScreen />);
    expect(screen.getByText('This determines which maintenance items are tracked.')).toBeTruthy();
  });

  it('cannot continue until a type is chosen', () => {
    render(<AddVehicleScreen />);
    next();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });

  it('continues to the details once a type is chosen', () => {
    toDetails();
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(screen.getByText('Vehicle details')).toBeTruthy();
  });

  it('has no Save button yet', () => {
    render(<AddVehicleScreen />);
    expect(screen.queryByLabelText('Save vehicle')).toBeNull();
  });

  it('the back arrow leaves the screen', () => {
    render(<AddVehicleScreen />);
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(routerMocks.back).toHaveBeenCalledTimes(1);
  });
});

describe('step 2: details', () => {
  it('the back arrow returns to step 1 instead of leaving', () => {
    toDetails();
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(routerMocks.back).not.toHaveBeenCalled();
  });

  it('keeps the chosen type when going back and forth', () => {
    toDetails('Car');
    fireEvent.press(screen.getByLabelText('Go back'));
    next(); // no need to choose again
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
  });

  it('shows the Save button and the fields', () => {
    toDetails();
    expect(screen.getByLabelText('Save vehicle')).toBeTruthy();
    for (const label of ['Vehicle name *', 'Current odometer *', 'Make', 'Model', 'Year', 'Plate number']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('suggests examples that fit the type', () => {
    toDetails('Car');
    expect(screen.getByPlaceholderText('My Personal Car')).toBeTruthy();
    expect(screen.getByPlaceholderText('e.g. Hyundai')).toBeTruthy();
  });

  it('only "Other" asks for a description', () => {
    toDetails('Scooter / CVT');
    expect(screen.queryByLabelText('Description')).toBeNull();
    fireEvent.press(screen.getByLabelText('Go back'));
    chooseType('Other');
    next();
    expect(screen.getByLabelText('Description')).toBeTruthy();
  });
});

describe('validation', () => {
  it('needs a vehicle name', () => {
    toDetails();
    type('Current odometer *', '1000');
    pressSave();
    expect(Alert.alert).toHaveBeenCalledWith('Required', 'Please enter a vehicle name.');
    expect(screen.queryByText('Have you confirmed all details?')).toBeNull();
  });

  it('a name of only spaces does not count', () => {
    toDetails();
    type('Vehicle name *', '   ');
    type('Current odometer *', '1000');
    pressSave();
    expect(Alert.alert).toHaveBeenCalledWith('Required', 'Please enter a vehicle name.');
  });

  it.each([
    ['empty', ''],
    ['not a number', 'abc'],
    ['negative', '-5'],
  ])('rejects an odometer that is %s', (_label, value) => {
    toDetails();
    type('Vehicle name *', 'Beat');
    type('Current odometer *', value);
    pressSave();
    expect(Alert.alert).toHaveBeenCalledWith('Invalid', 'Odometer must be a positive number.');
  });

  it('accepts 0 km for a brand-new vehicle', () => {
    toDetails();
    type('Vehicle name *', 'Beat');
    type('Current odometer *', '0');
    pressSave();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(screen.getByText('Have you confirmed all details?')).toBeTruthy();
  });

  it('asks the rider to double-check before saving, and nothing is saved yet', () => {
    toDetails();
    type('Vehicle name *', 'Beat');
    type('Current odometer *', '1000');
    pressSave();
    expect(screen.getByText('Have you confirmed all details?')).toBeTruthy();
    expect(mCreate).not.toHaveBeenCalled();
  });

  it('Cancel on the prompt goes back to editing without saving', () => {
    toDetails();
    type('Vehicle name *', 'Beat');
    type('Current odometer *', '1000');
    pressSave();
    fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByText('Have you confirmed all details?')).toBeNull();
    expect(mCreate).not.toHaveBeenCalled();
  });
});

describe('saving', () => {
  const fillAndConfirm = async (extra: () => void = () => {}) => {
    type('Vehicle name *', '  Beat  ');
    type('Current odometer *', '1234.5');
    extra();
    pressSave();
    await confirm();
  };

  it('creates the vehicle with the details tidied up', async () => {
    toDetails('Scooter / CVT');
    await fillAndConfirm(() => {
      type('Make', ' Honda ');
      type('Model', ' Beat ');
      type('Year', '2020');
      type('Plate number', ' FBR1234C ');
    });
    expect(mCreate).toHaveBeenCalledWith({
      nickname: 'Beat',
      type: 'scooter',
      make: 'Honda',
      model: 'Beat',
      year: 2020,
      plate_number: 'FBR1234C',
      current_odometer: 1234.5,
    });
  });

  it('leaves blank optional fields out', async () => {
    toDetails('Car');
    await fillAndConfirm();
    expect(mCreate).toHaveBeenCalledWith({
      nickname: 'Beat',
      type: 'car',
      make: undefined,
      model: undefined,
      year: undefined,
      plate_number: undefined,
      current_odometer: 1234.5,
    });
  });

  it('for "Other", the description is saved as the model', async () => {
    render(<AddVehicleScreen />);
    chooseType('Other');
    next();
    await fillAndConfirm(() => type('Description', 'Electric cargo trike'));
    expect(mCreate.mock.calls[0][0]).toMatchObject({ type: 'other', model: 'Electric cargo trike' });
  });

  it('on success goes to the home screen and queues the one-time prompts for it', async () => {
    toDetails();
    await fillAndConfirm();
    expect(routerMocks.replace).toHaveBeenCalledWith('/(tabs)');
    expect(consumeTrackingOnboardingPending()).toBe(true);
    expect(consumeMaintenancePromptPending()).toBe(true);
    expect(screen.queryByText('Have you confirmed all details?')).toBeNull();
  });

  it('shows "Saving…" and blocks the buttons while it is working', async () => {
    let finish: (v: any) => void = () => {};
    mCreate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    toDetails();
    type('Vehicle name *', 'Beat');
    type('Current odometer *', '1000');
    pressSave();
    await act(async () => {
      fireEvent.press(screen.getByText('Yes, save'));
    });

    expect(screen.getAllByText('Saving…').length).toBeGreaterThan(0);
    expect(screen.queryByText('Yes, save')).toBeNull(); // replaced by a spinner

    await act(async () => finish({ data: 5, error: null }));
    expect(routerMocks.replace).toHaveBeenCalledTimes(1);
  });

  describe('when saving fails', () => {
    beforeEach(() => {
      mCreate.mockResolvedValue({ data: null, error: 'Could not save vehicle. Please try again.' });
    });

    it('explains and stays on the screen', async () => {
      toDetails();
      await fillAndConfirm();
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Could not save vehicle. Please try again.');
      expect(routerMocks.replace).not.toHaveBeenCalled();
      expect(screen.queryByText('Have you confirmed all details?')).toBeNull();
    });

    it('does not queue the onboarding prompts', async () => {
      toDetails();
      await fillAndConfirm();
      expect(consumeTrackingOnboardingPending()).toBe(false);
      expect(consumeMaintenancePromptPending()).toBe(false);
    });

    it('lets the rider try again', async () => {
      toDetails();
      await fillAndConfirm();
      mCreate.mockResolvedValue({ data: 6, error: null });
      pressSave();
      await confirm();
      expect(routerMocks.replace).toHaveBeenCalledWith('/(tabs)');
    });
  });
});
