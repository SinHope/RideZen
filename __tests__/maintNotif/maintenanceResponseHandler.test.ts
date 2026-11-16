// Tapping a maintenance notification opens the right screen.
// Module under test (NOT YET IMPLEMENTED): src/notifications/maintenanceResponseHandler.ts
//
// Expected exports:
//   handleMaintenanceResponse(response): Promise<void>   never throws
//        data.type 'maintenance' + numeric itemId → router.push('/maintenance/log/<itemId>')
//        data.type 'maintenance' without a usable itemId, or 'maintenance_summary' → router.navigate('/')
//        anything else (e.g. gps_idle) → ignored
//        the same tap is handled once (listener + cold-start check can both deliver it)
//   handleLastMaintenanceResponse(): void   app launched by tapping a notification: read the last response
//        (getLastNotificationResponse), handle it if it is ours, and clear it. Called once the navigator is ready.
//
// Side effect on import (like idleResponseHandler): addNotificationResponseReceivedListener(handler).
// Must be imported at the top of app/_layout.tsx.

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
}));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

let N: any;
let router: any;
let handler: any;

function makeResponse(data: Record<string, unknown>, opts: { date?: number; id?: string } = {}) {
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date: opts.date ?? 1_700_000_000_000,
      request: { identifier: opts.id ?? 'maint-7-urgent', content: { data }, trigger: null },
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  N = require('expo-notifications');
  router = require('expo-router').router;
  handler = require('@/notifications/maintenanceResponseHandler');
});

describe('registration', () => {
  it('listens for taps on import', () => {
    expect(N.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
  });

  it('the listener forwards taps to the handler', async () => {
    const listener = N.addNotificationResponseReceivedListener.mock.calls[0][0];
    await listener(makeResponse({ type: 'maintenance', itemId: 7, vehicleId: 1 }));
    expect(router.push).toHaveBeenCalledWith('/maintenance/log/7');
  });
});

describe('handleMaintenanceResponse', () => {
  it('a single item opens its service screen', async () => {
    await handler.handleMaintenanceResponse(makeResponse({ type: 'maintenance', itemId: 42, vehicleId: 3 }));
    expect(router.push).toHaveBeenCalledWith('/maintenance/log/42');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('a summary opens Home', async () => {
    await handler.handleMaintenanceResponse(makeResponse({ type: 'maintenance_summary' }));
    expect(router.navigate).toHaveBeenCalledWith('/');
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', { type: 'maintenance' }],
    ['not a number', { type: 'maintenance', itemId: 'abc' }],
    ['NaN', { type: 'maintenance', itemId: NaN }],
  ])('an item notification with an itemId that is %s falls back to Home', async (_label, data) => {
    await handler.handleMaintenanceResponse(makeResponse(data));
    expect(router.navigate).toHaveBeenCalledWith('/');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('ignores the GPS idle reminder and unknown notifications', async () => {
    await handler.handleMaintenanceResponse(makeResponse({ type: 'gps_idle' }));
    await handler.handleMaintenanceResponse(makeResponse({}));
    await handler.handleMaintenanceResponse({ actionIdentifier: 'x' });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('handles the same tap only once', async () => {
    const res = makeResponse({ type: 'maintenance', itemId: 7, vehicleId: 1 });
    await handler.handleMaintenanceResponse(res);
    await handler.handleMaintenanceResponse(res);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('a later notification for the same item is handled again', async () => {
    await handler.handleMaintenanceResponse(makeResponse({ type: 'maintenance', itemId: 7 }, { date: 1 }));
    await handler.handleMaintenanceResponse(makeResponse({ type: 'maintenance', itemId: 7 }, { date: 2 }));
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  it('never throws if navigation fails', async () => {
    router.push.mockImplementation(() => {
      throw new Error('navigator not ready');
    });
    await expect(
      handler.handleMaintenanceResponse(makeResponse({ type: 'maintenance', itemId: 7 }))
    ).resolves.toBeUndefined();
  });
});

describe('handleLastMaintenanceResponse (app opened from a notification)', () => {
  it('opens the screen and clears the response so it is not replayed', () => {
    N.getLastNotificationResponse.mockReturnValue(makeResponse({ type: 'maintenance', itemId: 7 }));
    handler.handleLastMaintenanceResponse();
    expect(router.push).toHaveBeenCalledWith('/maintenance/log/7');
    expect(N.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('does nothing when the app was not opened from a notification', () => {
    N.getLastNotificationResponse.mockReturnValue(null);
    handler.handleLastMaintenanceResponse();
    expect(router.push).not.toHaveBeenCalled();
    expect(N.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it("leaves someone else's notification alone (GPS idle is handled elsewhere)", () => {
    N.getLastNotificationResponse.mockReturnValue(makeResponse({ type: 'gps_idle' }));
    handler.handleLastMaintenanceResponse();
    expect(router.push).not.toHaveBeenCalled();
    expect(N.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('does not open it twice when the live listener already handled the same tap', async () => {
    const res = makeResponse({ type: 'maintenance', itemId: 7 });
    await handler.handleMaintenanceResponse(res);
    N.getLastNotificationResponse.mockReturnValue(res);
    handler.handleLastMaintenanceResponse();
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('never throws', () => {
    N.getLastNotificationResponse.mockImplementation(() => {
      throw new Error('native');
    });
    expect(() => handler.handleLastMaintenanceResponse()).not.toThrow();
  });
});
