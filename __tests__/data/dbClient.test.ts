/**
 * getDb — opens the app database once and hands out the same connection afterwards.
 */
const mockOpen = jest.fn();
jest.mock('expo-sqlite', () => ({ openDatabaseSync: (...a: any[]) => mockOpen(...a) }));

describe('getDb', () => {
  let getDb: typeof import('@/db/client').getDb;
  beforeEach(() => {
    jest.resetModules(); // the connection is cached in module state — start each test without one
    mockOpen.mockReset();
    mockOpen.mockImplementation(() => ({ name: 'fake connection' }));
    getDb = require('@/db/client').getDb;
  });

  it('opens ridezen.db on first use', () => {
    const db = getDb();
    expect(mockOpen).toHaveBeenCalledWith('ridezen.db');
    expect(db).toEqual({ name: 'fake connection' });
  });

  it('does not open it again — the same connection is reused', () => {
    const first = getDb();
    const second = getDb();
    expect(second).toBe(first);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('does not open anything until it is needed', () => {
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('retries on the next call if opening failed (nothing broken is cached)', () => {
    mockOpen.mockImplementationOnce(() => {
      throw new Error('cannot open');
    });
    expect(() => getDb()).toThrow('cannot open');
    expect(getDb()).toEqual({ name: 'fake connection' });
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });
});
