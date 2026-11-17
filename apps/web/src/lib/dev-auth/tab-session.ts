const TAB_ID_KEY = 'vaidhyaa_tab_session_id';

/**
 * Each document gets its own ownership marker. Browser-duplicated tabs inherit
 * sessionStorage by design, so they keep the verified login but rotate the
 * marker when the source tab still owns it. The authentication layer then
 * reconciles every tab with the browser-wide verified session envelope.
 */
export function createTabSessionManager(browser: Window) {
  let pending: Promise<void> | null = null;
  let releaseLock: (() => void) | null = null;
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
        let id = browser.sessionStorage.getItem(TAB_ID_KEY) ?? newId();
        browser.sessionStorage.setItem(TAB_ID_KEY, id);
        if (!browser.navigator.locks?.request) {
          return;
        }
        if (!(await claim(id))) {
          id = newId();
          browser.sessionStorage.setItem(TAB_ID_KEY, id);
          await claim(id);
        }
      } catch {
        // AuthProvider still validates the inherited token/profile with /me.
        // A tab identity failure must not discard an otherwise valid login.
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
