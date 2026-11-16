/**
 * exportAllDataAsPdf — builds the full vehicle report as HTML, prints it to a PDF and opens the share sheet.
 * Real SQLite (sql.js) + the real repositories feed the report; only the native pieces
 * (expo-print, expo-sharing, expo-file-system's File) are faked. "Today" is frozen at 17 Nov 2026.
 */
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

const mockFiles: any[] = [];
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    movedTo: any = null;
    deleted = false;
    constructor(...parts: any[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri ?? String(p))).join('/');
      mockFiles.push(this);
    }
    move(dest: any) {
      this.movedTo = dest;
      this.uri = dest.uri; // like the real API: the file object now points at its new home
    }
    delete() {
      this.deleted = true;
    }
  }
  return { File, Paths: { cache: 'file:///cache' } };
});
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { exportAllDataAsPdf } from '@/utils/export';
import { fuelRepo } from '@/repositories/fuelRepo';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { logToFile } from '@/utils/logger';
import { TestDb, addItem, addVehicle, createMigratedDb, freezeClock, setCurrentDb, unfreezeClock } from '../helpers/testDb';

const mPrint = Print.printToFileAsync as jest.Mock;
const mAvailable = Sharing.isAvailableAsync as jest.Mock;
const mShare = Sharing.shareAsync as jest.Mock;

let db: TestDb;

beforeEach(async () => {
  jest.clearAllMocks();
  mockFiles.length = 0;
  freezeClock(2026, 10, 17);
  db = await createMigratedDb();
  setCurrentDb(db);
  mPrint.mockResolvedValue({ uri: 'file:///tmp/Print-123.pdf' });
  mAvailable.mockResolvedValue(true);
  mShare.mockResolvedValue(undefined);
});
afterEach(() => {
  unfreezeClock();
  setCurrentDb(null);
});

/** Run the export and return the HTML that was handed to the printer. */
async function exportAndGetHtml(): Promise<string> {
  await exportAllDataAsPdf();
  expect(mPrint).toHaveBeenCalledTimes(1);
  return mPrint.mock.calls[0][0].html as string;
}

function addFuel(vehicleId: number, over: Record<string, any> = {}) {
  return fuelRepo.add({
    vehicle_id: vehicleId,
    date: '2026-11-05',
    odometer: 1000,
    litres: 5,
    is_full_tank: true,
    ...over,
  } as any);
}

// ─── file handling / sharing ──────────────────────────────────────────────────

describe('producing the file', () => {
  beforeEach(() => {
    addVehicle(db, { nickname: 'Beat' });
  });

  it('prints the report to a PDF file (not base64)', async () => {
    await exportAllDataAsPdf();
    expect(mPrint).toHaveBeenCalledWith({ html: expect.stringContaining('<html>'), base64: false });
  });

  it('moves the PDF into the cache under a dated name', async () => {
    await exportAllDataAsPdf();
    const printed = mockFiles[0];
    expect(printed.uri).toBe('file:///cache/ridezen_report_2026-11-17.pdf');
    expect(printed.movedTo.uri).toBe('file:///cache/ridezen_report_2026-11-17.pdf');
  });

  it('opens the share sheet for that PDF', async () => {
    await exportAllDataAsPdf();
    expect(mShare).toHaveBeenCalledWith('file:///cache/ridezen_report_2026-11-17.pdf', {
      mimeType: 'application/pdf',
      dialogTitle: 'Export Full Report',
    });
  });

  it('tidies the temporary file afterwards', async () => {
    await exportAllDataAsPdf();
    expect(mockFiles[0].deleted).toBe(true);
  });

  it('still finishes (without sharing) when sharing is not available on the device', async () => {
    mAvailable.mockResolvedValue(false);
    await expect(exportAllDataAsPdf()).resolves.toBeUndefined();
    expect(mShare).not.toHaveBeenCalled();
  });

  it('does not fail just because the temp file could not be deleted', async () => {
    mShare.mockImplementation(async () => {
      mockFiles[0].delete = () => {
        throw new Error('already gone');
      };
    });
    await expect(exportAllDataAsPdf()).resolves.toBeUndefined();
  });
});

describe('when it cannot produce a report', () => {
  it('refuses with no vehicles — and says only that the PDF could not be made', async () => {
    await expect(exportAllDataAsPdf()).rejects.toThrow('Could not generate PDF. Please try again.');
    expect(mPrint).not.toHaveBeenCalled();
    // the specific reason is kept for the log
    expect(logToFile).toHaveBeenCalledWith('EXPORT_ERROR', 'exportAllDataAsPdf', expect.stringContaining('No vehicles found'));
  });

  it('wraps a printing failure in the friendly message and logs the cause', async () => {
    addVehicle(db);
    mPrint.mockRejectedValue(new Error('print service down'));
    await expect(exportAllDataAsPdf()).rejects.toThrow('Could not generate PDF. Please try again.');
    expect(logToFile).toHaveBeenCalledWith('EXPORT_ERROR', 'exportAllDataAsPdf', expect.stringContaining('print service down'));
    expect(mShare).not.toHaveBeenCalled();
  });

  it('wraps a sharing failure the same way', async () => {
    addVehicle(db);
    mShare.mockRejectedValue(new Error('share cancelled badly'));
    await expect(exportAllDataAsPdf()).rejects.toThrow('Could not generate PDF. Please try again.');
  });
});

