import { describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_STORAGE_KEY, DEV_AUTH_STORAGE_KEY } from './constants';
import { createTabSessionManager } from './tab-session';

const TAB_ID_KEY = 'vaidhyaa_tab_session_id';

function memoryStorage(source?: Storage): Storage {
  const values = new Map<string, string>();
  if (source)
    for (let i = 0; i < source.length; i++) {
      const key = source.key(i)!;
      values.set(key, source.getItem(key)!);
    }
  return {
    get length() {
      return values.size;
    },
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}
function harness() {
  const owned = new Set<string>();
  let nextId = 0;
  const request = vi.fn(
    async (name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
      if (owned.has(name)) return callback(null);
      owned.add(name);
      try {
        await callback({ name });
      } finally {
        owned.delete(name);
      }
    },
  );
  function tab(type: string, storage = memoryStorage(), withLocks = true) {
    const events = new EventTarget();
    const browser = {
      sessionStorage: storage,
      performance: { getEntriesByType: () => [{ type }] },
      crypto: { randomUUID: () => `tab-${++nextId}` },
      navigator: withLocks ? { locks: { request } } : {},
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    } as unknown as Window;
    return { storage, browser, manager: createTabSessionManager(browser), events };
  }
  return { tab, request };
}
function signIn(storage: Storage, role: string) {
  storage.setItem(AUTH_TOKEN_STORAGE_KEY, `${role}-token`);
  storage.setItem(DEV_AUTH_STORAGE_KEY, role);
}

describe('tab session ownership', () => {
  it('preserves copied credentials on a duplicated tab and assigns independent ownership', async () => {
    const { tab } = harness();
    const source = tab('navigate');
    await source.manager.initialize();
    signIn(source.storage, 'doctor');
    const duplicate = tab('navigate', memoryStorage(source.storage));
    await duplicate.manager.initialize();
    expect(duplicate.storage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('doctor-token');
    expect(duplicate.storage.getItem(DEV_AUTH_STORAGE_KEY)).toBe('doctor');
    expect(duplicate.storage.getItem(TAB_ID_KEY)).not.toBe(source.storage.getItem(TAB_ID_KEY));
    duplicate.storage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    expect(source.storage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('doctor-token');
    source.manager.dispose();
    duplicate.manager.dispose();
  });
  it.each(['reload', 'back_forward'])(
    'preserves inherited credentials but rotates an owned ID when a duplicate reports %s',
    async (type) => {
      const { tab } = harness();
      const source = tab('navigate');
      await source.manager.initialize();
      signIn(source.storage, 'doctor');
      const duplicate = tab(type, memoryStorage(source.storage));
      await duplicate.manager.initialize();
      expect(duplicate.storage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('doctor-token');
      expect(duplicate.storage.getItem(DEV_AUTH_STORAGE_KEY)).toBe('doctor');
      expect(duplicate.storage.getItem(TAB_ID_KEY)).not.toBe(source.storage.getItem(TAB_ID_KEY));
      signIn(duplicate.storage, 'admin');
      expect(source.storage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('doctor-token');
      duplicate.storage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      expect(source.storage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('doctor-token');
      source.manager.dispose();
      duplicate.manager.dispose();
    },
  );
  it('preserves the owning tab session on a reload after releasing the previous document', async () => {
    const { tab } = harness();
    const source = tab('navigate');
    await source.manager.initialize();
    signIn(source.storage, 'doctor');
    source.manager.dispose();
    await Promise.resolve();
    await Promise.resolve();
    const reloaded = tab('reload', source.storage);
    await reloaded.manager.initialize();
    expect(reloaded.storage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('doctor-token');
    expect(reloaded.storage.getItem(DEV_AUTH_STORAGE_KEY)).toBe('doctor');
    reloaded.manager.dispose();
  });
  it('coalesces repeated initialization and reacquires on a BFCache return without changing the session', async () => {
    const { tab, request } = harness();
    const source = tab('navigate');
    await Promise.all([source.manager.initialize(), source.manager.initialize()]);
    signIn(source.storage, 'doctor');
    expect(request).toHaveBeenCalledOnce();
    source.events.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    await Promise.resolve();
    await source.manager.initialize();
    expect(source.storage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('doctor-token');
    expect(request).toHaveBeenCalledTimes(2);
    source.manager.dispose();
  });
  it('preserves restored credentials when the Web Locks API is unavailable', async () => {
    const { tab } = harness();
    const storage = memoryStorage();
    signIn(storage, 'doctor');
    const source = tab('reload', storage, false);
    await source.manager.initialize();
    expect(storage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('doctor-token');
    expect(storage.getItem(DEV_AUTH_STORAGE_KEY)).toBe('doctor');
    expect(storage.getItem(TAB_ID_KEY)).toBeTruthy();
    source.manager.dispose();
  });
});
