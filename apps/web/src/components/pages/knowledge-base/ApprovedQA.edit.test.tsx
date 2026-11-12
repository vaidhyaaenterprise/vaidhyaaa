import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApprovedQA } from './ApprovedQA';
import type { KnowledgeEntry } from './types';

const entry: KnowledgeEntry = {
  id: 'approved-one',
  question: 'Is UPI accepted?',
  answer: 'Yes, UPI is accepted.',
  category: 'parking',
  alternativePhrases: [],
  status: 'approved',
  language: 'english',
  source: 'manual',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const categories = [{ id: 'parking', name: 'Parking', description: 'Parking and payments' }];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderApproved(onEdit: (id: string, update: Partial<KnowledgeEntry>) => Promise<void>) {
  render(
    <ApprovedQA entries={[entry]} categories={categories} onEdit={onEdit} onDisable={vi.fn()} />,
  );
}

afterEach(cleanup);

describe('ApprovedQA edit save', () => {
  it('waits for the save and prevents duplicate submissions', async () => {
    const save = deferred<void>();
    const onEdit = vi.fn(() => save.promise);
    renderApproved(onEdit);

    expect(screen.queryByText(/^english$/i)).not.toBeInTheDocument();
    expect(screen.getByText('Updated 01/10/2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getAllByRole('textbox')[1]!, {
      target: { value: 'Yes, you can.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledWith(
      entry.id,
      expect.objectContaining({ answer: 'Yes, you can.' }),
    );
    const savingButton = screen.getByRole('button', { name: 'Saving...' });
    expect(savingButton).toBeDisabled();
    fireEvent.click(savingButton);
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.getByDisplayValue('Yes, you can.')).toBeInTheDocument();

    save.resolve();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
  });

  it('keeps the editor open and shows an inline error when saving fails', async () => {
    const onEdit = vi.fn().mockRejectedValue(new Error('Unable to save the approved answer.'));
    renderApproved(onEdit);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getAllByRole('textbox')[1]!, {
      target: { value: 'Yes, you can.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to save the approved answer.',
    );
    expect(screen.getByDisplayValue('Yes, you can.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
