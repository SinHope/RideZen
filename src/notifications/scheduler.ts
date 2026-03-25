import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { reminderRepo } from '@/repositories/reminderRepo';
import { checkReminderTrigger } from '@/utils/reminderCheck';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { logToFile } from '@/utils/logger';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;

    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    logToFile('NOTIF_ERROR', 'requestPermissions', String(e));
    return false;
  }
}

export async function setupAndroidChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('maintenance', {
        name: 'Maintenance Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1B6CA8',
      });
    } catch (e) {
      logToFile('NOTIF_ERROR', 'setupAndroidChannel', String(e));
    }
  }
}

export async function scheduleMaintenanceReminders(): Promise<void> {
  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return;

    // Cancel all existing scheduled notifications first
    await Notifications.cancelAllScheduledNotificationsAsync();

    const vehiclesResult = await vehicleRepo.getAll();
    if (!vehiclesResult.data) return;

    for (const vehicle of vehiclesResult.data) {
      const itemsResult = await maintenanceRepo.getByVehicle(vehicle.id, vehicle.current_odometer);
      if (!itemsResult.data) continue;

      for (const item of itemsResult.data) {
        const reminderResult = await reminderRepo.getByItem(item.id);
        if (!reminderResult.data) continue;

        const trigger = checkReminderTrigger(item, reminderResult.data, vehicle.current_odometer);
        if (!trigger) continue;

        const isEarly = trigger === 'early';
        const title = `RideZen — ${isEarly ? 'Service Due Soon' : 'Urgent: Service Required'}`;
        const body = `${item.category} on ${vehicle.nickname} needs attention. Tap to view.`;

        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title,
              body,
              // SECURITY: Only store itemId — never sensitive data in payload
              data: { itemId: item.id, vehicleId: vehicle.id },
              categoryIdentifier: 'maintenance',
              ...(Platform.OS === 'android' ? { channelId: 'maintenance' } : {}),
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 60, // Schedule for 1 minute from now for immediate items
            },
          });
        } catch (e) {
          logToFile('NOTIF_ERROR', `schedule item ${item.id}`, String(e));
        }
      }
    }
  } catch (e) {
    logToFile('NOTIF_ERROR', 'scheduleMaintenanceReminders', String(e));
  }
}

export async function cancelAllReminders(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    logToFile('NOTIF_ERROR', 'cancelAllReminders', String(e));
  }
}
