/**
 * currencyService — exchange rates (cached in app_settings, refreshed at most daily), conversion, the home
 * currency and the recently-used list. Real SQLite (sql.js); the network (fetch) is faked. "Now" is frozen.
 */
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

import { TestDb, createMigratedDb, freezeClock, getCurrentDb, setCurrentDb, unfreezeClock } from '../helpers/testDb';

const RATES = { SGD: 1, MYR: 3.5, USD: 0.75, JPY: 110 };
const okResponse = (body: object, ok = true) => ({ ok, json: async () => body });
const successBody = (rates: object = RATES) => ({ result: 'success', conversion_rates: rates });

let db: TestDb;
let fetchMock: jest.Mock;

/** Load a fresh copy of the service, optionally with an API key in the environment. */
function loadService(apiKey: string | null = 'test-key') {
  if (apiKey === null) delete process.env.EXPO_PUBLIC_EXCHANGE_RATE_API_KEY;
  else process.env.EXPO_PUBLIC_EXCHANGE_RATE_API_KEY = apiKey;
  jest.resetModules();
  return require('@/services/currencyService') as typeof import('@/services/currencyService');
}

const setting = (key: string) => db.getFirstSync<any>('SELECT value FROM app_settings WHERE key = ?', [key])?.value ?? null;
const put = (key: string, value: string) => db.runSync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const primeCache = (base = 'SGD', ageHours = 1, rates: object = RATES) => {
  put('exchange_rates_json', JSON.stringify(rates));
  put('exchange_rates_base', base);
  put('exchange_rates_cached_at', hoursAgo(ageHours));
};

const savedKey = process.env.EXPO_PUBLIC_EXCHANGE_RATE_API_KEY;
beforeEach(async () => {
  freezeClock(2026, 10, 17);
  db = await createMigratedDb();
  setCurrentDb(db);
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
});
afterEach(() => {
  unfreezeClock();
  setCurrentDb(null);
  if (savedKey === undefined) delete process.env.EXPO_PUBLIC_EXCHANGE_RATE_API_KEY;
  else process.env.EXPO_PUBLIC_EXCHANGE_RATE_API_KEY = savedKey;
  jest.restoreAllMocks();
});

// ─── pure helpers ─────────────────────────────────────────────────────────────

describe('convert', () => {
  const { convert } = loadService();

  it('returns the amount unchanged for the same currency, even without rates', () => {
    expect(convert(10, 'SGD', 'SGD', {})).toBe(10);
  });

  it('converts through the base: (amount ÷ from-rate) × to-rate', () => {
    expect(convert(7, 'MYR', 'SGD', RATES)).toBeCloseTo(2); // 7 MYR → 2 SGD
    expect(convert(2, 'SGD', 'MYR', RATES)).toBeCloseTo(7);
    expect(convert(7, 'MYR', 'USD', RATES)).toBeCloseTo(1.5);
  });

  it('returns the amount as-is when a currency is unknown', () => {
    expect(convert(10, 'XXX', 'SGD', RATES)).toBe(10);
    expect(convert(10, 'SGD', 'XXX', RATES)).toBe(10);
  });

  it('returns the amount as-is for a zero rate (no divide-by-zero)', () => {
    expect(convert(10, 'MYR', 'SGD', { MYR: 0, SGD: 1 })).toBe(10);
  });
});

describe('getSupportedCurrencies', () => {
  const { getSupportedCurrencies } = loadService();
  it('lists the codes alphabetically', () => {
    expect(getSupportedCurrencies({ USD: 1, AED: 2, MYR: 3 })).toEqual(['AED', 'MYR', 'USD']);
    expect(getSupportedCurrencies({})).toEqual([]);
  });
});

describe('SUPPORTED_CURRENCIES catalogue', () => {
  const { SUPPORTED_CURRENCIES } = loadService();

  it('has well-formed, unique entries', () => {
    const codes = SUPPORTED_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of SUPPORTED_CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.country.length).toBeGreaterThan(0);
    }
  });

  it('includes the currencies riders here use', () => {
    const codes = SUPPORTED_CURRENCIES.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['SGD', 'MYR', 'USD', 'IDR', 'THB', 'JPY', 'EUR', 'GBP']));
  });
});

// ─── home currency ────────────────────────────────────────────────────────────

describe('home currency', () => {
  it('defaults to SGD', () => {
    expect(loadService().getHomeCurrency()).toBe('SGD');
  });

  it('is saved in upper case', () => {
    const s = loadService();
    s.setHomeCurrency('myr');
    expect(s.getHomeCurrency()).toBe('MYR');
    expect(setting('home_currency')).toBe('MYR');
  });

  it('changing it throws away cached rates (they were for the old base)', () => {
    const s = loadService();
    primeCache('SGD');
    s.setHomeCurrency('MYR');
    expect(s.getCachedRates()).toBeNull();
    expect(setting('exchange_rates_json')).toBeNull();
  });
});

// ─── recent currencies ────────────────────────────────────────────────────────

describe('recent currencies', () => {
  it('starts empty', () => {
    expect(loadService().getRecentCurrencies()).toEqual([]);
  });

  it('puts the newest first and keeps only 3', () => {
    const s = loadService();
    ['USD', 'MYR', 'JPY', 'THB'].forEach((c) => s.addRecentCurrency(c));
    expect(s.getRecentCurrencies()).toEqual(['THB', 'JPY', 'MYR']);
  });

  it('moves a repeat to the front instead of duplicating it', () => {
    const s = loadService();
    ['USD', 'MYR', 'JPY'].forEach((c) => s.addRecentCurrency(c));
    s.addRecentCurrency('USD');
    expect(s.getRecentCurrencies()).toEqual(['USD', 'JPY', 'MYR']);
  });

  it('survives corrupt stored data', () => {
    put('recent_currencies', '{not json');
    expect(loadService().getRecentCurrencies()).toEqual([]);
  });
});

