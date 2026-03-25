import React from 'react';
import { View, Text } from 'react-native';
import { MaintenanceStatus } from '@/types';
import { cn } from '@/utils/cn';

interface Props {
  status: MaintenanceStatus;
  size?: 'sm' | 'md';
}

const statusConfig: Record<MaintenanceStatus, { label: string; className: string; textClass: string }> = {
  ok:      { label: 'OK',       className: 'bg-zen-ok-bg',      textClass: 'text-zen-ok' },
  due:     { label: 'Due Soon', className: 'bg-zen-warn-bg',    textClass: 'text-zen-warn' },
  urgent:  { label: 'Urgent',   className: 'bg-zen-urgent-bg',  textClass: 'text-zen-urgent' },
  overdue: { label: 'Overdue',  className: 'bg-zen-danger-bg',  textClass: 'text-zen-danger' },
};

export const DueStatusBadge = React.memo(function DueStatusBadge({ status, size = 'sm' }: Props) {
  const config = statusConfig[status];
  return (
    <View
      className={cn('rounded-lg px-2 py-0.5', config.className, size === 'md' ? 'px-3 py-1' : '')}
      accessibilityLabel={`Status: ${config.label}`}
    >
      <Text className={cn('font-inter-semibold uppercase tracking-wide', config.textClass, size === 'md' ? 'text-xs' : 'text-[10px]')}>
        {config.label}
      </Text>
    </View>
  );
});
