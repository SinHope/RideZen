import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BellIcon, ZapIcon, ShieldIcon, DownloadIcon, StarIcon, ChevronRightIcon } from '@/components/icons';
import { exportFuelLogs } from '@/utils/export';
import { useVehicles } from '@/hooks/useVehicles';

interface SettingsRowProps {
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}

function SettingsRow({ icon, iconBg, name, sub, right, onPress }: SettingsRowProps) {
  return (
    <TouchableOpacity
      className="flex-row items-center gap-3 px-3.5 py-3 border-b border-zen-primary/5 last:border-b-0"
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
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
      <View>{right ?? (onPress ? <ChevronRightIcon color="#6B7280" size={14} /> : null)}</View>
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

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { vehicles } = useVehicles();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const handleExport = async () => {
    const v = vehicles[0];
    if (!v) { Alert.alert('No vehicle', 'Add a vehicle first.'); return; }
    try {
      await exportFuelLogs(v.id, v.nickname);
    } catch (e: any) {
      Alert.alert('Export failed', e.message);
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

        {/* Profile row */}
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
        {/* Reminders */}
        <GroupLabel>Reminders</GroupLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<BellIcon color="#1B6CA8" size={15} />}
            iconBg="bg-zen-primary-pale"
            name="Push notifications"
            sub="Early warning + final reminder"
            right={
              <Switch
                value={notificationsEnabled}
                onValueChange={setNotificationsEnabled}
                trackColor={{ false: '#DDD', true: '#74C69D' }}
                thumbColor="white"
                accessibilityLabel="Toggle push notifications"
              />
            }
          />
          <SettingsRow
            icon={<StarIcon color="#2D6A4F" size={15} />}
            iconBg="bg-[#D6F0E2]"
            name="Default early warning"
            sub="1,000 km · 14 days before"
            onPress={() => {}}
          />
          <SettingsRow
            icon={<ZapIcon color="#F4A035" size={15} />}
            iconBg="bg-[#FEF3C7]"
            name="Default final reminder"
            sub="200 km · 3 days before"
            onPress={() => {}}
          />
        </SettingsGroup>

        {/* Data */}
        <GroupLabel>Data</GroupLabel>
        <SettingsGroup>
          <SettingsRow
            icon={<DownloadIcon color="#1B6CA8" size={15} />}
            iconBg="bg-zen-primary-pale"
            name="Export data"
            sub="CSV or JSON backup"
            onPress={handleExport}
          />
          <SettingsRow
            icon={<ShieldIcon color="#2D6A4F" size={15} />}
            iconBg="bg-[#D6F0E2]"
            name="Privacy"
            sub="All data stored locally on device"
            onPress={() => {}}
          />
        </SettingsGroup>

        {/* Upgrade */}
        <GroupLabel>Upgrade</GroupLabel>
        <SettingsGroup>
          <View className="flex-row items-center gap-3 px-3.5 py-3 bg-gradient-to-r from-zen-primary/5 to-zen-primary-light/5">
            <View
              className="w-8 h-8 rounded-lg items-center justify-center"
              style={{ backgroundColor: '#1B6CA8' }}
            >
              <StarIcon color="white" size={15} />
            </View>
            <View className="flex-1">
              <Text className="text-sm text-zen-primary font-inter-medium">RideZen Pro</Text>
              <Text className="text-xs text-zen-muted font-inter mt-0.5">Cloud sync, multi-device, backup</Text>
            </View>
            <View className="bg-zen-gold px-2.5 py-1 rounded-lg">
              <Text className="text-white text-[10px] font-inter-semibold">Soon</Text>
            </View>
          </View>
        </SettingsGroup>

        {/* Footer */}
        <Text className="text-center text-xs text-zen-muted font-inter mt-4">
          RideZen v1.0.0 · TulusNas Software Studio
        </Text>
      </ScrollView>
    </View>
  );
}
