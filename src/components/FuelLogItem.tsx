import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { FuelLog } from '@/types';
import { formatDate, formatConsumption } from '@/utils/consumption';
import { PencilIcon, TrashIcon } from '@/components/icons';

interface Props {
  log: FuelLog;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const FuelLogItem = React.memo(function FuelLogItem({ log, onEdit, onDelete }: Props) {
  const cost = log.price_per_litre ? log.litres * log.price_per_litre : null;
  const currency = log.currency ?? 'SGD';

  const handleDelete = () => {
    Alert.alert(
      'Delete entry?',
      'This refuel log will be permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]
    );
  };

  return (
    <View
      className="bg-zen-surface rounded-2xl p-4 mb-2.5 border border-zen-primary/[0.07]"
      style={{
        shadowColor: '#1B6CA8',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
      <View className="flex-row justify-between items-start mb-2">
        <View className="flex-1">
          <Text className="text-xs text-zen-muted font-inter">
            {formatDate(log.date)}
            {log.notes ? ` · ${log.notes}` : ''}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Text className="text-base font-inter-semibold text-zen-text">
            {formatConsumption(log.consumption ?? null)}
          </Text>
          {onEdit && (
            <TouchableOpacity
              onPress={onEdit}
              className="bg-zen-gold/10 rounded-lg p-1.5"
              hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Edit entry"
            >
              <PencilIcon color="#D4840A" size={14} />
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity
              onPress={handleDelete}
              className="bg-red-500/10 rounded-lg p-1.5"
              hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Delete entry"
            >
              <TrashIcon color="#DC2626" size={14} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View className="flex-row gap-3 flex-wrap">
        <Text className="text-xs text-zen-muted font-inter">
          Filled <Text className="text-zen-text font-inter-medium">{log.litres.toFixed(1)} L</Text>
        </Text>
        {log.price_per_litre ? (
          <Text className="text-xs text-zen-muted font-inter">
            at <Text className="text-zen-text font-inter-medium">{currency} {log.price_per_litre.toFixed(2)}/L</Text>
          </Text>
        ) : null}
        <Text className="text-xs text-zen-muted font-inter">
          Odo <Text className="text-zen-text font-inter-medium">{Math.round(log.odometer).toLocaleString()}</Text>
        </Text>
        {cost ? (
          <Text className="text-xs text-zen-muted font-inter">
            Cost <Text className="text-zen-text font-inter-medium">{currency} {cost.toFixed(2)}</Text>
          </Text>
        ) : null}
      </View>
    </View>
  );
});
