import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVehicles } from '@/hooks/useVehicles';
import { useMaintenance } from '@/hooks/useMaintenance';
import { MaintenanceItemCard } from '@/components/MaintenanceItemCard';
import { MaintenanceItem } from '@/types';

type FilterType = 'all' | 'overdue' | 'due' | 'urgent' | 'ok';

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All items' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due', label: 'Due soon' },
  { key: 'ok', label: 'OK' },
];

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-xs font-inter-semibold text-zen-muted uppercase tracking-widest mt-3.5 mb-2">
      {title}
    </Text>
  );
}

export default function MaintenanceScreen() {
  const insets = useSafeAreaInsets();
  const { vehicles } = useVehicles();
  const [selectedVehicleId, setSelectedVehicleId] = useState<number>(0);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  const activeId = selectedVehicleId || vehicles[0]?.id || 0;
  const activeVehicle = vehicles.find(v => v.id === activeId) ?? vehicles[0];

  const { items, loading, overdueCount, dueCount, reload } = useMaintenance(activeId, activeVehicle?.current_odometer ?? 0);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { reload(); }, [activeId]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  // Filter and group items
  const filteredItems = activeFilter === 'all'
    ? items
    : activeFilter === 'due'
      ? items.filter(i => i.status === 'due' || i.status === 'urgent')
      : items.filter(i => i.status === activeFilter);

  const overdueItems = filteredItems.filter(i => i.status === 'overdue');
  const dueItems = filteredItems.filter(i => i.status === 'due' || i.status === 'urgent');
  const okItems = filteredItems.filter(i => i.status === 'ok');

  const sections: { title: string; data: MaintenanceItem[] }[] = [];
  if (activeFilter === 'all') {
    if (overdueItems.length > 0) sections.push({ title: 'Needs attention', data: overdueItems });
    if (dueItems.length > 0) sections.push({ title: 'Due soon', data: dueItems });
    if (okItems.length > 0) sections.push({ title: 'All good', data: okItems });
  } else {
    sections.push({ title: '', data: filteredItems });
  }

  return (
    <View className="flex-1 bg-zen-bg">
      {/* Header */}
      <View
        className="px-5 pb-0"
        style={{
          paddingTop: insets.top + 8,
          backgroundColor: '#1B6CA8',
          shadowColor: '#1B6CA8',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.2,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <View className="flex-row justify-between items-center mb-0.5">
          <View className="flex-1">
            <Text className="text-xs text-white/75 font-inter">{activeVehicle?.nickname ?? 'No vehicle'}</Text>
            <Text className="text-2xl text-white font-playfair-medium">Maintenance</Text>
          </View>
          {overdueCount + dueCount > 0 && (
            <View className="bg-white/20 px-3 py-1.5 rounded-full">
              <Text className="text-white text-xs font-inter-medium">
                {overdueCount > 0 ? `${overdueCount} overdue` : `${dueCount} due`}
              </Text>
            </View>
          )}
        </View>

        {/* Vehicle picker */}
        {vehicles.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ gap: 6 }}>
            {vehicles.map(v => (
              <TouchableOpacity
                key={v.id}
                onPress={() => setSelectedVehicleId(v.id)}
                className={`px-4 py-1.5 rounded-full ${activeId === v.id ? 'bg-white' : 'bg-white/20'}`}
              >
                <Text className={`text-xs font-inter-medium ${activeId === v.id ? 'text-zen-primary' : 'text-white/85'}`}>
                  {v.nickname}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Filter pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3 mb-4"
          contentContainerStyle={{ gap: 6 }}
        >
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              onPress={() => setActiveFilter(f.key)}
              className={`px-4 py-1.5 rounded-full ${activeFilter === f.key ? 'bg-white' : 'bg-white/20'}`}
              accessibilityRole="button"
            >
              <Text className={`text-xs font-inter-medium whitespace-nowrap ${activeFilter === f.key ? 'text-zen-primary' : 'text-white/85'}`}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Content */}
      {vehicles.length === 0 ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-zen-muted text-base font-inter text-center">
            Add a vehicle to see maintenance items.
          </Text>
        </View>
      ) : loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3, 4, 5].map(i => (
            <View key={i} className="h-16 rounded-2xl bg-gray-200 mb-2 animate-pulse" />
          ))}
        </View>
      ) : filteredItems.length === 0 ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-zen-muted text-base font-inter text-center">
            No items match this filter.
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-4"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1B6CA8" />}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 4 }}
          showsVerticalScrollIndicator={false}
        >
          {sections.map(section => (
            <View key={section.title}>
              {section.title ? <SectionHeader title={section.title} /> : null}
              {section.data.map(item => (
                <MaintenanceItemCard
                  key={item.id}
                  item={item}
                  onPress={() => router.push(`/maintenance/log/${item.id}`)}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
