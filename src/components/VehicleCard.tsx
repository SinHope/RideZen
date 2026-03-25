import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Vehicle, MaintenanceStatus } from '@/types';
import { formatOdometer, daysAgoLabel } from '@/utils/consumption';

interface Props {
  vehicle: Vehicle;
  overdueCount?: number;
  dueCount?: number;
  avgConsumption?: number;
  lastRefuelDate?: string;
  onPress?: () => void;
}

function getBadgeStatus(overdueCount: number, dueCount: number): MaintenanceStatus {
  if (overdueCount > 0) return 'overdue';
  if (dueCount > 0) return 'due';
  return 'ok';
}

function getBadgeLabel(overdueCount: number, dueCount: number): string {
  if (overdueCount > 0) return `${overdueCount} Overdue`;
  if (dueCount > 0) return `${dueCount} Due soon`;
  return 'All good';
}

const TYPE_COLOR: Record<string, string> = {
  scooter: '#1B6CA8',
  manual_bike: '#2D6A4F',
  car: '#C47A1E',
  other: '#5B6DAE',
};

export const VehicleCard = React.memo(function VehicleCard({
  vehicle, overdueCount = 0, dueCount = 0, avgConsumption, lastRefuelDate, onPress
}: Props) {
  const cardColor = TYPE_COLOR[vehicle.type] ?? '#1B6CA8';

  const badgeStatus = getBadgeStatus(overdueCount, dueCount);
  const badgeLabel = getBadgeLabel(overdueCount, dueCount);

  const typeLabel: Record<string, string> = {
    scooter: 'Scooter / CVT',
    manual_bike: 'Manual Motorcycle',
    car: 'Car',
    other: 'Vehicle',
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      className="rounded-3xl p-4 mb-3 overflow-hidden"
      style={{
        backgroundColor: cardColor,
        shadowColor: cardColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 6,
      }}
      accessibilityRole="button"
      accessibilityLabel={`${vehicle.nickname} vehicle card`}
      activeOpacity={0.92}
    >
      {/* Decorative circles */}
      <View className="absolute -right-3 -bottom-3 w-20 h-20 rounded-full opacity-10 bg-white" />
      <View className="absolute right-4 -bottom-6 w-14 h-14 rounded-full opacity-[0.06] bg-white" />

      {/* Header row */}
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-1 mr-2">
          <Text className="text-[10px] text-white/70 uppercase tracking-widest font-inter mb-0.5">
            {typeLabel[vehicle.type] ?? vehicle.type}
          </Text>
          <Text className="text-white text-lg font-playfair-medium leading-tight" numberOfLines={1}>
            {vehicle.nickname}
          </Text>
        </View>

        {/* Status badge */}
        <View className={`px-2.5 py-1 rounded-2xl border ${
          badgeStatus === 'overdue' ? 'bg-red-500/25 border-red-400/40' :
          badgeStatus === 'due' ? 'bg-amber-500/25 border-amber-400/40' :
          'bg-green-500/25 border-green-400/40'
        }`}>
          <Text className={`text-[10px] font-inter-semibold ${
            badgeStatus === 'overdue' ? 'text-red-200' :
            badgeStatus === 'due' ? 'text-amber-200' :
            'text-green-200'
          }`}>
            {badgeLabel}
          </Text>
        </View>
      </View>

      {/* Stats row */}
      <View className="flex-row gap-4">
        <View>
          <Text className="text-[10px] text-white/65 font-inter mb-0.5">Odometer</Text>
          <Text className="text-sm font-inter-medium text-white">{formatOdometer(vehicle.current_odometer)}</Text>
        </View>
        <View>
          <Text className="text-[10px] text-white/65 font-inter mb-0.5">Last refuel</Text>
          <Text className="text-sm font-inter-medium text-white">
            {lastRefuelDate ? daysAgoLabel(lastRefuelDate) : '—'}
          </Text>
        </View>
        <View>
          <Text className="text-[10px] text-white/65 font-inter mb-0.5">Avg L/100km</Text>
          <Text className="text-sm font-inter-medium text-white">
            {avgConsumption ? `${avgConsumption.toFixed(1)} L` : '—'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});
