// ─────────────────────────────────────────────────────────────────────────────
// currencyService.ts
//
// Single source of truth for all currency logic in RideZen.
// The rest of the app NEVER talks to the exchange rate API directly —
// everything goes through the public functions at the bottom of this file.
//
// TO SWITCH PROVIDERS: only edit the "API PROVIDER" section below.
// Everything else (cache, conversion math, home currency) stays untouched.
// ─────────────────────────────────────────────────────────────────────────────

import { getDb } from '@/db/client';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ExchangeRates = Record<string, number>;

export interface CachedRates {
  base: string;
  rates: ExchangeRates;
  cachedAt: string; // ISO datetime
}

// ─────────────────────────────────────────────────────────────────────────────
// API PROVIDER — Edit ONLY this section to switch providers
//
// Current provider: ExchangeRate-API (https://www.exchangerate-api.com)
// Free tier: 1,500 requests/month, daily updates, 160+ currencies
// Docs:      https://www.exchangerate-api.com/docs/standard-requests
//
// To switch providers:
//   1. Update BASE_URL to the new provider's endpoint
//   2. Update parseResponse() to match the new JSON structure
//   3. Keep everything else the same
// ─────────────────────────────────────────────────────────────────────────────

const API_KEY = process.env.EXPO_PUBLIC_EXCHANGE_RATE_API_KEY ?? '';

// Returns the full URL for the latest rates with the given base currency.
// ExchangeRate-API format: /v6/{key}/latest/{base}
function buildUrl(baseCurrency: string): string {
  return `https://v6.exchangerate-api.com/v6/${API_KEY}/latest/${baseCurrency}`;
}

