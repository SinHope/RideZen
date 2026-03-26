// _layout.tsx

import { Tabs } from 'expo-router';
import { View, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeIcon, FuelIcon, WrenchIcon, SettingsIcon } from '@/components/icons';
import { useVehicles } from '@/hooks/useVehicles';
import { useMaintenance } from '@/hooks/useMaintenance';

function TabBarIcon({ icon, label, focused, badge }: {
  icon: React.ReactNode;
  label: string;
  focused: boolean;
  badge?: number;
}) {
  return (
    <View className="items-center justify-center relative pt-1">
      <View className={`items-center justify-center w-10 h-10 rounded-xl ${focused ? 'bg-zen-primary-pale' : ''}`}>
        {icon}
      </View>
      <Text className={`text-[10px] font-inter-medium mt-0.5 ${focused ? 'text-zen-primary' : 'text-zen-muted'}`}>
        {label}
      </Text>
      {badge != null && badge > 0 && (
        <View className="absolute top-0 right-0 w-4 h-4 rounded-full bg-zen-danger items-center justify-center">
          <Text className="text-white text-[9px] font-inter-semibold">{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: 'rgba(27,108,168,0.10)',
          height: 64 + (Platform.OS === 'ios' ? insets.bottom : 8),
          paddingBottom: Platform.OS === 'ios' ? insets.bottom : 8,
          paddingTop: 4,
          elevation: 8,
          shadowColor: '#1B6CA8',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabBarIcon
              icon={<HomeIcon color={focused ? '#1B6CA8' : '#6B7280'} size={22} />}
              label="Home"
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="fuel"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabBarIcon
              icon={<FuelIcon color={focused ? '#1B6CA8' : '#6B7280'} size={22} />}
              label="Fuel"
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="maintenance"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabBarIcon
              icon={<WrenchIcon color={focused ? '#1B6CA8' : '#6B7280'} size={22} />}
              label="Service"
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabBarIcon
              icon={<SettingsIcon color={focused ? '#1B6CA8' : '#6B7280'} size={22} />}
              label="Settings"
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}
