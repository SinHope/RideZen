// GPS idle reminder — scheduling contract.
// Target module (NOT YET IMPLEMENTED): src/notifications/idleReminder.ts
//
// Expected exports:
//   IDLE_REMINDER_ID        = 'ridezen-gps-idle'
//   IDLE_REMINDER_CATEGORY  = 'gps_idle'
//   IDLE_REMINDER_CHANNEL   = 'ride_tracking'
//   IDLE_REMINDER_SECONDS   = 60
//   IDLE_REARM_THROTTLE_MS  = 10000
//   ACTION_TURN_OFF_GPS     = 'TURN_OFF_GPS'
//   ACTION_LEAVE_IT         = 'LEAVE_IT'
//   setupIdleReminderCategory(): Promise<void>
//   armIdleReminder(): Promise<void>     // throttled, never throws
//   cancelIdleReminder(): Promise<void>  // never throws, resets throttle

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(null),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

let N: any;
let idle: any;
let nowMs: number;

beforeEach(() => {
  jest.resetModules();
  nowMs = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  N = require('expo-notifications');
  idle = require('@/notifications/idleReminder');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('constants', () => {
  it('uses the agreed identifiers and timings', () => {
    expect(idle.IDLE_REMINDER_ID).toBe('ridezen-gps-idle');
    expect(idle.IDLE_REMINDER_CATEGORY).toBe('gps_idle');
    expect(idle.IDLE_REMINDER_CHANNEL).toBe('ride_tracking');
    expect(idle.IDLE_REMINDER_SECONDS).toBe(60);
    expect(idle.IDLE_REARM_THROTTLE_MS).toBe(10_000);
    expect(idle.ACTION_TURN_OFF_GPS).toBe('TURN_OFF_GPS');
    expect(idle.ACTION_LEAVE_IT).toBe('LEAVE_IT');
  });
});

describe('setupIdleReminderCategory', () => {
  it('registers the two buttons: "Turn off GPS" and "Leave it"', async () => {
    await idle.setupIdleReminderCategory();

    expect(N.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    const [categoryId, actions] = N.setNotificationCategoryAsync.mock.calls[0];
    expect(categoryId).toBe('gps_idle');
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ identifier: 'TURN_OFF_GPS', buttonTitle: 'Turn off GPS' });
    expect(actions[1]).toMatchObject({ identifier: 'LEAVE_IT', buttonTitle: 'Leave it' });
  });

  it('buttons handle the tap in the background (do not open the app)', async () => {
    await idle.setupIdleReminderCategory();
    const actions = N.setNotificationCategoryAsync.mock.calls[0][1];
    for (const a of actions) {
      expect(a.options?.opensAppToForeground).toBe(false);
    }
  });
});

describe('armIdleReminder', () => {
  it('schedules one notification 60s out, under the fixed ID, with the buttons', async () => {
    await idle.armIdleReminder();

    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const req = N.scheduleNotificationAsync.mock.calls[0][0];
    expect(req.identifier).toBe('ridezen-gps-idle');
    expect(req.trigger).toMatchObject({ type: 'timeInterval', seconds: 60 });
    expect(req.trigger.repeats).toBeFalsy();
    expect(req.content).toMatchObject({
      categoryIdentifier: 'gps_idle',
      data: { type: 'gps_idle' },
    });
    expect(typeof req.content.title).toBe('string');
    expect(typeof req.content.body).toBe('string');
  });

  it('uses the high-importance ride_tracking channel on Android', async () => {
    await idle.armIdleReminder();
    const req = N.scheduleNotificationAsync.mock.calls[0][0];
    // In expo-notifications SDK 55 the channel belongs on the TRIGGER.
    // content.channelId is not part of NotificationContentInput and is ignored —
    // the notification would fall into the default 'maintenance' channel.
    expect(req.trigger.channelId).toBe('ride_tracking');
  });

  it('is throttled: a second call within 10s does not reschedule', async () => {
    await idle.armIdleReminder();
    nowMs += 9_999;
    await idle.armIdleReminder();
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('reschedules again once 10s have passed', async () => {
    await idle.armIdleReminder();
    nowMs += 10_000;
    await idle.armIdleReminder();
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('never throws, even if scheduling fails', async () => {
    N.scheduleNotificationAsync.mockRejectedValueOnce(new Error('boom'));
    await expect(idle.armIdleReminder()).resolves.toBeUndefined();
  });

  it('a failed schedule does not start the throttle window', async () => {
    N.scheduleNotificationAsync.mockRejectedValueOnce(new Error('boom'));
    await idle.armIdleReminder();
    nowMs += 1_000;
    await idle.armIdleReminder();
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
});

describe('cancelIdleReminder', () => {
  it('cancels the pending reminder and dismisses a visible one', async () => {
    await idle.cancelIdleReminder();
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('ridezen-gps-idle');
    expect(N.dismissNotificationAsync).toHaveBeenCalledWith('ridezen-gps-idle');
  });

  it('resets the throttle so the next ride can arm immediately', async () => {
    await idle.armIdleReminder();
    await idle.cancelIdleReminder();
    nowMs += 1_000; // well inside the 10s window
    await idle.armIdleReminder();
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('never throws', async () => {
    N.cancelScheduledNotificationAsync.mockRejectedValueOnce(new Error('boom'));
    await expect(idle.cancelIdleReminder()).resolves.toBeUndefined();
  });
});
