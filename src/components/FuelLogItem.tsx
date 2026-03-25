import React from 'react';
import { View, Text } from 'react-native';
import { FuelLog } from '@/types';
import { formatDate, formatConsumption } from '@/utils/consumption';

interface Props { log: FuelLog; }

export const FuelLogItem = React.memo(function FuelLogItem({ log }: Props) {
  const cost = log.price_per_litre ? log.litres * log.price_per_litre : null;

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
        <Text className="text-base font-inter-semibold text-zen-text">
          {formatConsumption(log.consumption ?? null)}
        </Text>
      </View>

      <View className="flex-row gap-3 flex-wrap">
        <Text className="text-xs text-zen-muted font-inter">
          Filled <Text className="text-zen-text font-inter-medium">{log.litres.toFixed(1)} L</Text>
        </Text>
        {log.price_per_litre ? (
          <Text className="text-xs text-zen-muted font-inter">
            at <Text className="text-zen-text font-inter-medium">SGD {log.price_per_litre.toFixed(2)}/L</Text>
          </Text>
        ) : null}
        <Text className="text-xs text-zen-muted font-inter">
          Odo <Text className="text-zen-text font-inter-medium">{Math.round(log.odometer).toLocaleString()}</Text>
        </Text>
        {cost ? (
          <Text className="text-xs text-zen-muted font-inter">
            Cost <Text className="text-zen-text font-inter-medium">SGD {cost.toFixed(2)}</Text>
          </Text>
        ) : null}
      </View>
    </View>
  );
});
