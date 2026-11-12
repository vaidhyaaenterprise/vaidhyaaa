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

    expect(screen.queryByText(/^english$/i)).not.toBeInTheDocument();
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

  it('hides unanswered entries and selects only answered, applicable entries', async () => {
    const onBulkApprove = vi.fn().mockResolvedValue({
      approvedIds: ['ready'],
      skippedIds: [],
    });

    render(
      <ReviewQueue
        entries={[
          { ...entry('ready'), applicable: true },
          { ...entry('unanswered'), answer: '', applicable: true },
          { ...entry('whitespace'), answer: '   \n\t', applicable: true },
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
    expect(screen.queryByText('Question unanswered')).not.toBeInTheDocument();
    expect(screen.queryByText('Question whitespace')).not.toBeInTheDocument();
    expect(screen.getByText('Question ready')).toBeInTheDocument();
    expect(screen.getByText('Question inactive')).toBeInTheDocument();
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[0]).toBeEnabled();
    expect(checkboxes[1]).not.toBeChecked();
    expect(checkboxes[1]).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (1)' }));
    await waitFor(() => expect(onBulkApprove).toHaveBeenCalledWith(['ready']));
  });

  it('shows an empty review queue when every entry is unanswered', () => {
    render(
      <ReviewQueue
        entries={[
          { ...entry('empty'), answer: '' },
          { ...entry('whitespace'), answer: '   ' },
          { ...entry('missing'), answer: undefined as unknown as string },
        ]}
        categories={categories}
        onApprove={vi.fn()}
        onBulkApprove={vi.fn()}
        onEdit={vi.fn()}
        onDisable={vi.fn()}
      />,
    );

    expect(screen.getByText('No pending entries to review')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument();
  });

  it('keeps rendering after save when a mixed-version mutation row omits alternative phrases', () => {
    const onEdit = vi.fn();
    const sharedProps = {
      categories,
      onApprove: vi.fn(),
      onBulkApprove: vi.fn(),
      onDisable: vi.fn(),
    };
    const { rerender } = render(
      <ReviewQueue entries={[entry('one')]} {...sharedProps} onEdit={onEdit} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByDisplayValue('Answer one'), {
      target: { value: 'Updated answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onEdit).toHaveBeenCalledWith(
      'one',
      expect.objectContaining({ answer: 'Updated answer' }),
    );

    rerender(
      <ReviewQueue
        entries={[
          {
            ...entry('one'),
            answer: 'Updated answer',
            // Older PATCH responses exposed `alternativePhrasesJson` instead of
            // the UI model's `alternativePhrases`; keep the render boundary safe
            // while API and web deployments roll independently.
            alternativePhrases: undefined as unknown as string[],
          },
        ]}
        {...sharedProps}
        onEdit={onEdit}
      />,
    );

    expect(screen.getByText('Updated answer')).toBeInTheDocument();
    expect(screen.queryByText('Alternative phrases:')).not.toBeInTheDocument();
  });
});
