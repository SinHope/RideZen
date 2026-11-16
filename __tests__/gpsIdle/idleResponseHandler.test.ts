// GPS idle reminder — what the notification buttons do.
// Target module (NOT YET IMPLEMENTED): src/notifications/idleResponseHandler.ts
//
// Expected exports:
//   IDLE_RESPONSE_TASK = 'RIDEZEN_IDLE_RESPONSE'
//   handleIdleReminderResponse(response: NotificationResponse): Promise<void>
//   onManualRideStopRequested(listener: () => void): () => void   // returns unsubscribe
//
// Side effects on import (module scope, like backgroundLocationTask.ts):
//   - Notifications.addNotificationResponseReceivedListener(...)  → app alive
//   - TaskManager.defineTask(IDLE_RESPONSE_TASK, ...) +
//     Notifications.registerTaskAsync(IDLE_RESPONSE_TASK)          → Android, app killed/backgrounded
//
// Depends on (NOT YET IMPLEMENTED): src/services/autoTracking.ts → disableAutoTracking()

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  registerTaskAsync: jest.fn().mockResolvedValue(null),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('@/services/trackingPreferences', () => ({ getTrackingMode: jest.fn() }));
jest.mock('@/services/autoTracking', () => ({
  disableAutoTracking: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

let N: any;
let TM: any;
let prefs: any;
let auto: any;
let handler: any;

function makeResponse(actionIdentifier: string, opts: { type?: string; date?: number } = {}) {
  return {
    actionIdentifier,
    notification: {
      date: opts.date ?? 1_700_000_000_000,
      request: {
        identifier: 'ridezen-gps-idle',
        content: { data: { type: opts.type ?? 'gps_idle' } },
        trigger: null,
      },
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  N = require('expo-notifications');
  TM = require('expo-task-manager');
  prefs = require('@/services/trackingPreferences');
  auto = require('@/services/autoTracking');
  handler = require('@/notifications/idleResponseHandler');
});

describe('module registration', () => {
  it('listens for taps while the app is alive', () => {
    expect(N.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
  });

  it('defines and registers a background task for taps when the app is killed (Android)', () => {
    expect(TM.defineTask).toHaveBeenCalledWith('RIDEZEN_IDLE_RESPONSE', expect.any(Function));
    expect(N.registerTaskAsync).toHaveBeenCalledWith('RIDEZEN_IDLE_RESPONSE');
  });

  it('the background task forwards button taps to the same handler', async () => {
    prefs.getTrackingMode.mockReturnValue('auto');
    const [, executor] = TM.defineTask.mock.calls.find((c: any[]) => c[0] === 'RIDEZEN_IDLE_RESPONSE');
    await executor({ data: makeResponse('TURN_OFF_GPS'), error: null, executionInfo: {} });
    expect(auto.disableAutoTracking).toHaveBeenCalledTimes(1);
  });

  it('the app-alive listener forwards button taps to the same handler', async () => {
    prefs.getTrackingMode.mockReturnValue('auto');
    const listener = N.addNotificationResponseReceivedListener.mock.calls[0][0];
    await listener(makeResponse('TURN_OFF_GPS'));
    expect(auto.disableAutoTracking).toHaveBeenCalledTimes(1);
  });
});

describe('"Turn off GPS"', () => {
  it('in AUTO mode: disables auto-tracking (switches to manual)', async () => {
    prefs.getTrackingMode.mockReturnValue('auto');
    const manualListener = jest.fn();
    handler.onManualRideStopRequested(manualListener);

    await handler.handleIdleReminderResponse(makeResponse('TURN_OFF_GPS'));

    expect(auto.disableAutoTracking).toHaveBeenCalledTimes(1);
    expect(manualListener).not.toHaveBeenCalled();
  });

  it('in MANUAL mode: asks the ride session to end (so distance is saved)', async () => {
    prefs.getTrackingMode.mockReturnValue('manual');
    const manualListener = jest.fn();
    handler.onManualRideStopRequested(manualListener);

    await handler.handleIdleReminderResponse(makeResponse('TURN_OFF_GPS'));

    expect(manualListener).toHaveBeenCalledTimes(1);
    expect(auto.disableAutoTracking).not.toHaveBeenCalled();
  });

  it('dismisses the notification afterwards', async () => {
    prefs.getTrackingMode.mockReturnValue('auto');
    await handler.handleIdleReminderResponse(makeResponse('TURN_OFF_GPS'));
    expect(N.dismissNotificationAsync).toHaveBeenCalledWith('ridezen-gps-idle');
  });

  it('handles the same tap only once (listener + background task can both fire)', async () => {
    prefs.getTrackingMode.mockReturnValue('auto');
    const res = makeResponse('TURN_OFF_GPS');
    await handler.handleIdleReminderResponse(res);
    await handler.handleIdleReminderResponse(res);
    expect(auto.disableAutoTracking).toHaveBeenCalledTimes(1);
  });

  it('a later, different reminder is handled again', async () => {
    prefs.getTrackingMode.mockReturnValue('auto');
    await handler.handleIdleReminderResponse(makeResponse('TURN_OFF_GPS', { date: 1 }));
    await handler.handleIdleReminderResponse(makeResponse('TURN_OFF_GPS', { date: 2 }));
    expect(auto.disableAutoTracking).toHaveBeenCalledTimes(2);
  });
});

describe('"Leave it"', () => {
  it('only dismisses — tracking keeps running', async () => {
    prefs.getTrackingMode.mockReturnValue('auto');
    const manualListener = jest.fn();
    handler.onManualRideStopRequested(manualListener);

    await handler.handleIdleReminderResponse(makeResponse('LEAVE_IT'));

    expect(N.dismissNotificationAsync).toHaveBeenCalledWith('ridezen-gps-idle');
    expect(auto.disableAutoTracking).not.toHaveBeenCalled();
    expect(manualListener).not.toHaveBeenCalled();
  });
});

describe('ignored responses', () => {
  it('tapping the notification body (not a button) does not stop tracking', async () => {
    prefs.getTrackingMode.mockReturnValue('auto');
    await handler.handleIdleReminderResponse(
      makeResponse('expo.modules.notifications.actions.DEFAULT')
    );
    expect(auto.disableAutoTracking).not.toHaveBeenCalled();
  });

  it('ignores responses from other notifications (e.g. maintenance reminders)', async () => {
    prefs.getTrackingMode.mockReturnValue('auto');
    await handler.handleIdleReminderResponse(makeResponse('TURN_OFF_GPS', { type: 'maintenance' }));
    expect(auto.disableAutoTracking).not.toHaveBeenCalled();
    expect(N.dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it('never throws if disabling fails', async () => {
    prefs.getTrackingMode.mockReturnValue('auto');
    auto.disableAutoTracking.mockRejectedValueOnce(new Error('boom'));
    await expect(
      handler.handleIdleReminderResponse(makeResponse('TURN_OFF_GPS'))
    ).resolves.toBeUndefined();
  });
});

describe('onManualRideStopRequested', () => {
  it('returns an unsubscribe function', async () => {
    prefs.getTrackingMode.mockReturnValue('manual');
    const listener = jest.fn();
    const unsubscribe = handler.onManualRideStopRequested(listener);
    unsubscribe();
    await handler.handleIdleReminderResponse(makeResponse('TURN_OFF_GPS'));
    expect(listener).not.toHaveBeenCalled();
  });
});