// ─── report content ───────────────────────────────────────────────────────────

describe('report content', () => {
  it('has the report header with the date and vehicle count', async () => {
    addVehicle(db);
    const html = await exportAndGetHtml();
    expect(html).toContain('RideZen &mdash; Full Vehicle Report');
    expect(html).toMatch(/Generated on .*2026.* &middot; 1 vehicle</);
  });

  it('pluralises the vehicle count', async () => {
    addVehicle(db, { nickname: 'A' });
    addVehicle(db, { nickname: 'B' });
    expect(await exportAndGetHtml()).toContain('2 vehicles');
  });

  it('describes each vehicle: name, type, make / model / year and plate', async () => {
    const id = addVehicle(db, { nickname: 'Aerox', type: 'scooter', odo: 12345 });
    db.runSync(`UPDATE vehicles SET make = 'Yamaha', model = 'Aerox 155', year = 2019, plate_number = 'FBR2762C' WHERE id = ?`, [id]);

    const html = await exportAndGetHtml();

    expect(html).toContain('<h1 class="vehicle-title">Aerox</h1>');
    expect(html).toContain('Scooter / CVT');
    expect(html).toContain('Yamaha Aerox 155 2019 &middot; FBR2762C');
    expect(html).toContain(`${(12345).toLocaleString()} km`);
  });

  it.each([
    ['scooter', 'Scooter / CVT'],
    ['manual_bike', 'Manual Motorcycle'],
    ['car', 'Car'],
    ['other', 'Other'],
  ])('labels a %s as "%s"', async (type, label) => {
    addVehicle(db, { type });
    expect(await exportAndGetHtml()).toContain(`<div class="vehicle-type-label">${label}</div>`);
  });

  it('lists fuel logs with price, consumption and notes, and counts them', async () => {
    const id = addVehicle(db, { odo: 0 });
    await addFuel(id, { date: '2026-11-01', odometer: 1000, litres: 4, notes: 'first' });
    await addFuel(id, { date: '2026-11-05', odometer: 1100, litres: 5, price_per_litre: 2.5, currency: 'SGD', price_home: 2.5, notes: 'Shell V-Power' });

    const html = await exportAndGetHtml();

    expect(html).toContain('Fuel Log (2 entries)');
    expect(html).toContain('<td>2026-11-05</td>');
    expect(html).toContain('SGD 2.50'); // price per litre
    expect(html).toContain('5.00 L/100km'); // 5 L over 100 km
    expect(html).toContain('Shell V-Power');
    expect(html).toContain('2 refuels all time');
  });

  it('uses singular wording for a single fuel log', async () => {
    const id = addVehicle(db);
    await addFuel(id);
    const html = await exportAndGetHtml();
    expect(html).toContain('Fuel Log (1 entry)');
    expect(html).toContain('1 refuel all time');
  });

  it('says so when there are no fuel logs', async () => {
    addVehicle(db);
    expect(await exportAndGetHtml()).toContain('No fuel logs recorded');
  });

  it('totals fuel cost from the home-currency price, labelled with the home currency', async () => {
    db.runSync(`INSERT INTO app_settings (key, value) VALUES ('home_currency', 'MYR')`);
    const id = addVehicle(db, { odo: 0 });
    await addFuel(id, { date: '2026-11-01', odometer: 1000, litres: 10, price_home: 2 });
    await addFuel(id, { date: '2026-11-05', odometer: 1100, litres: 5, price_per_litre: 9, currency: 'USD' }); // no price_home → left out

    const html = await exportAndGetHtml();

    expect(html).toContain('Total Fuel Cost');
    expect(html).toContain('MYR 20.00'); // 10 L × 2 only
  });

  it('says there are no records this month when nothing was logged', async () => {
    addVehicle(db);
    expect(await exportAndGetHtml()).toContain('No records this month');
  });

  it('shows this month\'s spend and litres', async () => {
    const id = addVehicle(db, { odo: 0 });
    await addFuel(id, { date: '2026-11-02', odometer: 1000, litres: 10, price_home: 3 });
    const html = await exportAndGetHtml();
    expect(html).toContain('SGD 30.00');
    expect(html).toContain('10.00 L this month');
  });

  it('lists the maintenance schedule with a colour-coded status for each item', async () => {
    const id = addVehicle(db, { odo: 5000 });
    addItem(db, id, { category: 'Air Filter', interval_km: 10000, next_due_odo: 4000 }); // overdue
    addItem(db, id, { category: 'Brake Pads', interval_km: 10000, next_due_odo: 5100 }); // urgent
    addItem(db, id, { category: 'Chain', interval_km: 10000, next_due_odo: 5900 }); // due
    addItem(db, id, { category: 'Wash' }); // ok

    const html = await exportAndGetHtml();

    expect(html).toContain('Maintenance Schedule (4 items)');
    expect(html).toContain('<strong>Air Filter</strong>');
    expect(html).toContain('color:#CC0000;font-weight:600;">Overdue');
    expect(html).toContain('color:#B45309;font-weight:600;">Urgent');
    expect(html).toContain('color:#C45E0A;font-weight:600;">Due');
    expect(html).toContain('color:#2D6A4F;font-weight:600;">Ok');
  });

  it('shows the next due km (or date) and how many times each item was serviced', async () => {
    const id = addVehicle(db, { odo: 5000 });
    const oil = addItem(db, id, { category: 'Engine Oil', interval_km: 5000, next_due_odo: 9000 });
    addItem(db, id, { category: 'Battery', interval_days: 730, next_due_date: '2028-01-01' });
    await maintenanceRepo.logService({ item_id: oil, vehicle_id: id, date: '2026-06-01', odometer: 4000 });
    await maintenanceRepo.logService({ item_id: oil, vehicle_id: id, date: '2026-10-01', odometer: 4800 });

    const html = await exportAndGetHtml();

    expect(html).toContain(`${(9800).toLocaleString()} km`); // after the last service: 4800 + 5000
    expect(html).toContain('2028-01-01');
    expect(html).toContain('<td style="text-align:center;">2</td>'); // oil serviced twice
  });

  it('lists the service history newest first, with cost and workshop', async () => {
    const id = addVehicle(db, { odo: 5000 });
    const oil = addItem(db, id, { category: 'Engine Oil', interval_km: 5000 });
    const chain = addItem(db, id, { category: 'Chain', interval_km: 5000 });
    // The schedule table is A→Z by item (Chain, then Engine Oil), so make the OLDER service belong to Chain:
    // only a real newest-first sort of the history table puts 2026-09-09 above 2026-03-01.
    await maintenanceRepo.logService({ item_id: chain, vehicle_id: id, date: '2026-03-01', odometer: 3000, cost: 30, workshop: 'Ah Seng' });
    await maintenanceRepo.logService({ item_id: oil, vehicle_id: id, date: '2026-09-09', odometer: 4500, cost: 80, notes: 'lubed' });

    const html = await exportAndGetHtml();
    const history = html.slice(html.indexOf('<h2>Maintenance History</h2>'));

    expect(history).toContain('SGD 30.00');
    expect(history).toContain('Ah Seng');
    expect(history).toContain('lubed');
    expect(history.indexOf('2026-09-09')).toBeGreaterThan(-1);
    expect(history.indexOf('2026-09-09')).toBeLessThan(history.indexOf('2026-03-01'));
  });

  it('says so when there is no service history or no items', async () => {
    addVehicle(db);
    const html = await exportAndGetHtml();
    expect(html).toContain('No maintenance items');
    expect(html).toContain('No service history recorded');
  });

  it('puts a divider between vehicles and includes each one\'s own data', async () => {
    const a = addVehicle(db, { nickname: 'Alpha', odo: 0 });
    const b = addVehicle(db, { nickname: 'Bravo', odo: 0 });
    await addFuel(a, { notes: 'alpha-fuel' });
    await addFuel(b, { notes: 'bravo-fuel' });

    const html = await exportAndGetHtml();

    expect(html.match(/class="vehicle-divider"/g)).toHaveLength(1);
    expect(html).toContain('alpha-fuel');
    expect(html).toContain('bravo-fuel');
    expect(html).toContain('Alpha');
    expect(html).toContain('Bravo');
  });

  it('exports every vehicle even when one has no data', async () => {
    const a = addVehicle(db, { nickname: 'Alpha', odo: 0 });
    addVehicle(db, { nickname: 'Empty', odo: 0 });
    await addFuel(a);
    const html = await exportAndGetHtml();
    expect(html).toContain('<h1 class="vehicle-title">Empty</h1>');
  });
});

describe('uses the real repositories', () => {
  it('asks for up to 1,000 fuel logs per vehicle (so long histories are not cut at the default 50)', async () => {
    addVehicle(db);
    const spy = jest.spyOn(fuelRepo, 'getByVehicle');
    await exportAllDataAsPdf();
    expect(spy).toHaveBeenCalledWith(expect.any(Number), 1000);
    spy.mockRestore();
  });
});
