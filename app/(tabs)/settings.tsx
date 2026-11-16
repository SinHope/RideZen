import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch, Alert, Linking,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { BellIcon, ClockIcon, ZapIcon, ShieldIcon, DownloadIcon, StarIcon, ChevronRightIcon, NavigationIcon, PlayIcon } from '@/components/icons';
import { exportAllDataAsPdf } from '@/utils/export';
import { useVehicles } from '@/hooks/useVehicles';
import { useTrackingMode, SwitchToAutoOutcome } from '@/hooks/useTrackingMode';
import { getTrackingMode } from '@/services/trackingPreferences';
import {
  getMaintenanceNotifEnabled, setMaintenanceNotifEnabled,
  getNotifyTime, setNotifyTime,
  getNotifyGrouped, setNotifyGrouped,
} from '@/services/notificationPreferences';
import { syncMaintenanceNotifications } from '@/notifications/maintenanceNotifications';
import { requestNotificationPermissions } from '@/notifications/scheduler';
import { formatNotifyTime, notifyTimeToDate, dateToNotifyTime } from '@/utils/notifyTime';
import { getDb } from '@/db/client';

// ── app_settings helpers ──────────────────────────────────────────────────────

function getAppSetting(key: string, fallback: string): string {
  try {
    const db = getDb();
    const row = db.getFirstSync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

function setAppSetting(key: string, value: string): void {
  try {
    const db = getDb();
    db.runSync(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value]
    );
  } catch {}
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface SettingsRowProps {
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  /** Greyed out and not pressable (a setting that only applies while another one is on). */
  disabled?: boolean;
}

function SettingsRow({ icon, iconBg, name, sub, right, onPress, disabled }: SettingsRowProps) {
  return (
    <TouchableOpacity
      className="flex-row items-center gap-3 px-3.5 py-3 border-b border-zen-primary/5 last:border-b-0"
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={disabled ? { opacity: 0.45 } : undefined}
      activeOpacity={onPress && !disabled ? 0.7 : 1}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={name}
    >
      <View className={`w-8 h-8 rounded-lg items-center justify-center ${iconBg}`}>
        {icon}
      </View>
      <View className="flex-1">
        <Text className="text-sm text-zen-text font-inter">{name}</Text>
        {sub ? <Text className="text-xs text-zen-muted font-inter mt-0.5">{sub}</Text> : null}
      </View>
      <View>{right ?? (onPress && !disabled ? <ChevronRightIcon color="#6B7280" size={14} /> : null)}</View>
    </TouchableOpacity>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <View
      className="bg-zen-surface rounded-2xl overflow-hidden border border-zen-primary/[0.07] mb-3"
      style={{ shadowColor: '#1B6CA8', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 }}
    >
      {children}
    </View>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-[11px] uppercase tracking-widest text-zen-muted font-inter-medium mb-1.5 mt-3.5">
      {children}
    </Text>
  );
}

// ── Reminder Edit Modal ───────────────────────────────────────────────────────

interface ReminderEditModalProps {
  visible: boolean;
  title: string;
  kmKey: string;
  daysKey: string;
  defaultKm: string;
  defaultDays: string;
  onClose: () => void;
  onSaved: () => void;
}

function ReminderEditModal({ visible, title, kmKey, daysKey, defaultKm, defaultDays, onClose, onSaved }: ReminderEditModalProps) {
  const [km, setKm] = useState('');
  const [days, setDays] = useState('');

  useEffect(() => {
    if (visible) {
      setKm(getAppSetting(kmKey, defaultKm));
      setDays(getAppSetting(daysKey, defaultDays));
    }
  }, [visible]);

  const handleSave = () => {
    const kmVal = parseFloat(km);
    const daysVal = parseInt(days, 10);
    if (km && (isNaN(kmVal) || kmVal <= 0)) {
      Alert.alert('Invalid', 'Enter a valid km value.'); return;
    }
    if (days && (isNaN(daysVal) || daysVal <= 0)) {
      Alert.alert('Invalid', 'Enter a valid number of days.'); return;
    }
    if (km) setAppSetting(kmKey, String(kmVal));
    if (days) setAppSetting(daysKey, String(daysVal));
    onSaved();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}
      >
        <View style={{ width: '88%', backgroundColor: 'white', borderRadius: 20, padding: 22 }}>
          <Text style={{ fontFamily: 'Playfair Display_500Medium', fontSize: 18, color: '#0D3B5E', marginBottom: 16 }}>
            {title}
          </Text>

          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
            km before due
          </Text>
          <View style={{ borderWidth: 1, borderColor: 'rgba(27,108,168,0.15)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14 }}>
            <TextInput
              value={km}
              onChangeText={setKm}
              placeholder={defaultKm}
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: '#111827' }}
              accessibilityLabel="km before due"
            />
          </View>

          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
            days before due
          </Text>
          <View style={{ borderWidth: 1, borderColor: 'rgba(27,108,168,0.15)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20 }}>
            <TextInput
              value={days}
              onChangeText={setDays}
              placeholder={defaultDays}
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: '#111827' }}
              accessibilityLabel="days before due"
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              onPress={onClose}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(27,108,168,0.20)', alignItems: 'center' }}
            >
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#6B7280' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#1B6CA8', alignItems: 'center' }}
            >
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: 'white' }}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Privacy Modal ─────────────────────────────────────────────────────────────

function PrivacyModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
        <View style={{ paddingTop: insets.top + 8, paddingBottom: 16, paddingHorizontal: 20, backgroundColor: '#0D3B5E' }}>
          <TouchableOpacity onPress={onClose} style={{ marginBottom: 8 }}>
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_400Regular', fontSize: 13 }}>← Close</Text>
          </TouchableOpacity>
          <Text style={{ fontFamily: 'Playfair Display_500Medium', fontSize: 22, color: 'white' }}>Privacy Policy</Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>Last updated: April 2025</Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {[
            {
              title: 'Your data stays on your device',
              body: 'RideZen stores all your vehicle data — odometer readings, fuel logs, and maintenance records — locally on your device using SQLite. No data is sent to any server, cloud service, or third party.',
            },
            {
              title: 'Location data',
              body: 'If you enable Auto-track mode, RideZen requests background location permission to track ride distance. Location data is used solely to calculate distance and update your odometer. It is never stored beyond the current ride session and is never transmitted off your device.',
            },
            {
              title: 'No accounts required',
              body: 'RideZen does not require you to create an account, provide an email address, or log in. The app functions entirely without internet access.',
            },
            {
              title: 'No analytics or tracking',
              body: 'RideZen does not include any analytics SDKs, crash reporters that phone home, or advertising frameworks. Your usage of the app is not monitored or recorded.',
            },
            {
              title: 'Export and backup',
              body: 'The Export Data feature generates a PDF report of your data on-device. The file is only shared when you explicitly tap Share — it is not uploaded anywhere automatically.',
            },
            {
              title: 'Data deletion',
              body: 'Uninstalling the app removes all your data permanently. There is no account to delete and no server-side data to request removal of.',
            },
            {
              title: 'Contact',
              body: 'If you have questions about privacy, contact us at nasmerfontanilla@gmail.com.',
            },
          ].map(({ title, body }) => (
            <View key={title} style={{ marginBottom: 20 }}>
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#0D3B5E', marginBottom: 6 }}>{title}</Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: '#4B5563', lineHeight: 20 }}>{body}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Tracking Mode Selector ────────────────────────────────────────────────────

function TrackingModeSelector() {
  const { vehicles } = useVehicles();
  const { switchToAuto, switchToManual } = useTrackingMode();
  const [currentMode, setCurrentMode] = useState<'manual' | 'auto'>('manual');
  const [switching, setSwitching] = useState(false);

  useFocusEffect(useCallback(() => {
    setCurrentMode(getTrackingMode());
  }, []));

  const handleSwitchToAuto = async () => {
    const vehicleId = vehicles[0]?.id;
    if (!vehicleId) {
      Alert.alert('No vehicle', 'Add a vehicle first before enabling auto-track.');
      return;
    }
    setSwitching(true);
    const outcome: SwitchToAutoOutcome = await switchToAuto(vehicleId);
    setSwitching(false);

    switch (outcome) {
      case 'granted':
        setCurrentMode('auto');
        break;
      case 'foreground_denied':
      case 'background_only_while_using':
        Alert.alert(
          'Auto-track needs "Always Allow"',
          "You've been kept on Manual Ride Session. Tap again to retry.",
          [{ text: 'OK' }]
        );
        break;
      case 'foreground_never_ask':
      case 'background_never_ask':
        Alert.alert(
          'Permission required',
          'Auto-track needs "Always Allow" for location. Please enable it in your phone Settings.',
          [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
        break;
      case 'background_denied':
        Alert.alert('Could not start auto-track', 'Please try again.', [{ text: 'OK' }]);
        break;
    }
  };

  const handleSwitchToManual = async () => {
    setSwitching(true);
    await switchToManual();
    setSwitching(false);
    setCurrentMode('manual');
  };

  return (
    <View style={{ gap: 8 }}>
      <TouchableOpacity
        onPress={currentMode !== 'manual' && !switching ? handleSwitchToManual : undefined}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingHorizontal: 14, paddingVertical: 14,
          borderWidth: 2,
          borderColor: currentMode === 'manual' ? '#1B6CA8' : 'rgba(27,108,168,0.10)',
          borderRadius: 16,
          backgroundColor: currentMode === 'manual' ? 'rgba(27,108,168,0.06)' : 'white',
        }}
        activeOpacity={currentMode === 'manual' ? 1 : 0.7}
        accessibilityRole="button"
        accessibilityLabel="Select manual ride session"
      >
        <View style={{
          width: 34, height: 34, borderRadius: 10,
          backgroundColor: currentMode === 'manual' ? '#1B6CA8' : '#EFF8FF',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <PlayIcon color={currentMode === 'manual' ? 'white' : '#1B6CA8'} size={13} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: currentMode === 'manual' ? '#1B6CA8' : '#374151' }}>
            Manual Ride Session
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: '#6B7280', marginTop: 2 }}>
            Tap Start before you ride. Saves battery.
          </Text>
        </View>
        {currentMode === 'manual' && (
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#1B6CA8', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: 'white', fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>✓</Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={currentMode !== 'auto' && !switching ? handleSwitchToAuto : undefined}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingHorizontal: 14, paddingVertical: 14,
          borderWidth: 2,
          borderColor: currentMode === 'auto' ? '#2D6A4F' : 'rgba(27,108,168,0.10)',
          borderRadius: 16,
          backgroundColor: currentMode === 'auto' ? 'rgba(45,106,79,0.06)' : 'white',
          opacity: switching ? 0.6 : 1,
        }}
        activeOpacity={currentMode === 'auto' ? 1 : 0.7}
        accessibilityRole="button"
        accessibilityLabel="Select auto-track always"
        disabled={switching}
      >
        <View style={{
          width: 34, height: 34, borderRadius: 10,
          backgroundColor: currentMode === 'auto' ? '#2D6A4F' : '#ECFDF5',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <NavigationIcon color={currentMode === 'auto' ? 'white' : '#2D6A4F'} size={13} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: currentMode === 'auto' ? '#2D6A4F' : '#374151' }}>
            Auto-track Always
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: '#6B7280', marginTop: 2 }}>
            {switching ? 'Requesting permissions…' : 'Tracks automatically in background. Uses more battery.'}
          </Text>
        </View>
        {currentMode === 'auto' && (
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#2D6A4F', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: 'white', fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>✓</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { vehicles } = useVehicles();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notifyTime, setNotifyTimeState] = useState('09:00');
  const [notifyGrouped, setNotifyGroupedState] = useState(false);
  const [showIosTimePicker, setShowIosTimePicker] = useState(false);
  const [showEarlyModal, setShowEarlyModal] = useState(false);
  const [showFinalModal, setShowFinalModal] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [earlyKm, setEarlyKm] = useState('1000');
  const [earlyDays, setEarlyDays] = useState('14');
  const [finalKm, setFinalKm] = useState('200');
  const [finalDays, setFinalDays] = useState('3');

  const loadReminderSettings = useCallback(() => {
    setEarlyKm(getAppSetting('early_warning_km', '1000'));
    setEarlyDays(getAppSetting('early_warning_days', '14'));
    setFinalKm(getAppSetting('final_reminder_km', '200'));
    setFinalDays(getAppSetting('final_reminder_days', '3'));
    setNotificationsEnabled(getMaintenanceNotifEnabled());
    setNotifyTimeState(getNotifyTime());
    setNotifyGroupedState(getNotifyGrouped());
  }, []);

  useFocusEffect(loadReminderSettings);

  // ── Maintenance notifications ───────────────────────────────────────────────

  const handleToggleNotifications = async (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    setMaintenanceNotifEnabled(enabled);
    if (enabled) {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        Alert.alert(
          'Notifications are blocked',
          'Allow notifications for RideZen in your phone settings to get service reminders.',
          [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Not now', style: 'cancel' },
          ]
        );
      }
    }
    // OFF cancels what is pending; ON sends anything that came due while it was off
    await syncMaintenanceNotifications();
  };

  const saveNotifyTime = (date: Date) => {
    const time = dateToNotifyTime(date);
    if (setNotifyTime(time)) {
      setNotifyTimeState(time);
      void syncMaintenanceNotifications(); // re-books every pending date reminder at the new time
    }
  };

  const handlePickTime = () => {
    const onChange = (event: DateTimePickerEvent, date?: Date) => {
      setShowIosTimePicker(false);
      if (event.type === 'set' && date) saveNotifyTime(date);
    };
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: notifyTimeToDate(notifyTime), mode: 'time', is24Hour: false, onChange });
    } else {
      setShowIosTimePicker(true);
    }
  };

  const handleToggleGrouped = (grouped: boolean) => {
    setNotifyGroupedState(grouped);
    setNotifyGrouped(grouped);
    void syncMaintenanceNotifications();
  };

  // Levels (due / urgent / overdue) move with the thresholds, so re-check after one is saved
  const handleThresholdsSaved = () => {
    loadReminderSettings();
    void syncMaintenanceNotifications();
  };

  const handleExport = async () => {
    if (!vehicles.length) { Alert.alert('No vehicle', 'Add a vehicle first.'); return; }
    setExporting(true);
    try {
      await exportAllDataAsPdf();
    } catch (e: any) {
      Alert.alert('Export failed', e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <View className="flex-1 bg-zen-bg">
      {/* Header */}
      <View
        className="px-5 pb-5"
        style={{
          paddingTop: insets.top + 8,
          backgroundColor: '#0D3B5E',
          shadowColor: '#0D3B5E',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.2,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <Text className="text-xs text-white/70 font-inter">Account</Text>
        <Text className="text-2xl text-white font-playfair-medium">Settings</Text>

        <View className="flex-row items-center gap-3 mt-3">
          <View className="w-12 h-12 rounded-full bg-white/20 items-center justify-center">
            <Text className="text-white text-lg font-playfair">N</Text>
          </View>
          <View>
            <Text className="text-base text-white font-inter-medium">Nasmer</Text>
            <Text className="text-xs text-white/70 font-inter mt-0.5">
              {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} · Local storage · Free
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Odometer Tracking */}
        <GroupLabel>Odometer Tracking</GroupLabel>
        <View
          className="bg-zen-surface rounded-2xl overflow-hidden border border-zen-primary/[0.07] mb-3 p-3.5"
          style={{ shadowColor: '#1B6CA8', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 }}
        >
          <TrackingModeSelector />
        </View>

        {/* Reminders */}
        <GroupLabel>Reminders</GroupLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<BellIcon color="#1B6CA8" size={15} />}
            iconBg="bg-zen-primary-pale"
            name="Push notifications"
            sub="Due soon, urgent and overdue services"
            right={
              <Switch
                value={notificationsEnabled}
                onValueChange={handleToggleNotifications}
                trackColor={{ false: '#DDD', true: '#74C69D' }}
                thumbColor="white"
                accessibilityLabel="Toggle push notifications"
              />
            }
          />
          <SettingsRow
            icon={<ClockIcon color="#1B6CA8" size={15} />}
            iconBg="bg-zen-primary-pale"
            name="Notification time"
            sub={`Date reminders arrive at ${formatNotifyTime(notifyTime)}`}
            disabled={!notificationsEnabled}
            onPress={handlePickTime}
          />
          <SettingsRow
            icon={<BellIcon color="#2D6A4F" size={15} />}
            iconBg="bg-[#D6F0E2]"
            name="Group into one summary"
            sub="One notification instead of one per service"
            disabled={!notificationsEnabled}
            right={
              <Switch
                value={notifyGrouped}
                onValueChange={handleToggleGrouped}
                disabled={!notificationsEnabled}
                trackColor={{ false: '#DDD', true: '#74C69D' }}
                thumbColor="white"
                accessibilityLabel="Toggle grouped summary"
              />
            }
          />
          <SettingsRow
            icon={<StarIcon color="#2D6A4F" size={15} />}
            iconBg="bg-[#D6F0E2]"
            name="Default early warning"
            sub={`${parseInt(earlyKm).toLocaleString()} km · ${earlyDays} days before`}
            onPress={() => setShowEarlyModal(true)}
          />
          <SettingsRow
            icon={<ZapIcon color="#F4A035" size={15} />}
            iconBg="bg-[#FEF3C7]"
            name="Default final reminder"
            sub={`${parseInt(finalKm).toLocaleString()} km · ${finalDays} days before`}
            onPress={() => setShowFinalModal(true)}
          />
        </SettingsGroup>

        {/* Data */}
        <GroupLabel>Data</GroupLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<DownloadIcon color="#1B6CA8" size={15} />}
            iconBg="bg-zen-primary-pale"
            name="Export data"
            sub={exporting ? 'Generating PDF…' : 'PDF report of all your data'}
            onPress={exporting ? undefined : handleExport}
          />
          <SettingsRow
            icon={<ShieldIcon color="#2D6A4F" size={15} />}
            iconBg="bg-[#D6F0E2]"
            name="Privacy"
            sub="All data stored locally on device"
            onPress={() => setShowPrivacy(true)}
          />
        </SettingsGroup>

        {/* Upgrade */}
        <GroupLabel>Upgrade</GroupLabel>
        <SettingsGroup>
          <View className="flex-row items-center gap-3 px-3.5 py-3">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: '#1B6CA8' }}>
              <StarIcon color="white" size={15} />
            </View>
            <View className="flex-1">
              <Text className="text-sm text-zen-primary font-inter-medium">RideZen Pro</Text>
              <Text className="text-xs text-zen-muted font-inter mt-0.5">Cloud sync, multi-device, backup</Text>
            </View>
            <View className="bg-zen-gold px-2.5 py-1 rounded-lg">
              <Text className="text-white text-[10px] font-inter-semibold">Coming Soon</Text>
            </View>
          </View>
        </SettingsGroup>

        <Text className="text-center text-xs text-zen-muted font-inter mt-4">
          RideZen v1.0.0 · TulusNas Software Studio
        </Text>
      </ScrollView>

      {showIosTimePicker && Platform.OS !== 'android' && (
        <DateTimePicker
          value={notifyTimeToDate(notifyTime)}
          mode="time"
          display="spinner"
          onChange={(event, date) => {
            setShowIosTimePicker(false);
            if (event.type === 'set' && date) saveNotifyTime(date);
          }}
        />
      )}

      <ReminderEditModal
        visible={showEarlyModal}
        title="Default Early Warning"
        kmKey="early_warning_km"
        daysKey="early_warning_days"
        defaultKm="1000"
        defaultDays="14"
        onClose={() => setShowEarlyModal(false)}
        onSaved={handleThresholdsSaved}
      />

      <ReminderEditModal
        visible={showFinalModal}
        title="Default Final Reminder"
        kmKey="final_reminder_km"
        daysKey="final_reminder_days"
        defaultKm="200"
        defaultDays="3"
        onClose={() => setShowFinalModal(false)}
        onSaved={handleThresholdsSaved}
      />

      <PrivacyModal visible={showPrivacy} onClose={() => setShowPrivacy(false)} />
    </View>
  );
}
