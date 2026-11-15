import { AUTH_TOKEN_STORAGE_KEY, DEV_AUTH_STORAGE_KEY } from './constants';

const TAB_ID_KEY = 'vaidhyaa_tab_session_id';

/** Each document claims ownership before using reload-restored credentials. */
export function createTabSessionManager(browser: Window) {
  let pending: Promise<void> | null = null;
  let initializedOnce = false;
  let releaseLock: (() => void) | null = null;
  const clearCredentials = () => {
    try {
      browser.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      browser.sessionStorage.removeItem(DEV_AUTH_STORAGE_KEY);
    } catch {
      /* Storage readers fail closed. */
    }
  };
  const newId = () => browser.crypto.randomUUID();
  const claim = (id: string): Promise<boolean> =>
    new Promise((resolve) => {
      void browser.navigator.locks
        .request(
          `vaidhyaa-auth-tab:${id}`,
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            if (!lock) {
              resolve(false);
              return;
            }
            await new Promise<void>((release) => {
              releaseLock = release;
              resolve(true);
            });
          },
        )
        .catch(() => resolve(false));
    });
  const initialize = (): Promise<void> => {
    if (pending) return pending;
    pending = (async () => {
      try {
        const navigation = browser.performance.getEntriesByType('navigation')[0] as
          | PerformanceNavigationTiming
          | undefined;
        // New/duplicated tabs can inherit sessionStorage. Only a reload may
        // restore another document's login. SPA/BFCache retain this manager.
        if (!initializedOnce && navigation?.type !== 'reload') clearCredentials();
        initializedOnce = true;
        let id = browser.sessionStorage.getItem(TAB_ID_KEY) ?? newId();
        browser.sessionStorage.setItem(TAB_ID_KEY, id);
        if (!browser.navigator.locks?.request) {
          clearCredentials();
          return;
        }
        if (!(await claim(id))) {
          clearCredentials();
          id = newId();
          browser.sessionStorage.setItem(TAB_ID_KEY, id);
          await claim(id);
        }
      } catch {
        clearCredentials();
      }
    })();
    return pending;
  };
  const onPageHide = () => {
    releaseLock?.();
    releaseLock = null;
    pending = null;
  };
  browser.addEventListener('pagehide', onPageHide);
  return {
    initialize,
    dispose() {
      onPageHide();
      browser.removeEventListener('pagehide', onPageHide);
    },
  };
}

let manager: ReturnType<typeof createTabSessionManager> | null = null;
export function initializeTabSession(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  manager ??= createTabSessionManager(window);
  return manager.initialize();
}
