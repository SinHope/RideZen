import { useState, useEffect, useCallback } from 'react';
import { FuelLog, FuelLogInput } from '@/types';
import { fuelRepo } from '@/repositories/fuelRepo';

export function useFuelLogs(vehicleId: number) {
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthStats, setMonthStats] = useState({ total_litres: 0, total_cost: 0, avg_consumption: 0 });

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    const [logsResult, statsResult] = await Promise.all([
      fuelRepo.getByVehicle(vehicleId),
      fuelRepo.getMonthlyStats(vehicleId),
    ]);
    if (logsResult.error) setError(logsResult.error);
    else setLogs(logsResult.data ?? []);
    if (statsResult.data) setMonthStats(statsResult.data);
    setLoading(false);
  }, [vehicleId]);

  useEffect(() => { load(); }, [load]);

  const addLog = async (input: FuelLogInput): Promise<boolean> => {
    const result = await fuelRepo.add(input);
    if (result.error) { setError(result.error); return false; }
    await load();
    return true;
  };

  const deleteLog = async (id: number): Promise<void> => {
    const result = await fuelRepo.delete(id);
    if (result.error) setError(result.error);
    else await load();
  };

  return { logs, loading, error, monthStats, reload: load, addLog, deleteLog };
}
