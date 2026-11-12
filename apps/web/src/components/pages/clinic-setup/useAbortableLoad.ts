'use client';

import { useCallback, useEffect, useRef } from 'react';

export type AbortableLoad = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

export function useAbortableLoad(contextKey: string) {
  const mountedRef = useRef(false);
  const activeContextRef = useRef({ key: contextKey });
  const controllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);

  if (activeContextRef.current.key !== contextKey) {
    activeContextRef.current = { key: contextKey };
  }
  const context = activeContextRef.current;

  const isActive = useCallback(
    () => mountedRef.current && activeContextRef.current === context,
    [context],
  );

  const cancelLoad = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    sequenceRef.current += 1;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelLoad();
    };
  }, [cancelLoad]);

  const beginLoad = useCallback((): AbortableLoad | null => {
    if (!isActive()) {
      return null;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const sequence = ++sequenceRef.current;

    return {
      signal: controller.signal,
      isCurrent: () => isActive() && !controller.signal.aborted && sequenceRef.current === sequence,
    };
  }, [isActive]);

  return { beginLoad, cancelLoad, isActive };
}