// ─── cache ────────────────────────────────────────────────────────────────────

describe('cache', () => {
  it('has nothing cached on a new install', () => {
    const s = loadService();
    expect(s.getCachedRates()).toBeNull();
    expect(s.isCacheValid()).toBe(false);
  });

  it('returns what was cached, with its base and time, regardless of age', () => {
    const s = loadService();
    primeCache('MYR', 500);
    expect(s.getCachedRates()).toMatchObject({ base: 'MYR', rates: RATES });
  });

  it('is null when only part of the cache is present', () => {
    put('exchange_rates_json', '{}');
    expect(loadService().getCachedRates()).toBeNull();
  });

  it('is null (not a crash) when the cached JSON is corrupt', () => {
    primeCache();
    put('exchange_rates_json', '{broken');
    expect(loadService().getCachedRates()).toBeNull();
  });

  it('is valid for 24 hours, then expires', () => {
    const s = loadService();
    primeCache('SGD', 23);
    expect(s.isCacheValid()).toBe(true);
    primeCache('SGD', 25);
    expect(s.isCacheValid()).toBe(false);
  });

  it('is only valid for the base currency it was fetched for', () => {
    const s = loadService();
    primeCache('SGD', 1);
    expect(s.isCacheValid('SGD')).toBe(true);
    expect(s.isCacheValid('MYR')).toBe(false);
    expect(s.isCacheValid()).toBe(true); // no base asked for
  });

  it('is invalid (not a crash) when the database fails', () => {
    const s = loadService();
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(s.isCacheValid()).toBe(false);
    expect(s.getCachedRates()).toBeNull();
  });

  it('clearCache removes all three entries', () => {
    const s = loadService();
    primeCache();
    s.clearCache();
    expect(setting('exchange_rates_json')).toBeNull();
    expect(setting('exchange_rates_base')).toBeNull();
    expect(setting('exchange_rates_cached_at')).toBeNull();
  });
});

// ─── fetching ─────────────────────────────────────────────────────────────────

describe('fetchFreshRates', () => {
  it('asks the provider for the base currency, returns the rates and caches them', async () => {
    fetchMock.mockResolvedValue(okResponse(successBody()));
    const s = loadService('k123');

    const rates = await s.fetchFreshRates('SGD');

    expect(rates).toEqual(RATES);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/latest/SGD');
    expect(s.getCachedRates()).toMatchObject({ base: 'SGD', rates: RATES });
    expect(s.isCacheValid('SGD')).toBe(true);
  });

  it('does not call the network without an API key', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const s = loadService(null);

    expect(await s.fetchFreshRates('SGD')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EXPO_PUBLIC_EXCHANGE_RATE_API_KEY'));
  });

  it.each([
    ['an HTTP error', okResponse({}, false)],
    ['the provider reporting an error', okResponse({ result: 'error', 'error-type': 'invalid-key' })],
    ['a response without rates', okResponse({ result: 'success' })],
    ['rates that are not an object', okResponse({ result: 'success', conversion_rates: 'nope' })],
  ])('returns null and caches nothing on %s', async (_label, response) => {
    fetchMock.mockResolvedValue(response);
    const s = loadService();
    expect(await s.fetchFreshRates('SGD')).toBeNull();
    expect(s.getCachedRates()).toBeNull();
  });

  it('returns null when offline (fetch throws)', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));
    expect(await loadService().fetchFreshRates('SGD')).toBeNull();
  });

  it('returns null when the body is not JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('bad json'); } });
    expect(await loadService().fetchFreshRates('SGD')).toBeNull();
  });
});

describe('getRates', () => {
  it('uses the cache while it is fresh — no network call', async () => {
    primeCache('SGD', 2, { SGD: 1, MYR: 9 });
    const rates = await loadService().getRates('SGD');
    expect(rates).toEqual({ SGD: 1, MYR: 9 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults to the home currency as the base', async () => {
    put('home_currency', 'MYR');
    primeCache('MYR', 2, { MYR: 1, SGD: 0.28 });
    expect(await loadService().getRates()).toEqual({ MYR: 1, SGD: 0.28 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes once the cache is older than a day', async () => {
    primeCache('SGD', 30, { SGD: 1, MYR: 1 });
    fetchMock.mockResolvedValue(okResponse(successBody({ SGD: 1, MYR: 3.6 })));
    expect(await loadService().getRates('SGD')).toEqual({ SGD: 1, MYR: 3.6 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the cache is for a different base', async () => {
    primeCache('MYR', 1);
    fetchMock.mockResolvedValue(okResponse(successBody()));
    await loadService().getRates('SGD');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/latest/SGD');
  });

  it('is null when offline with no cache at all', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await loadService().getRates('SGD')).toBeNull();
  });

  // Behaviour worth knowing: an EXPIRED cache is not used as a fallback when the refresh fails, even though
  // getCachedRates() could return it. An offline rider on day 2 therefore gets no conversion until back online.
  it('is null when the cache has expired and the refresh fails (stale rates are not used)', async () => {
    primeCache('SGD', 30);
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await loadService().getRates('SGD')).toBeNull();
  });
});
