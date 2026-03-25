import { useState, useEffect, useCallback } from 'react';
import { Vehicle, VehicleInput } from '@/types';
import { vehicleRepo } from '@/repositories/vehicleRepo';

export function useVehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await vehicleRepo.getAll();
    if (result.error) setError(result.error);
    else setVehicles(result.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addVehicle = async (input: VehicleInput): Promise<number | null> => {
    const result = await vehicleRepo.create(input);
    if (result.error) { setError(result.error); return null; }
    await load();
    return result.data;
  };

  const deleteVehicle = async (id: number): Promise<void> => {
    const result = await vehicleRepo.delete(id);
    if (result.error) setError(result.error);
    else await load();
  };

  const updateOdometer = async (id: number, odometer: number): Promise<void> => {
    const result = await vehicleRepo.updateOdometer(id, odometer);
    if (result.error) setError(result.error);
    else await load();
  };

  return { vehicles, loading, error, reload: load, addVehicle, deleteVehicle, updateOdometer };
}
