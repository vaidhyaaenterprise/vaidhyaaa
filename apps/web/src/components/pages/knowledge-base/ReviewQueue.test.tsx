import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewQueue } from './ReviewQueue';
import type { KnowledgeEntry } from './types';

const entry = (id: string): KnowledgeEntry => ({
  id,
  question: `Question ${id}`,
  answer: `Answer ${id}`,
  category: 'general',
  alternativePhrases: [],
  status: 'pending_review',
  language: 'english',
  source: 'manual',
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
});

const categories = [{ id: 'general', name: 'General FAQ', description: 'General FAQs' }];

afterEach(cleanup);

describe('ReviewQueue bulk approval', () => {
  it('waits for the bulk request and prevents duplicate submissions', async () => {
    let finishApproval: (() => void) | undefined;
    const onBulkApprove = vi.fn(
      () =>
        new Promise<{ approvedIds: string[]; skippedIds: string[] }>((resolve) => {
          finishApproval = () => resolve({ approvedIds: ['one', 'two'], skippedIds: [] });
        }),
    );

    render(
      <ReviewQueue
        entries={[entry('one'), entry('two')]}
        categories={categories}
        onApprove={vi.fn()}
        onBulkApprove={onBulkApprove}
        onEdit={vi.fn()}
        onDisable={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (2)' }));

    expect(onBulkApprove).toHaveBeenCalledOnce();
    expect(onBulkApprove).toHaveBeenCalledWith(['one', 'two']);
    const busyButton = screen.getByRole('button', { name: 'Approving 2...' });
    expect(busyButton).toBeDisabled();
    fireEvent.click(busyButton);
    expect(onBulkApprove).toHaveBeenCalledOnce();

    finishApproval?.();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Approve selected/ })).not.toBeInTheDocument();
    });
  });

  it('keeps entries selected when bulk approval fails so they can be retried', async () => {
    const onBulkApprove = vi.fn().mockRejectedValue(new Error('API failed'));

    render(
      <ReviewQueue
        entries={[entry('one'), entry('two')]}
        categories={categories}
        onApprove={vi.fn()}
        onBulkApprove={onBulkApprove}
        onEdit={vi.fn()}
        onDisable={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (2)' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve selected (2)' })).toBeEnabled();
    });
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    checkboxes.forEach((checkbox) => expect(checkbox).toBeChecked());
  });

  it('clears approved entries but keeps skipped entries selected', async () => {
    const onBulkApprove = vi.fn().mockResolvedValue({
      approvedIds: ['one'],
      skippedIds: ['two'],
    });

    const { rerender } = render(
      <ReviewQueue
        entries={[entry('one'), entry('two')]}
        categories={categories}
        onApprove={vi.fn()}
        onBulkApprove={onBulkApprove}
        onEdit={vi.fn()}
        onDisable={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (2)' }));
    rerender(
      <ReviewQueue
        entries={[entry('two')]}
        categories={categories}
        onApprove={vi.fn()}
        onBulkApprove={onBulkApprove}
        onEdit={vi.fn()}
        onDisable={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve selected (1)' })).toBeEnabled();
    });
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('selects only completed, applicable entries for bulk approval', async () => {
    const onBulkApprove = vi.fn().mockResolvedValue({
      approvedIds: ['ready'],
      skippedIds: [],
    });

    render(
      <ReviewQueue
        entries={[
          { ...entry('ready'), applicable: true },
          { ...entry('unanswered'), answer: '', applicable: true },
          { ...entry('inactive'), applicable: false },
        ]}
        categories={categories}
        onApprove={vi.fn()}
        onBulkApprove={onBulkApprove}
        onEdit={vi.fn()}
        onDisable={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[0]).toBeEnabled();
    expect(checkboxes[1]).not.toBeChecked();
    expect(checkboxes[1]).toBeDisabled();
    expect(checkboxes[2]).not.toBeChecked();
    expect(checkboxes[2]).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (1)' }));
    await waitFor(() => expect(onBulkApprove).toHaveBeenCalledWith(['ready']));
  });
});
