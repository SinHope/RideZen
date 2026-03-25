import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaintenanceItem } from '@/types';
import { DueStatusBadge } from './DueStatusBadge';
import { WrenchIcon, ClockIcon, AlertCircleIcon, CheckIcon } from './icons';

interface Props {
  item: MaintenanceItem;
  onPress?: () => void;
}

function getItemIcon(category: string, status: MaintenanceItem['status']) {
  const color =
    status === 'overdue' ? '#CC0000' :
    status === 'urgent' ? '#B45309' :
    status === 'due' ? '#C45E0A' :
    '#1B6CA8';

  const bgClass =
    status === 'overdue' ? 'bg-zen-danger-bg' :
    status === 'urgent' ? 'bg-zen-urgent-bg' :
    status === 'due' ? 'bg-zen-warn-bg' :
    'bg-zen-primary-pale';

  // Pick icon based on category
  let IconComp = WrenchIcon;
  if (category.toLowerCase().includes('oil') || category.toLowerCase().includes('fluid')) {
    IconComp = AlertCircleIcon;
  } else if (category.toLowerCase().includes('tyre') || category.toLowerCase().includes('tire')) {
    IconComp = ClockIcon;
  } else if (status === 'ok') {
    IconComp = CheckIcon;
  }

  return { color, bgClass, IconComp };
}

function formatRemaining(item: MaintenanceItem): string {
  if (item.status === 'overdue') {
    if (item.km_remaining != null && item.km_remaining < 0) {
      return `${Math.abs(Math.round(item.km_remaining)).toLocaleString()} km overdue`;
    }
    if (item.days_remaining != null && item.days_remaining < 0) {
      return `${Math.abs(item.days_remaining)} days overdue`;
    }
    return 'Overdue';
  }
  if (item.km_remaining != null && item.next_due_odo != null) {
    return `Due at ${Math.round(item.next_due_odo).toLocaleString()} km · ${Math.round(item.km_remaining).toLocaleString()} km left`;
  }
  if (item.days_remaining != null && item.next_due_date != null) {
    return `Due ${item.next_due_date} · ${item.days_remaining} days left`;
  }
  return 'No schedule set';
}

export const MaintenanceItemCard = React.memo(function MaintenanceItemCard({ item, onPress }: Props) {
  const status = item.status ?? 'ok';
  const { color, bgClass, IconComp } = getItemIcon(item.category, status);
  const progressPct = item.progress_pct ?? 0;

  const progressColor =
    status === 'overdue' ? '#CC0000' :
    status === 'urgent' ? '#B45309' :
    status === 'due' ? '#F4A035' :
    '#74C69D';

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-zen-surface rounded-2xl p-3.5 mb-2 border border-zen-primary/[0.07] flex-row items-center gap-3"
      style={{
        shadowColor: '#1B6CA8',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 1,
      }}
      accessibilityRole="button"
      accessibilityLabel={`${item.category} — ${status}`}
      activeOpacity={0.85}
    >
      {/* Icon */}
      <View className={`w-10 h-10 rounded-xl items-center justify-center ${bgClass} flex-shrink-0`}>
        <IconComp color={color} size={18} />
      </View>

      {/* Info */}
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-inter-medium text-zen-text" numberOfLines={1}>{item.category}</Text>
        <Text className="text-xs text-zen-muted font-inter mt-0.5" numberOfLines={1}>
          {formatRemaining(item)}
        </Text>
        {/* Progress bar */}
        <View className="h-1 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
          <View
            className="h-full rounded-full"
            style={{ width: `${Math.min(progressPct, 100)}%`, backgroundColor: progressColor }}
          />
        </View>
      </View>

      {/* Badge */}
      <View className="flex-shrink-0">
        <DueStatusBadge status={status} />
      </View>
    </TouchableOpacity>
  );
});
