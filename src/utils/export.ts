import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { fuelRepo } from '@/repositories/fuelRepo';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import { getHomeCurrency } from '@/services/currencyService';
import { logToFile } from './logger';
import { Vehicle, FuelLog, MaintenanceItem, MaintenanceLog } from '@/types';

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fuelTableRows(logs: FuelLog[]): string {
  if (!logs.length) return `<tr><td colspan="6" style="text-align:center;color:#9CA3AF;">No fuel logs recorded</td></tr>`;
  return logs.map(l => `
    <tr>
      <td>${l.date}</td>
      <td>${fmt(l.odometer, 0)} km</td>
      <td>${fmt(l.litres)} L</td>
      <td>${l.price_per_litre ? `${l.currency ?? 'SGD'} ${fmt(l.price_per_litre)}` : '—'}</td>
      <td>${l.consumption ? `${fmt(l.consumption)} L/100km` : '—'}</td>
      <td>${l.notes ?? '—'}</td>
    </tr>`).join('');
}

function maintenanceScheduleRows(items: MaintenanceItem[], historyMap: Record<number, MaintenanceLog[]>): string {
  if (!items.length) return `<tr><td colspan="5" style="text-align:center;color:#9CA3AF;">No maintenance items</td></tr>`;
  return items.map(item => {
    const history = historyMap[item.id] ?? [];
    const lastService = history[0];
    const statusColor =
      item.status === 'overdue' ? '#CC0000' :
      item.status === 'urgent' ? '#B45309' :
      item.status === 'due' ? '#C45E0A' : '#2D6A4F';
    const statusLabel = item.status
      ? item.status.charAt(0).toUpperCase() + item.status.slice(1)
      : 'OK';
    return `
    <tr>
      <td><strong>${item.category}</strong></td>
      <td style="color:${statusColor};font-weight:600;">${statusLabel}</td>
      <td>${item.next_due_odo ? `${fmt(item.next_due_odo, 0)} km` : item.next_due_date ?? '—'}</td>
      <td>${lastService ? lastService.date : '—'}</td>
      <td style="text-align:center;">${history.length}</td>
    </tr>`;
  }).join('');
}

function maintenanceHistoryRows(items: MaintenanceItem[], historyMap: Record<number, MaintenanceLog[]>): string {
  const allLogs: Array<{ category: string; log: MaintenanceLog }> = [];
  for (const item of items) {
    for (const log of (historyMap[item.id] ?? [])) {
      allLogs.push({ category: item.category, log });
    }
  }
  allLogs.sort((a, b) => b.log.date.localeCompare(a.log.date));

  if (!allLogs.length) return `<tr><td colspan="6" style="text-align:center;color:#9CA3AF;">No service history recorded</td></tr>`;
  return allLogs.map(({ category, log }) => `
    <tr>
      <td>${log.date}</td>
      <td><strong>${category}</strong></td>
      <td>${log.odometer ? `${fmt(log.odometer, 0)} km` : '—'}</td>
      <td>${log.cost != null ? `SGD ${fmt(log.cost)}` : '—'}</td>
      <td>${log.workshop ?? '—'}</td>
      <td>${log.notes ?? '—'}</td>
    </tr>`).join('');
}

