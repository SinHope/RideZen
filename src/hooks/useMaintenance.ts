import { useState, useEffect, useCallback } from 'react';
import { MaintenanceItem, MaintenanceStatus, ServiceLogInput } from '@/types';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';

export function useMaintenance(vehicleId: number, currentOdometer: number) {
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    const result = await maintenanceRepo.getByVehicle(vehicleId, currentOdometer);
    if (result.error) setError(result.error);
    else setItems(result.data ?? []);
    setLoading(false);
  }, [vehicleId, currentOdometer]);

  useEffect(() => { load(); }, [load]);

  const logService = async (input: ServiceLogInput): Promise<boolean> => {
    const result = await maintenanceRepo.logService(input);
    if (result.error) { setError(result.error); return false; }
    await load();
    return true;
  };

  const overdueCount = items.filter(i => i.status === 'overdue').length;
  const dueCount = items.filter(i => i.status === 'due' || i.status === 'urgent').length;

  const filterByStatus = (status: MaintenanceStatus | 'all') => {
    if (status === 'all') return items;
    return items.filter(i => i.status === status);
  };

  return { items, loading, error, reload: load, logService, overdueCount, dueCount, filterByStatus };
}
