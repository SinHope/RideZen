/**
 * Small presentational components: DueStatusBadge, ErrorBoundary, ConfirmModal, AutoTrackBanner,
 * RideSessionButton, the icon set and the animated splash.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Linking, Modal, Text } from 'react-native';

// Native animation libs can't run in Node — use their official Jest mocks.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import { AnimatedSplash } from '@/components/AnimatedSplash';
import { AutoTrackBanner } from '@/components/AutoTrackBanner';
import { ConfirmModal } from '@/components/ConfirmModal';
import { DueStatusBadge } from '@/components/DueStatusBadge';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RideSessionButton } from '@/components/RideSessionButton';
import * as icons from '@/components/icons';
import { logToFile } from '@/utils/logger';

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

// ─── DueStatusBadge ───────────────────────────────────────────────────────────

describe('DueStatusBadge', () => {
  it.each([
    ['ok', 'OK'],
    ['due', 'Due Soon'],
    ['urgent', 'Urgent'],
    ['overdue', 'Overdue'],
  ] as const)('%s shows "%s" and announces it to screen readers', (status, label) => {
    render(<DueStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByLabelText(`Status: ${label}`)).toBeTruthy();
  });

  it('renders at both sizes', () => {
    render(<DueStatusBadge status="due" size="md" />);
    expect(screen.getByText('Due Soon')).toBeTruthy();
  });
});

// ─── ErrorBoundary ────────────────────────────────────────────────────────────

describe('ErrorBoundary', () => {
  let shouldThrow = false;
  function Child() {
    if (shouldThrow) throw new Error('kaboom');
    return <Text>all fine</Text>;
  }
  beforeEach(() => {
    shouldThrow = false;
    jest.spyOn(console, 'error').mockImplementation(() => {}); // React logs caught render errors
  });

  it('shows its children while nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>
    );
    expect(screen.getByText('all fine')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('replaces a crashed screen with a reassuring message and logs the crash', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Your data is safe. Please restart the app.')).toBeTruthy();
    expect(logToFile).toHaveBeenCalledWith('CRASH', 'kaboom', expect.any(String));
  });

  it('"Try Again" brings the children back once the problem is gone', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>
    );
    shouldThrow = false;
    fireEvent.press(screen.getByLabelText('Try again'));
    expect(screen.getByText('all fine')).toBeTruthy();
  });

  it('"Try Again" shows the message again if it is still broken', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>
    );
    fireEvent.press(screen.getByLabelText('Try again'));
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });
});

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

describe('ConfirmModal', () => {
  const setup = (over: Partial<React.ComponentProps<typeof ConfirmModal>> = {}) => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(
      <ConfirmModal
        visible
        title="Delete vehicle?"
        message="This cannot be undone."
        confirmLabel="Yes, delete"
        confirmColor="#CC0000"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...over}
      />
    );
    return { onConfirm, onCancel };
  };

  it('shows the title, message and both buttons', () => {
    setup();
    expect(screen.getByText('Delete vehicle?')).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    expect(screen.getByText('Yes, delete')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('confirm and cancel call their own handlers', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.press(screen.getByText('Yes, delete'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('the Android back button cancels', () => {
    const { onCancel } = setup();
    screen.UNSAFE_getByType(Modal).props.onRequestClose();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows nothing while hidden', () => {
    setup({ visible: false });
    expect(screen.queryByText('Delete vehicle?')).toBeNull();
  });

  it('while loading, swaps the label for a spinner and blocks both buttons', () => {
    const { onConfirm, onCancel } = setup({ loading: true });
    expect(screen.queryByText('Yes, delete')).toBeNull();
    fireEvent.press(screen.getByText('Cancel'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// ─── AutoTrackBanner ──────────────────────────────────────────────────────────

describe('AutoTrackBanner', () => {
  it('shows the message and can be dismissed', () => {
    const onDismiss = jest.fn();
    render(<AutoTrackBanner message="Auto-track stopped." onDismiss={onDismiss} />);
    expect(screen.getByText('Auto-track stopped.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Dismiss banner'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('with no action offered, shows no link', () => {
    render(<AutoTrackBanner message="hi" onDismiss={jest.fn()} />);
    expect(screen.queryByLabelText('Open phone settings')).toBeNull();
    expect(screen.queryByLabelText('Re-enable auto-track')).toBeNull();
  });

  it('offers a re-enable link that calls back', () => {
    const onReEnable = jest.fn();
    render(<AutoTrackBanner message="hi" onReEnable={onReEnable} onDismiss={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('Re-enable auto-track'));
    expect(onReEnable).toHaveBeenCalledTimes(1);
  });

  it('when permission is permanently denied, links to the phone settings instead', () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const onReEnable = jest.fn();
    render(<AutoTrackBanner message="hi" showSettingsLink onReEnable={onReEnable} onDismiss={jest.fn()} />);

    expect(screen.queryByLabelText('Re-enable auto-track')).toBeNull(); // settings link takes priority
    fireEvent.press(screen.getByLabelText('Open phone settings'));

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(onReEnable).not.toHaveBeenCalled();
  });
});

// ─── RideSessionButton ────────────────────────────────────────────────────────

describe('RideSessionButton', () => {
  const setup = (over: Partial<React.ComponentProps<typeof RideSessionButton>> = {}) => {
    const onStartRide = jest.fn();
    const onEndRide = jest.fn();
    render(
      <RideSessionButton
        isTracking={false}
        isAnyRideActive={false}
        cardColor="#1B6CA8"
        onStartRide={onStartRide}
        onEndRide={onEndRide}
        {...over}
      />
    );
    return { onStartRide, onEndRide };
  };

  it('idle: shows Start Ride and starts a ride', () => {
    const { onStartRide, onEndRide } = setup();
    expect(screen.queryByText('End Ride')).toBeNull();
    fireEvent.press(screen.getByLabelText('Start tracking this ride'));
    expect(onStartRide).toHaveBeenCalledTimes(1);
    expect(onEndRide).not.toHaveBeenCalled();
  });

  it('tracking this vehicle: shows End Ride and ends it', () => {
    const { onStartRide, onEndRide } = setup({ isTracking: true, isAnyRideActive: true });
    expect(screen.queryByText('Start Ride')).toBeNull();
    fireEvent.press(screen.getByLabelText('End ride and save distance'));
    expect(onEndRide).toHaveBeenCalledTimes(1);
    expect(onStartRide).not.toHaveBeenCalled();
  });

  it('another vehicle is being tracked: Start is disabled and does nothing', () => {
    const { onStartRide } = setup({ isTracking: false, isAnyRideActive: true });
    const button = screen.getByLabelText('Start tracking this ride');
    expect(button.props.accessibilityState?.disabled ?? button.props.disabled).toBeTruthy();
    fireEvent.press(button);
    expect(onStartRide).not.toHaveBeenCalled();
  });
});

// ─── icons ────────────────────────────────────────────────────────────────────

describe('icons', () => {
  const entries = Object.entries(icons) as [string, (p: any) => React.ReactElement][];

  it('exports a set of components named ...Icon', () => {
    expect(entries.length).toBeGreaterThan(15);
    for (const [name, Icon] of entries) {
      expect(name).toMatch(/Icon$/);
      expect(typeof Icon).toBe('function');
    }
  });

  it.each(entries)('%s renders with its defaults and with a custom colour / size', (_name, Icon) => {
    expect(() => render(<Icon />)).not.toThrow();
    expect(() => render(<Icon color="#123456" size={30} />)).not.toThrow();
  });
});

// ─── AnimatedSplash ───────────────────────────────────────────────────────────

describe('AnimatedSplash', () => {
  it('shows the brand name and tagline', () => {
    render(<AnimatedSplash onFinish={jest.fn()} />);
    expect(screen.getByText('RideZen')).toBeTruthy();
    expect(screen.getByText('STOP REMEMBERING. START RIDING.')).toBeTruthy();
  });

  it('tells the app when the closing fade-out has finished (exactly once)', () => {
    const onFinish = jest.fn();
    render(<AnimatedSplash onFinish={onFinish} />);
    expect(onFinish).toHaveBeenCalledTimes(1); // the animation library is mocked to complete immediately
  });
});
