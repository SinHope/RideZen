import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useVehicles } from '@/hooks/useVehicles';
import { useFuelLogs } from '@/hooks/useFuelLogs';
import { FuelLogItem } from '@/components/FuelLogItem';
import { PlusIcon, ChevronRightIcon } from '@/components/icons';
import { FuelLog } from '@/types';

function VehiclePicker({ vehicles, selected, onSelect }: {
  vehicles: { id: number; nickname: string }[];
  selected: number;
  onSelect: (id: number) => void;
}) {
  if (vehicles.length <= 1) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ gap: 6 }}>
      {vehicles.map(v => (
        <TouchableOpacity
          key={v.id}
          onPress={() => onSelect(v.id)}
          className={`px-4 py-1.5 rounded-full ${selected === v.id ? 'bg-white' : 'bg-white/20'}`}
          accessibilityRole="button"
        >
          <Text className={`text-xs font-inter-medium ${selected === v.id ? 'text-zen-secondary' : 'text-white/85'}`}>
            {v.nickname}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export default function FuelScreen() {
  const insets = useSafeAreaInsets();
  const { vehicles } = useVehicles();
  const [selectedVehicleId, setSelectedVehicleId] = useState<number>(0);

  const activeId = selectedVehicleId || vehicles[0]?.id || 0;
  const activeVehicle = vehicles.find(v => v.id === activeId) ?? vehicles[0];

  const { logs, loading, monthStats, reload, deleteLog } = useFuelLogs(activeId);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => { reload(); }, [reload])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const handleDelete = useCallback((id: number) => {
    deleteLog(id);
  }, [deleteLog]);

  const renderItem = useCallback(({ item }: { item: FuelLog }) => (
    <FuelLogItem
      log={item}
      onEdit={() => router.push(`/fuel/edit/${item.id}`)}
      onDelete={() => handleDelete(item.id)}
    />
  ), [handleDelete]);

  const totalCost = monthStats.total_cost > 0 ? `SGD ${monthStats.total_cost.toFixed(0)}` : 'SGD —';
  const avgConsumption = monthStats.avg_consumption > 0 ? `${monthStats.avg_consumption.toFixed(1)}` : '—';
  const totalLitres = monthStats.total_litres > 0 ? `${monthStats.total_litres.toFixed(1)} L` : '— L';

  return (
    <View className="flex-1 bg-zen-bg">
      {/* Header */}
      <View
        className="px-5 pb-5"
        style={{
          paddingTop: insets.top + 8,
          backgroundColor: '#2D6A4F',
          shadowColor: '#2D6A4F',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.2,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <View className="flex-row justify-between items-center mb-0.5">
          <View className="flex-1">
            <Text className="text-xs text-white/75 font-inter">{activeVehicle?.nickname ?? 'No vehicle'}</Text>
            <Text className="text-2xl text-white font-playfair-medium">Fuel Log</Text>
          </View>
          <TouchableOpacity
            className="w-9 h-9 rounded-full bg-white/15 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Delete fuel log"
          >
            <ChevronRightIcon color="white" size={16} />
          </TouchableOpacity>
        </View>

        {/* Vehicle picker pills */}
        <VehiclePicker
          vehicles={vehicles}
          selected={activeId}
          onSelect={id => setSelectedVehicleId(id)}
        />

        {/* Summary stats */}
        <View className="flex-row gap-2 mt-3">
          {[
            { val: avgConsumption, unit: 'L/100km avg' },
            { val: totalLitres, unit: 'this month' },
            { val: totalCost, unit: 'spent' },
          ].map((s, i) => (
            <View key={i} className="flex-1 bg-white/15 rounded-xl py-2 px-2.5 items-center">
              <Text className="text-base font-inter-semibold text-white leading-tight">{s.val}</Text>
              <Text className="text-[9px] text-white/70 font-inter mt-0.5">{s.unit}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Log list */}
      {vehicles.length === 0 ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-zen-muted text-base font-inter text-center mb-4">
            Add a vehicle first to start tracking fuel.
          </Text>
          <TouchableOpacity
            className="bg-zen-primary px-6 py-3 rounded-2xl"
            onPress={() => router.push('/vehicle/add')}
            accessibilityRole="button"
          >
            <Text className="text-white font-inter-medium">Add Vehicle</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="flex-1 px-4 pt-4">
          <Text className="text-[11px] uppercase tracking-widest text-zen-muted font-inter-medium mb-2.5">
            Recent refuels
          </Text>

          {loading ? (
            [1, 2, 3].map(i => (
              <View key={i} className="h-20 rounded-2xl bg-gray-200 mb-2.5 animate-pulse" />
            ))
          ) : logs.length === 0 ? (
            <View className="flex-1 items-center justify-center pb-16">
              <Text className="text-zen-muted text-base font-inter text-center">
                Log your first refuel to start tracking consumption
              </Text>
            </View>
          ) : (
            <FlashList
              data={logs}
              renderItem={renderItem}
              estimatedItemSize={88}
              keyExtractor={item => String(item.id)}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2D6A4F" />}
              contentContainerStyle={{ paddingBottom: 100 }}
            />
          )}
        </View>
      )}

      {/* FAB */}
      {activeVehicle && (
        <TouchableOpacity
          className="absolute bottom-6 right-4 w-14 h-14 rounded-full bg-zen-gold items-center justify-center"
          style={{
            shadowColor: '#F4A035',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 10,
            elevation: 8,
          }}
          onPress={() => router.push(`/fuel/add/${activeVehicle.id}`)}
          accessibilityRole="button"
          accessibilityLabel="Log refuel"
          activeOpacity={0.88}
        >
          <PlusIcon color="white" size={22} />
        </TouchableOpacity>
      )}
    </View>
  );
}