// Parses the raw API response into a plain ExchangeRates object.
// ExchangeRate-API returns rates under the key "conversion_rates".
// Change this function if your new provider uses a different key (e.g. "rates").
function parseResponse(json: any): ExchangeRates | null {
  if (json?.result !== 'success') return null;
  const rates = json?.conversion_rates;
  if (!rates || typeof rates !== 'object') return null;
  return rates as ExchangeRates;
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE — stores rates in SQLite app_settings so the app works offline
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY_RATES     = 'exchange_rates_json';
const CACHE_KEY_BASE      = 'exchange_rates_base';
const CACHE_KEY_CACHED_AT = 'exchange_rates_cached_at';
const CACHE_TTL_HOURS     = 24; // re-fetch at most once per day

function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.getFirstSync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

function setSetting(key: string, value: string): void {
  const db = getDb();
  db.runSync(
    'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
    [key, value, new Date().toISOString()]
  );
}

// Returns the cached rates if present, regardless of age.
export function getCachedRates(): CachedRates | null {
  try {
    const json     = getSetting(CACHE_KEY_RATES);
    const base     = getSetting(CACHE_KEY_BASE);
    const cachedAt = getSetting(CACHE_KEY_CACHED_AT);
    if (!json || !base || !cachedAt) return null;
    return { base, rates: JSON.parse(json) as ExchangeRates, cachedAt };
  } catch {
    return null;
  }
}

// Returns true if the cache exists and is younger than CACHE_TTL_HOURS.
export function isCacheValid(forBase?: string): boolean {
  try {
    const cachedAt = getSetting(CACHE_KEY_CACHED_AT);
    const base     = getSetting(CACHE_KEY_BASE);
    if (!cachedAt || !base) return false;
    if (forBase && base !== forBase) return false; // base currency changed
    const ageMs  = Date.now() - new Date(cachedAt).getTime();
    const ageHrs = ageMs / (1000 * 60 * 60);
    return ageHrs < CACHE_TTL_HOURS;
  } catch {
    return false;
  }
}

function saveToCache(base: string, rates: ExchangeRates): void {
  const now = new Date().toISOString();
  setSetting(CACHE_KEY_RATES,     JSON.stringify(rates));
  setSetting(CACHE_KEY_BASE,      base);
  setSetting(CACHE_KEY_CACHED_AT, now);
}

export function clearCache(): void {
  const db = getDb();
  db.runSync(
    "DELETE FROM app_settings WHERE key IN (?, ?, ?)",
    [CACHE_KEY_RATES, CACHE_KEY_BASE, CACHE_KEY_CACHED_AT]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH — hits the external API
// ─────────────────────────────────────────────────────────────────────────────

// Fetches fresh rates from the provider and saves them to cache.
// Returns the rates on success, null on network/parse failure.
export async function fetchFreshRates(baseCurrency: string): Promise<ExchangeRates | null> {
  if (!API_KEY) {
    console.warn('[currencyService] EXPO_PUBLIC_EXCHANGE_RATE_API_KEY is not set.');
    return null;
  }
  try {
    const response = await fetch(buildUrl(baseCurrency));
    if (!response.ok) return null;
    const json  = await response.json();
    const rates = parseResponse(json);
    if (!rates) return null;
    saveToCache(baseCurrency, rates);
    return rates;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC INTERFACE — everything else in the app uses only these functions
// ─────────────────────────────────────────────────────────────────────────────

// Returns rates for the given base currency.
// Uses cache if valid, fetches fresh only when the cache is expired or missing.
// Returns null if offline with no cache available.
export async function getRates(baseCurrency?: string): Promise<ExchangeRates | null> {
  const base = baseCurrency ?? getHomeCurrency();
  if (isCacheValid(base)) {
    return getCachedRates()?.rates ?? null;
  }
  return fetchFreshRates(base);
}

// Converts an amount from one currency to another using the provided rates.
// Rates must be based on the same base currency (e.g. all relative to SGD).
// Formula: (amount / rates[from]) * rates[to]
// If from === to, returns amount unchanged.
export function convert(
  amount: number,
  from: string,
  to: string,
  rates: ExchangeRates
): number {
  if (from === to) return amount;
  const fromRate = rates[from];
  const toRate   = rates[to];
  if (!fromRate || !toRate) return amount; // unknown currency — return as-is
  return (amount / fromRate) * toRate;
}

// Returns a sorted list of all currency codes available in a rates object.
export function getSupportedCurrencies(rates: ExchangeRates): string[] {
  return Object.keys(rates).sort();
}

// ─── Recent currencies ────────────────────────────────────────────────────────

const RECENT_CURRENCIES_KEY = 'recent_currencies';
const RECENT_MAX = 3;

export function getRecentCurrencies(): string[] {
  try {
    const raw = getSetting(RECENT_CURRENCIES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function addRecentCurrency(code: string): void {
  const current = getRecentCurrencies();
  const updated = [code, ...current.filter(c => c !== code)].slice(0, RECENT_MAX);
  setSetting(RECENT_CURRENCIES_KEY, JSON.stringify(updated));
}

// ─── Home currency preference ─────────────────────────────────────────────────

const HOME_CURRENCY_KEY     = 'home_currency';
const HOME_CURRENCY_DEFAULT = 'SGD';

export function getHomeCurrency(): string {
  return getSetting(HOME_CURRENCY_KEY) ?? HOME_CURRENCY_DEFAULT;
}

export function setHomeCurrency(currency: string): void {
  setSetting(HOME_CURRENCY_KEY, currency.toUpperCase());
  // Invalidate cache so next getRates() re-fetches with the new base
  clearCache();
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED CURRENCIES — all 165 currencies from ExchangeRate-API
// Source: https://www.exchangerate-api.com/docs/supported-currencies
// This list is static (ISO 4217) — does not need to change if you switch APIs
// ─────────────────────────────────────────────────────────────────────────────

export interface CurrencyInfo {
  code: string;
  name: string;
  country: string;
}

export const SUPPORTED_CURRENCIES: CurrencyInfo[] = [
  { code: 'AED', name: 'UAE Dirham',                         country: 'United Arab Emirates' },
  { code: 'AFN', name: 'Afghan Afghani',                     country: 'Afghanistan' },
  { code: 'ALL', name: 'Albanian Lek',                       country: 'Albania' },
  { code: 'AMD', name: 'Armenian Dram',                      country: 'Armenia' },
  { code: 'ANG', name: 'Netherlands Antillian Guilder',      country: 'Netherlands Antilles' },
  { code: 'AOA', name: 'Angolan Kwanza',                     country: 'Angola' },
  { code: 'ARS', name: 'Argentine Peso',                     country: 'Argentina' },
  { code: 'AUD', name: 'Australian Dollar',                  country: 'Australia' },
  { code: 'AWG', name: 'Aruban Florin',                      country: 'Aruba' },
  { code: 'AZN', name: 'Azerbaijani Manat',                  country: 'Azerbaijan' },
  { code: 'BAM', name: 'Bosnia and Herzegovina Mark',        country: 'Bosnia and Herzegovina' },
  { code: 'BBD', name: 'Barbados Dollar',                    country: 'Barbados' },
  { code: 'BDT', name: 'Bangladeshi Taka',                   country: 'Bangladesh' },
  { code: 'BGN', name: 'Bulgarian Lev',                      country: 'Bulgaria' },
  { code: 'BHD', name: 'Bahraini Dinar',                     country: 'Bahrain' },
  { code: 'BIF', name: 'Burundian Franc',                    country: 'Burundi' },
  { code: 'BMD', name: 'Bermudian Dollar',                   country: 'Bermuda' },
  { code: 'BND', name: 'Brunei Dollar',                      country: 'Brunei' },
  { code: 'BOB', name: 'Bolivian Boliviano',                 country: 'Bolivia' },
  { code: 'BRL', name: 'Brazilian Real',                     country: 'Brazil' },
  { code: 'BSD', name: 'Bahamian Dollar',                    country: 'Bahamas' },
  { code: 'BTN', name: 'Bhutanese Ngultrum',                 country: 'Bhutan' },
  { code: 'BWP', name: 'Botswana Pula',                      country: 'Botswana' },
  { code: 'BYN', name: 'Belarusian Ruble',                   country: 'Belarus' },
  { code: 'BZD', name: 'Belize Dollar',                      country: 'Belize' },
  { code: 'CAD', name: 'Canadian Dollar',                    country: 'Canada' },
  { code: 'CDF', name: 'Congolese Franc',                    country: 'Democratic Republic of the Congo' },
  { code: 'CHF', name: 'Swiss Franc',                        country: 'Switzerland' },
  { code: 'CLF', name: 'Chilean Unidad de Fomento',          country: 'Chile' },
  { code: 'CLP', name: 'Chilean Peso',                       country: 'Chile' },
  { code: 'CNH', name: 'Offshore Chinese Renminbi',          country: 'China' },
  { code: 'CNY', name: 'Chinese Renminbi',                   country: 'China' },
  { code: 'COP', name: 'Colombian Peso',                     country: 'Colombia' },
  { code: 'CRC', name: 'Costa Rican Colon',                  country: 'Costa Rica' },
  { code: 'CUP', name: 'Cuban Peso',                         country: 'Cuba' },
  { code: 'CVE', name: 'Cape Verdean Escudo',                country: 'Cape Verde' },
  { code: 'CZK', name: 'Czech Koruna',                       country: 'Czech Republic' },
  { code: 'DJF', name: 'Djiboutian Franc',                   country: 'Djibouti' },
  { code: 'DKK', name: 'Danish Krone',                       country: 'Denmark' },
  { code: 'DOP', name: 'Dominican Peso',                     country: 'Dominican Republic' },
  { code: 'DZD', name: 'Algerian Dinar',                     country: 'Algeria' },
  { code: 'EGP', name: 'Egyptian Pound',                     country: 'Egypt' },
  { code: 'ERN', name: 'Eritrean Nakfa',                     country: 'Eritrea' },
  { code: 'ETB', name: 'Ethiopian Birr',                     country: 'Ethiopia' },
  { code: 'EUR', name: 'Euro',                               country: 'European Union' },
  { code: 'FJD', name: 'Fiji Dollar',                        country: 'Fiji' },
  { code: 'FKP', name: 'Falkland Islands Pound',             country: 'Falkland Islands' },
  { code: 'FOK', name: 'Faroese Króna',                      country: 'Faroe Islands' },
  { code: 'GBP', name: 'Pound Sterling',                     country: 'United Kingdom' },
  { code: 'GEL', name: 'Georgian Lari',                      country: 'Georgia' },
  { code: 'GGP', name: 'Guernsey Pound',                     country: 'Guernsey' },
  { code: 'GHS', name: 'Ghanaian Cedi',                      country: 'Ghana' },
  { code: 'GIP', name: 'Gibraltar Pound',                    country: 'Gibraltar' },
  { code: 'GMD', name: 'Gambian Dalasi',                     country: 'The Gambia' },
  { code: 'GNF', name: 'Guinean Franc',                      country: 'Guinea' },
  { code: 'GTQ', name: 'Guatemalan Quetzal',                 country: 'Guatemala' },
  { code: 'GYD', name: 'Guyanese Dollar',                    country: 'Guyana' },
  { code: 'HKD', name: 'Hong Kong Dollar',                   country: 'Hong Kong' },
  { code: 'HNL', name: 'Honduran Lempira',                   country: 'Honduras' },
  { code: 'HRK', name: 'Croatian Kuna',                      country: 'Croatia' },
  { code: 'HTG', name: 'Haitian Gourde',                     country: 'Haiti' },
  { code: 'HUF', name: 'Hungarian Forint',                   country: 'Hungary' },
  { code: 'IDR', name: 'Indonesian Rupiah',                  country: 'Indonesia' },
  { code: 'ILS', name: 'Israeli New Shekel',                 country: 'Israel' },
  { code: 'IMP', name: 'Manx Pound',                         country: 'Isle of Man' },
  { code: 'INR', name: 'Indian Rupee',                       country: 'India' },
  { code: 'IQD', name: 'Iraqi Dinar',                        country: 'Iraq' },
  { code: 'ISK', name: 'Icelandic Króna',                    country: 'Iceland' },
  { code: 'JEP', name: 'Jersey Pound',                       country: 'Jersey' },
  { code: 'JMD', name: 'Jamaican Dollar',                    country: 'Jamaica' },
  { code: 'JOD', name: 'Jordanian Dinar',                    country: 'Jordan' },
  { code: 'JPY', name: 'Japanese Yen',                       country: 'Japan' },
  { code: 'KES', name: 'Kenyan Shilling',                    country: 'Kenya' },
  { code: 'KGS', name: 'Kyrgyzstani Som',                    country: 'Kyrgyzstan' },
  { code: 'KHR', name: 'Cambodian Riel',                     country: 'Cambodia' },
  { code: 'KID', name: 'Kiribati Dollar',                    country: 'Kiribati' },
  { code: 'KMF', name: 'Comorian Franc',                     country: 'Comoros' },
  { code: 'KRW', name: 'South Korean Won',                   country: 'South Korea' },
  { code: 'KWD', name: 'Kuwaiti Dinar',                      country: 'Kuwait' },
  { code: 'KYD', name: 'Cayman Islands Dollar',              country: 'Cayman Islands' },
  { code: 'KZT', name: 'Kazakhstani Tenge',                  country: 'Kazakhstan' },
  { code: 'LAK', name: 'Lao Kip',                            country: 'Laos' },
  { code: 'LBP', name: 'Lebanese Pound',                     country: 'Lebanon' },
  { code: 'LKR', name: 'Sri Lanka Rupee',                    country: 'Sri Lanka' },
  { code: 'LRD', name: 'Liberian Dollar',                    country: 'Liberia' },
  { code: 'LSL', name: 'Lesotho Loti',                       country: 'Lesotho' },
  { code: 'LYD', name: 'Libyan Dinar',                       country: 'Libya' },
  { code: 'MAD', name: 'Moroccan Dirham',                    country: 'Morocco' },
  { code: 'MDL', name: 'Moldovan Leu',                       country: 'Moldova' },
  { code: 'MGA', name: 'Malagasy Ariary',                    country: 'Madagascar' },
  { code: 'MKD', name: 'Macedonian Denar',                   country: 'North Macedonia' },
  { code: 'MMK', name: 'Burmese Kyat',                       country: 'Myanmar' },
  { code: 'MNT', name: 'Mongolian Tögrög',                   country: 'Mongolia' },
  { code: 'MOP', name: 'Macanese Pataca',                    country: 'Macau' },
  { code: 'MRU', name: 'Mauritanian Ouguiya',                country: 'Mauritania' },
  { code: 'MUR', name: 'Mauritian Rupee',                    country: 'Mauritius' },
  { code: 'MVR', name: 'Maldivian Rufiyaa',                  country: 'Maldives' },
  { code: 'MWK', name: 'Malawian Kwacha',                    country: 'Malawi' },
  { code: 'MXN', name: 'Mexican Peso',                       country: 'Mexico' },
  { code: 'MYR', name: 'Malaysian Ringgit',                  country: 'Malaysia' },
  { code: 'MZN', name: 'Mozambican Metical',                 country: 'Mozambique' },
  { code: 'NAD', name: 'Namibian Dollar',                    country: 'Namibia' },
  { code: 'NGN', name: 'Nigerian Naira',                     country: 'Nigeria' },
  { code: 'NIO', name: 'Nicaraguan Córdoba',                 country: 'Nicaragua' },
  { code: 'NOK', name: 'Norwegian Krone',                    country: 'Norway' },
  { code: 'NPR', name: 'Nepalese Rupee',                     country: 'Nepal' },
  { code: 'NZD', name: 'New Zealand Dollar',                 country: 'New Zealand' },
  { code: 'OMR', name: 'Omani Rial',                         country: 'Oman' },
  { code: 'PAB', name: 'Panamanian Balboa',                  country: 'Panama' },
  { code: 'PEN', name: 'Peruvian Sol',                       country: 'Peru' },
  { code: 'PGK', name: 'Papua New Guinean Kina',             country: 'Papua New Guinea' },
  { code: 'PHP', name: 'Philippine Peso',                    country: 'Philippines' },
  { code: 'PKR', name: 'Pakistani Rupee',                    country: 'Pakistan' },
  { code: 'PLN', name: 'Polish Złoty',                       country: 'Poland' },
  { code: 'PYG', name: 'Paraguayan Guaraní',                 country: 'Paraguay' },
  { code: 'QAR', name: 'Qatari Riyal',                       country: 'Qatar' },
  { code: 'RON', name: 'Romanian Leu',                       country: 'Romania' },
  { code: 'RSD', name: 'Serbian Dinar',                      country: 'Serbia' },
  { code: 'RUB', name: 'Russian Ruble',                      country: 'Russia' },
  { code: 'RWF', name: 'Rwandan Franc',                      country: 'Rwanda' },
  { code: 'SAR', name: 'Saudi Riyal',                        country: 'Saudi Arabia' },
  { code: 'SBD', name: 'Solomon Islands Dollar',             country: 'Solomon Islands' },
  { code: 'SCR', name: 'Seychellois Rupee',                  country: 'Seychelles' },
  { code: 'SDG', name: 'Sudanese Pound',                     country: 'Sudan' },
  { code: 'SEK', name: 'Swedish Krona',                      country: 'Sweden' },
  { code: 'SGD', name: 'Singapore Dollar',                   country: 'Singapore' },
  { code: 'SHP', name: 'Saint Helena Pound',                 country: 'Saint Helena' },
  { code: 'SLE', name: 'Sierra Leonean Leone',               country: 'Sierra Leone' },
  { code: 'SOS', name: 'Somali Shilling',                    country: 'Somalia' },
  { code: 'SRD', name: 'Surinamese Dollar',                  country: 'Suriname' },
  { code: 'SSP', name: 'South Sudanese Pound',               country: 'South Sudan' },
  { code: 'STN', name: 'São Tomé and Príncipe Dobra',        country: 'São Tomé and Príncipe' },
  { code: 'SYP', name: 'Syrian Pound',                       country: 'Syria' },
  { code: 'SZL', name: 'Eswatini Lilangeni',                 country: 'Eswatini' },
  { code: 'THB', name: 'Thai Baht',                          country: 'Thailand' },
  { code: 'TJS', name: 'Tajikistani Somoni',                 country: 'Tajikistan' },
  { code: 'TMT', name: 'Turkmenistan Manat',                 country: 'Turkmenistan' },
  { code: 'TND', name: 'Tunisian Dinar',                     country: 'Tunisia' },
  { code: 'TOP', name: 'Tongan Paʻanga',                     country: 'Tonga' },
  { code: 'TRY', name: 'Turkish Lira',                       country: 'Turkey' },
  { code: 'TTD', name: 'Trinidad and Tobago Dollar',         country: 'Trinidad and Tobago' },
  { code: 'TVD', name: 'Tuvaluan Dollar',                    country: 'Tuvalu' },
  { code: 'TWD', name: 'New Taiwan Dollar',                  country: 'Taiwan' },
  { code: 'TZS', name: 'Tanzanian Shilling',                 country: 'Tanzania' },
  { code: 'UAH', name: 'Ukrainian Hryvnia',                  country: 'Ukraine' },
  { code: 'UGX', name: 'Ugandan Shilling',                   country: 'Uganda' },
  { code: 'USD', name: 'United States Dollar',               country: 'United States' },
  { code: 'UYU', name: 'Uruguayan Peso',                     country: 'Uruguay' },
  { code: 'UZS', name: "Uzbekistani So'm",                   country: 'Uzbekistan' },
  { code: 'VES', name: 'Venezuelan Bolívar Soberano',        country: 'Venezuela' },
  { code: 'VND', name: 'Vietnamese Đồng',                    country: 'Vietnam' },
  { code: 'VUV', name: 'Vanuatu Vatu',                       country: 'Vanuatu' },
  { code: 'WST', name: 'Samoan Tālā',                        country: 'Samoa' },
  { code: 'XAF', name: 'Central African CFA Franc',          country: 'CEMAC' },
  { code: 'XCD', name: 'East Caribbean Dollar',              country: 'Organisation of Eastern Caribbean States' },
  { code: 'XDR', name: 'Special Drawing Rights',             country: 'International Monetary Fund' },
  { code: 'XOF', name: 'West African CFA franc',             country: 'CFA' },
  { code: 'XPF', name: 'CFP Franc',                          country: "Collectivités d'Outre-Mer" },
  { code: 'YER', name: 'Yemeni Rial',                        country: 'Yemen' },
  { code: 'ZAR', name: 'South African Rand',                 country: 'South Africa' },
  { code: 'ZMW', name: 'Zambian Kwacha',                     country: 'Zambia' },
  { code: 'ZWL', name: 'Zimbabwean Dollar',                  country: 'Zimbabwe' },
];
