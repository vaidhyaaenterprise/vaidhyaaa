import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualQAForm } from './ManualQAForm';
import {
  fetchManualKnowledgeTemplate,
  importManualKnowledgeTemplate,
  type ManualTemplateApiResponse,
} from '@/lib/api/knowledge';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_CLINIC_ID = '00000000-0000-0000-0000-000000000002';
let activeClinicId: string | null = CLINIC_ID;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const EMPTY_TEMPLATE: ManualTemplateApiResponse = {
  source: 'manual-template',
  sections: [],
  summary: {
    total: 0,
    completed: 0,
    approved: 0,
    pending: 0,
    not_applicable: 0,
  },
};

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => activeClinicId,
}));

vi.mock('@/lib/api/knowledge', () => ({
  createManualKnowledgeEntry: vi.fn(),
  fetchManualKnowledgeTemplate: vi.fn(),
  importManualKnowledgeTemplate: vi.fn(),
  patchKnowledgeEntry: vi.fn(),
}));

const mockedFetchTemplate = vi.mocked(fetchManualKnowledgeTemplate);
const mockedImportTemplate = vi.mocked(importManualKnowledgeTemplate);

beforeEach(() => {
  activeClinicId = CLINIC_ID;
  mockedFetchTemplate.mockReset().mockResolvedValue(EMPTY_TEMPLATE);
  mockedImportTemplate.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ManualQAForm clinic context', () => {
  it('does not publish an import result after the active clinic changes', async () => {
    const importResult = deferred<{ imported: number; existing: number }>();
    const onSaved = vi.fn();
    mockedImportTemplate.mockImplementation(() => importResult.promise);

    const { rerender } = render(
      <ManualQAForm isOpen onClose={vi.fn()} categories={[]} onSaved={onSaved} />,
    );

    await waitFor(() => expect(mockedFetchTemplate).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Import Template Rows' }));
    expect(mockedImportTemplate).toHaveBeenCalledOnce();

    activeClinicId = OTHER_CLINIC_ID;
    rerender(<ManualQAForm isOpen onClose={vi.fn()} categories={[]} onSaved={onSaved} />);
    await waitFor(() => expect(mockedFetchTemplate).toHaveBeenCalledTimes(2));

    await act(async () => {
      importResult.resolve({ imported: 4, existing: 1 });
      await importResult.promise;
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByText(/Template import completed/)).not.toBeInTheDocument();
  });
});