function buildVehicleSection(
  vehicle: Vehicle,
  fuelLogs: FuelLog[],
  monthlyStats: { total_litres: number; total_cost: number; avg_consumption: number },
  maintItems: MaintenanceItem[],
  historyMap: Record<number, MaintenanceLog[]>,
): string {
  const typeLabel =
    vehicle.type === 'manual_bike' ? 'Manual Motorcycle' :
    vehicle.type === 'scooter' ? 'Scooter / CVT' :
    vehicle.type === 'car' ? 'Car' : 'Other';

  const metaParts = [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ');
  // Aggregate costs use price_home so foreign-currency fills aren't summed raw
  const currency = getHomeCurrency();
  const totalFuelCost = fuelLogs
    .filter(l => l.price_home && l.litres)
    .reduce((sum, l) => sum + (l.price_home! * l.litres), 0);

  return `
<div class="vehicle-section">
  <div class="vehicle-header-block">
    <div class="vehicle-type-label">${typeLabel}</div>
    <h1 class="vehicle-title">${vehicle.nickname}</h1>
    <div class="vehicle-meta">${metaParts}${vehicle.plate_number ? ` &middot; ${vehicle.plate_number}` : ''}</div>
  </div>

  <div class="stats-row">
    <div class="stat-card">
      <div class="label">Current Odometer</div>
      <div class="value">${fmt(vehicle.current_odometer, 0)} km</div>
    </div>
    <div class="stat-card">
      <div class="label">Fuel Spent This Month</div>
      <div class="value">${monthlyStats.total_cost > 0 ? `${currency} ${fmt(monthlyStats.total_cost)}` : '—'}</div>
      <div class="sub">${monthlyStats.total_litres > 0 ? `${fmt(monthlyStats.total_litres)} L this month` : 'No records this month'}</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg Consumption</div>
      <div class="value">${monthlyStats.avg_consumption > 0 ? `${fmt(monthlyStats.avg_consumption)} L/100km` : '—'}</div>
      <div class="sub">This month</div>
    </div>
    <div class="stat-card">
      <div class="label">Total Fuel Cost</div>
      <div class="value">${totalFuelCost > 0 ? `${currency} ${fmt(totalFuelCost)}` : '—'}</div>
      <div class="sub">${fuelLogs.length} refuel${fuelLogs.length !== 1 ? 's' : ''} all time</div>
    </div>
  </div>

  <h2>Fuel Log (${fuelLogs.length} ${fuelLogs.length === 1 ? 'entry' : 'entries'})</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th><th>Odometer</th><th>Litres</th><th>Price/L</th><th>Consumption</th><th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${fuelTableRows(fuelLogs)}
    </tbody>
  </table>

  <h2>Maintenance Schedule (${maintItems.length} items)</h2>
  <table>
    <thead>
      <tr>
        <th>Item</th><th>Status</th><th>Next Due</th><th>Last Serviced</th><th>Service Count</th>
      </tr>
    </thead>
    <tbody>
      ${maintenanceScheduleRows(maintItems, historyMap)}
    </tbody>
  </table>

  <h2>Maintenance History</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th><th>Item</th><th>Odometer</th><th>Cost</th><th>Workshop</th><th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${maintenanceHistoryRows(maintItems, historyMap)}
    </tbody>
  </table>
</div>`;
}

function buildHtml(
  vehicles: Vehicle[],
  fuelLogsMap: Record<number, FuelLog[]>,
  monthlyStatsMap: Record<number, { total_litres: number; total_cost: number; avg_consumption: number }>,
  maintItemsMap: Record<number, MaintenanceItem[]>,
  historyMap: Record<number, Record<number, MaintenanceLog[]>>,
): string {
  const exportDate = new Date().toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' });

  const vehicleSections = vehicles
    .map(v => buildVehicleSection(
      v,
      fuelLogsMap[v.id] ?? [],
      monthlyStatsMap[v.id] ?? { total_litres: 0, total_cost: 0, avg_consumption: 0 },
      maintItemsMap[v.id] ?? [],
      historyMap[v.id] ?? {},
    ))
    .join('<div class="vehicle-divider"></div>');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 12px; color: #1F2937; background: #fff; padding: 32px; }

  .top-header { background: #0D3B5E; color: white; padding: 24px 28px; border-radius: 12px; margin-bottom: 40px; }
  .top-header h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; }
  .top-header p { font-size: 12px; opacity: 0.75; }

  .vehicle-section { margin-bottom: 40px; }
  .vehicle-header-block { background: #1B6CA8; color: white; padding: 22px 26px; border-radius: 14px; margin-bottom: 20px; }
  .vehicle-type-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; opacity: 0.7; margin-bottom: 6px; }
  .vehicle-title { font-size: 26px; font-weight: 800; margin-bottom: 4px; }
  .vehicle-meta { font-size: 12px; opacity: 0.8; }
  .vehicle-divider { height: 3px; background: #E5F3FF; border-radius: 2px; margin: 48px 0; }

  .stats-row { display: flex; gap: 10px; margin-bottom: 24px; }
  .stat-card { flex: 1; background: #F0F9FF; border: 1px solid #BAE6FD; border-radius: 10px; padding: 12px 14px; }
  .stat-card .label { font-size: 9px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
  .stat-card .value { font-size: 15px; font-weight: 700; color: #1B6CA8; }
  .stat-card .sub { font-size: 10px; color: #9CA3AF; margin-top: 2px; }

  h2 { font-size: 13px; font-weight: 700; color: #0D3B5E; margin-bottom: 10px; margin-top: 28px; padding-bottom: 6px; border-bottom: 2px solid #E5F3FF; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 11px; }
  th { background: #1B6CA8; color: white; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 10px; }
  td { padding: 7px 10px; border-bottom: 1px solid #F3F4F6; vertical-align: top; }
  tr:nth-child(even) td { background: #F9FAFB; }

  .footer { margin-top: 32px; text-align: center; font-size: 10px; color: #9CA3AF; border-top: 1px solid #E5E7EB; padding-top: 12px; }
</style>
</head>
<body>

<div class="top-header">
  <h1>RideZen &mdash; Full Vehicle Report</h1>
  <p>Generated on ${exportDate} &middot; ${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''}</p>
</div>

${vehicleSections}

<div class="footer">RideZen &middot; TulusNas Software Studio &middot; All data stored locally on your device</div>

</body>
</html>`;
}

export async function exportAllDataAsPdf(): Promise<void> {
  try {
    const vehiclesResult = await vehicleRepo.getAll();
    if (!vehiclesResult.data || vehiclesResult.data.length === 0) {
      throw new Error('No vehicles found. Add a vehicle first.');
    }

    const vehicles = vehiclesResult.data;

    const [fuelResults, monthlyResults, maintResults] = await Promise.all([
      Promise.all(vehicles.map(v => fuelRepo.getByVehicle(v.id, 1000))),
      Promise.all(vehicles.map(v => fuelRepo.getMonthlyStats(v.id))),
      Promise.all(vehicles.map(v => maintenanceRepo.getByVehicle(v.id, v.current_odometer))),
    ]);

    const fuelLogsMap: Record<number, FuelLog[]> = {};
    const monthlyStatsMap: Record<number, { total_litres: number; total_cost: number; avg_consumption: number }> = {};
    const maintItemsMap: Record<number, MaintenanceItem[]> = {};

    vehicles.forEach((v, i) => {
      fuelLogsMap[v.id] = fuelResults[i].data ?? [];
      monthlyStatsMap[v.id] = monthlyResults[i].data ?? { total_litres: 0, total_cost: 0, avg_consumption: 0 };
      maintItemsMap[v.id] = maintResults[i].data ?? [];
    });

    // Fetch service history for every maintenance item across all vehicles
    const historyMap: Record<number, Record<number, MaintenanceLog[]>> = {};
    await Promise.all(
      vehicles.map(async v => {
        historyMap[v.id] = {};
        await Promise.all(
          (maintItemsMap[v.id] ?? []).map(async item => {
            const h = await maintenanceRepo.getHistory(item.id);
            historyMap[v.id][item.id] = h.data ?? [];
          })
        );
      })
    );

    const html = buildHtml(vehicles, fuelLogsMap, monthlyStatsMap, maintItemsMap, historyMap);
    const { uri } = await Print.printToFileAsync({ html, base64: false });

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `ridezen_report_${dateStr}.pdf`;
    const pdfFile = new File(uri);
    const destFile = new File(Paths.cache, filename);
    pdfFile.move(destFile);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(pdfFile.uri, { mimeType: 'application/pdf', dialogTitle: 'Export Full Report' });
    }

    try { pdfFile.delete(); } catch {}
  } catch (e) {
    logToFile('EXPORT_ERROR', 'exportAllDataAsPdf', String(e));
    throw new Error('Could not generate PDF. Please try again.');
  }
}
