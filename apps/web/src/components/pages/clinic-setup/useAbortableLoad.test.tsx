import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

import { useAbortableLoad } from './useAbortableLoad';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function GuardHarness({
  contextKey,
  firstStep,
  secondStep,
}: {
  contextKey: string;
  firstStep: () => Promise<void>;
  secondStep: () => void;
}) {
  const { isActive } = useAbortableLoad(contextKey);
  const [status, setStatus] = useState('idle');

  const run = async () => {
    setStatus('waiting');
    await firstStep();
    if (!isActive()) {
      return;
    }
    secondStep();
    setStatus('done');
  };

  return (
    <button type="button" onClick={() => void run()}>
      {status}
    </button>
  );
}

afterEach(cleanup);

describe('useAbortableLoad context guard', () => {
  it('keeps an old action inactive after switching away from and back to the same key', async () => {
    const firstStep = deferred<void>();
    const secondStep = vi.fn();
    const runFirstStep = () => firstStep.promise;

    const { rerender } = render(
      <GuardHarness contextKey="clinic-a" firstStep={runFirstStep} secondStep={secondStep} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'idle' }));

    rerender(
      <GuardHarness contextKey="clinic-b" firstStep={runFirstStep} secondStep={secondStep} />,
    );
    rerender(
      <GuardHarness contextKey="clinic-a" firstStep={runFirstStep} secondStep={secondStep} />,
    );

    await act(async () => {
      firstStep.resolve();
      await firstStep.promise;
    });

    expect(secondStep).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'waiting' })).toBeInTheDocument();
  });
});
