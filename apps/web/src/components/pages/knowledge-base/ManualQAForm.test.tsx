import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualQAForm } from './ManualQAForm';
import {
  createManualKnowledgeSection,
  fetchManualKnowledgeTemplate,
  patchKnowledgeEntry,
  removeManualKnowledgeQuestion,
  removeManualKnowledgeSection,
  updateManualKnowledgeSection,
  type KnowledgeEntryApiRow,
  type ManualTemplateApiResponse,
  type ManualTemplateQuestionApiRow,
} from '@/lib/api/knowledge';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const KNOWLEDGE_ID = '00000000-0000-0000-0000-000000000501';
const SECOND_KNOWLEDGE_ID = '00000000-0000-0000-0000-000000000502';
const THIRD_KNOWLEDGE_ID = '00000000-0000-0000-0000-000000000503';
let activeClinicId: string | null = CLINIC_ID;

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
  createManualKnowledgeSection: vi.fn(),
  createManualKnowledgeEntry: vi.fn(),
  fetchManualKnowledgeTemplate: vi.fn(),
  patchKnowledgeEntry: vi.fn(),
  removeManualKnowledgeQuestion: vi.fn(),
  removeManualKnowledgeSection: vi.fn(),
  updateManualKnowledgeSection: vi.fn(),
}));

const mockedCreateSection = vi.mocked(createManualKnowledgeSection);
const mockedFetchTemplate = vi.mocked(fetchManualKnowledgeTemplate);
const mockedPatchKnowledgeEntry = vi.mocked(patchKnowledgeEntry);
const mockedRemoveQuestion = vi.mocked(removeManualKnowledgeQuestion);
const mockedRemoveSection = vi.mocked(removeManualKnowledgeSection);
const mockedUpdateSection = vi.mocked(updateManualKnowledgeSection);

function templateQuestion(
  overrides: Partial<ManualTemplateQuestionApiRow> = {},
): ManualTemplateQuestionApiRow {
  return {
    id: KNOWLEDGE_ID,
    clinic_id: CLINIC_ID,
    question: 'Is UPI accepted?',
    answer: 'Yes, UPI payments are accepted.',
    category: 'payment',
    alternative_phrases_json: [],
    template_key: 'payment::Is UPI accepted?',
    section_key: 'payment',
    source_notes: 'Use the payment policy approved by the clinic.',
    service_name: null,
    applicable: false,
    qa_approved: false,
    status: 'disabled',
    source_file: 'Vaidya Clinic Knowledge Base Q&A Template',
    source_page: null,
    embedding_status: 'not_required',
    embedding_model: null,
    embedding_generated_at: null,
    search_text: null,
    approved_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    exists: true,
    service_name_required: false,
    ui_status: 'inactive',
    ...overrides,
  };
}

function knowledgeRow(overrides: Partial<KnowledgeEntryApiRow> = {}): KnowledgeEntryApiRow {
  const {
    exists: _exists,
    service_name_required: _required,
    ui_status: _uiStatus,
    ...row
  } = templateQuestion();
  return {
    ...row,
    ...overrides,
  };
}

beforeEach(() => {
  activeClinicId = CLINIC_ID;
  mockedFetchTemplate.mockReset().mockResolvedValue(EMPTY_TEMPLATE);
  mockedPatchKnowledgeEntry.mockReset();
  mockedCreateSection.mockReset();
  mockedRemoveQuestion.mockReset();
  mockedRemoveSection.mockReset();
  mockedUpdateSection.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ManualQAForm activation and approval', () => {
  it('adds and removes questions inside the selected section', async () => {
    mockedFetchTemplate.mockResolvedValue({
      source: 'manual-template',
      sections: [
        {
          key: 'payment',
          title: 'Payment',
          questions: [
            templateQuestion({
              exists: false,
              applicable: true,
              status: 'needs_update',
              ui_status: 'draft',
            }),
          ],
        },
      ],
      summary: {
        total: 1,
        completed: 1,
        approved: 0,
        pending: 1,
        not_applicable: 0,
      },
    });
    mockedRemoveQuestion.mockResolvedValue({
      result: { removed: true, knowledge_id: KNOWLEDGE_ID },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <ManualQAForm
        isOpen
        onClose={vi.fn()}
        categories={[{ id: 'payment', name: 'Payment', description: 'Payment policies' }]}
      />,
    );

    expect(await screen.findByRole('button', { name: '+ Add question' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Custom Q&A/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Medical advice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/duplicates are checked/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove question' }));
    await waitFor(() => expect(mockedRemoveQuestion).toHaveBeenCalledWith(KNOWLEDGE_ID));
    expect(screen.queryByDisplayValue('Is UPI accepted?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Add question' }));
    expect(screen.getByText('New row')).toBeInTheDocument();
    expect(screen.getByText('Question removed successfully.')).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('adds, renames, and removes a clinic-defined section', async () => {
    mockedFetchTemplate.mockResolvedValue({
      source: 'manual-template',
      sections: [{ key: 'custom', title: 'Custom Q&A', is_custom: true, questions: [] }],
      summary: {
        total: 0,
        completed: 0,
        approved: 0,
        pending: 0,
        not_applicable: 0,
      },
    });
    mockedCreateSection.mockResolvedValue({
      key: 'custom_billing_12345678',
      title: 'Billing Details',
      is_custom: true,
      questions: [],
    });
    mockedUpdateSection.mockResolvedValue({
      key: 'custom_billing_12345678',
      title: 'Billing and Receipts',
      is_custom: true,
    });
    mockedRemoveSection.mockResolvedValue({
      result: { removed: true, section_key: 'custom_billing_12345678' },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <ManualQAForm
        isOpen
        onClose={vi.fn()}
        categories={[{ id: 'billing', name: 'Billing', description: 'Billing policies' }]}
      />,
    );

    await screen.findByRole('heading', { name: 'Custom Q&A' });
    fireEvent.click(screen.getByRole('button', { name: '+ Add section' }));
    fireEvent.change(screen.getByLabelText('Section name'), {
      target: { value: 'Billing Details' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('heading', { name: 'Billing Details' })).toBeInTheDocument();
    expect(mockedCreateSection).toHaveBeenCalledWith('Billing Details');

    fireEvent.click(screen.getByRole('button', { name: 'Rename section' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Section name' }), {
      target: { value: 'Billing and Receipts' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(
      await screen.findByRole('heading', { name: 'Billing and Receipts' }),
    ).toBeInTheDocument();
    expect(mockedUpdateSection).toHaveBeenCalledWith(
      'custom_billing_12345678',
      'Billing and Receipts',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove section' }));
    await waitFor(() =>
      expect(mockedRemoveSection).toHaveBeenCalledWith('custom_billing_12345678'),
    );
    expect(screen.queryByRole('heading', { name: 'Billing and Receipts' })).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it('requires an approved question to be disabled and saved before removal', async () => {
    mockedFetchTemplate.mockResolvedValue({
      source: 'manual-template',
      sections: [
        {
          key: 'payment',
          title: 'Payment',
          questions: [
            templateQuestion({
              applicable: true,
              qa_approved: true,
              status: 'approved',
              ui_status: 'approved',
            }),
          ],
        },
      ],
      summary: {
        total: 1,
        completed: 1,
        approved: 1,
        pending: 0,
        not_applicable: 0,
      },
    });

    render(
      <ManualQAForm
        isOpen
        onClose={vi.fn()}
        categories={[{ id: 'payment', name: 'Payment', description: 'Payment policies' }]}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Remove question' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove section' })).toBeDisabled();
    expect(screen.getByText('Make inactive and save before removal.')).toBeInTheDocument();
    expect(mockedRemoveQuestion).not.toHaveBeenCalled();
    expect(mockedRemoveSection).not.toHaveBeenCalled();
  });

  it('reactivates an inactive question and lists it under the selected section after approval', async () => {
    mockedFetchTemplate.mockResolvedValue({
      source: 'manual-template',
      sections: [
        {
          key: 'payment',
          title: 'Payment',
          questions: [templateQuestion()],
        },
      ],
      summary: {
        total: 1,
        completed: 1,
        approved: 0,
        pending: 0,
        not_applicable: 1,
      },
    });
    mockedPatchKnowledgeEntry.mockResolvedValue(
      knowledgeRow({
        applicable: true,
        qa_approved: true,
        status: 'approved',
        embedding_status: 'generated',
        embedding_model: 'gemini-embedding-001',
        embedding_dimensions: 1024,
        search_text: 'Category: payment Question: Is UPI accepted? Answer: Yes',
        approved_at: '2026-10-06T12:00:00.000Z',
      }),
    );
    const onSaved = vi.fn();

    render(
      <ManualQAForm
        isOpen
        onClose={vi.fn()}
        categories={[{ id: 'payment', name: 'Payment', description: 'Payment policies' }]}
        onSaved={onSaved}
      />,
    );

    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import Template Rows' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Approved questions in Payment' })).getByText(
        'No approved questions in this section yet.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Source Notes/i)).not.toBeInTheDocument();

    const serviceSelect = screen.getByRole('combobox', { name: /Service Name/i });
    expect(
      within(serviceSelect).getByRole('option', { name: 'General Consultation' }),
    ).toBeInTheDocument();
    fireEvent.change(serviceSelect, { target: { value: 'Dental Consultation' } });

    fireEvent.click(screen.getByRole('button', { name: 'Make active' }));
    expect(screen.getByText('Draft')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save & Approve Edited \(1\)/ }));

    await waitFor(() => {
      expect(mockedPatchKnowledgeEntry).toHaveBeenCalledWith(
        KNOWLEDGE_ID,
        expect.objectContaining({
          applicable: true,
          qa_approved: true,
          status: 'approved',
          service_name: 'Dental Consultation',
        }),
        CLINIC_ID,
      );
    });
    expect(mockedPatchKnowledgeEntry.mock.calls[0]?.[1]).not.toHaveProperty('source_notes');
    const approvedRegion = screen.getByRole('region', {
      name: 'Approved questions in Payment',
    });
    expect(
      within(approvedRegion).getByRole('button', { name: 'Is UPI accepted?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 question approved successfully.')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('keeps an edited inactive question disabled instead of approving it', async () => {
    mockedFetchTemplate.mockResolvedValue({
      source: 'manual-template',
      sections: [
        {
          key: 'payment',
          title: 'Payment',
          questions: [
            templateQuestion({
              applicable: true,
              qa_approved: true,
              status: 'approved',
              ui_status: 'approved',
            }),
          ],
        },
      ],
      summary: {
        total: 1,
        completed: 1,
        approved: 1,
        pending: 0,
        not_applicable: 0,
      },
    });
    mockedPatchKnowledgeEntry.mockResolvedValue(
      knowledgeRow({
        answer: 'UPI is currently unavailable.',
        applicable: false,
        qa_approved: false,
        status: 'disabled',
        embedding_status: 'not_required',
        search_text: null,
        approved_at: null,
      }),
    );

    render(
      <ManualQAForm
        isOpen
        onClose={vi.fn()}
        categories={[{ id: 'payment', name: 'Payment', description: 'Payment policies' }]}
      />,
    );

    expect(await screen.findByText('Approved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make inactive' }));
    fireEvent.change(screen.getByDisplayValue('Yes, UPI payments are accepted.'), {
      target: { value: 'UPI is currently unavailable.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & Approve Edited \(1\)/ }));

    await waitFor(() => {
      expect(mockedPatchKnowledgeEntry).toHaveBeenCalledWith(
        KNOWLEDGE_ID,
        expect.objectContaining({
          answer: 'UPI is currently unavailable.',
          applicable: false,
          qa_approved: false,
          status: 'disabled',
        }),
        CLINIC_ID,
      );
    });
    const approvedRegion = screen.getByRole('region', {
      name: 'Approved questions in Payment',
    });
    expect(
      within(approvedRegion).queryByRole('button', { name: 'Is UPI accepted?' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('1 inactive question saved successfully.')).toBeInTheDocument();
  });

  it('does not count an empty or reverted answer as an edited question', async () => {
    mockedFetchTemplate.mockResolvedValue({
      source: 'manual-template',
      sections: [
        {
          key: 'payment',
          title: 'Payment',
          questions: [
            templateQuestion({
              applicable: true,
              qa_approved: true,
              status: 'approved',
              ui_status: 'approved',
            }),
          ],
        },
      ],
      summary: {
        total: 1,
        completed: 1,
        approved: 1,
        pending: 0,
        not_applicable: 0,
      },
    });

    render(
      <ManualQAForm
        isOpen
        onClose={vi.fn()}
        categories={[{ id: 'payment', name: 'Payment', description: 'Payment policies' }]}
      />,
    );

    const answer = await screen.findByDisplayValue('Yes, UPI payments are accepted.');
    fireEvent.change(answer, { target: { value: '' } });

    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Draft (0)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save & Approve Edited (0)' })).toBeDisabled();

    fireEvent.change(answer, { target: { value: 'UPI and card payments are accepted.' } });
    expect(screen.getByRole('button', { name: 'Save & Approve Edited (1)' })).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    fireEvent.change(answer, { target: { value: 'Yes, UPI payments are accepted.' } });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Draft (0)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save & Approve Edited (0)' })).toBeDisabled();
    expect(mockedPatchKnowledgeEntry).not.toHaveBeenCalled();
  });

  it('saves every edited question across sections as drafts', async () => {
    const secondQuestion = templateQuestion({
      id: SECOND_KNOWLEDGE_ID,
      question: 'Are cards accepted?',
      answer: 'Cards are accepted.',
      template_key: 'services::Are cards accepted?',
      section_key: 'services',
      applicable: true,
      status: 'needs_update',
      ui_status: 'draft',
    });
    mockedFetchTemplate.mockResolvedValue({
      source: 'manual-template',
      sections: [
        {
          key: 'payment',
          title: 'Payment',
          questions: [
            templateQuestion({ applicable: true, status: 'needs_update', ui_status: 'draft' }),
          ],
        },
        {
          key: 'services',
          title: 'Services',
          questions: [secondQuestion],
        },
      ],
      summary: {
        total: 2,
        completed: 2,
        approved: 0,
        pending: 2,
        not_applicable: 0,
      },
    });
    mockedPatchKnowledgeEntry.mockImplementation(async (knowledgeId, patch) =>
      knowledgeRow({
        id: knowledgeId,
        question: String(patch.question),
        answer: String(patch.answer),
        applicable: true,
        qa_approved: false,
        status: 'pending_review',
        embedding_status: 'not_required',
      }),
    );
    const onSaved = vi.fn();

    render(
      <ManualQAForm
        isOpen
        onClose={vi.fn()}
        categories={[{ id: 'payment', name: 'Payment', description: 'Payment policies' }]}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(await screen.findByDisplayValue('Yes, UPI payments are accepted.'), {
      target: { value: 'UPI is accepted.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Services/ }));
    fireEvent.change(screen.getByDisplayValue('Cards are accepted.'), {
      target: { value: 'Credit and debit cards are accepted.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Draft (2)' }));

    await waitFor(() => expect(mockedPatchKnowledgeEntry).toHaveBeenCalledTimes(2));
    expect(mockedPatchKnowledgeEntry).toHaveBeenCalledWith(
      KNOWLEDGE_ID,
      expect.objectContaining({
        answer: 'UPI is accepted.',
        applicable: true,
        qa_approved: false,
        status: 'pending_review',
      }),
      CLINIC_ID,
    );
    expect(mockedPatchKnowledgeEntry).toHaveBeenCalledWith(
      SECOND_KNOWLEDGE_ID,
      expect.objectContaining({
        answer: 'Credit and debit cards are accepted.',
        applicable: true,
        qa_approved: false,
        status: 'pending_review',
      }),
      CLINIC_ID,
    );
    expect(screen.getByText('2 questions saved as draft successfully.')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('approves every valid edited question and ignores answerless changes', async () => {
    const secondQuestion = templateQuestion({
      id: SECOND_KNOWLEDGE_ID,
      question: 'Are cards accepted?',
      answer: 'Cards are accepted.',
      template_key: 'services::Are cards accepted?',
      section_key: 'services',
      applicable: true,
      status: 'needs_update',
      ui_status: 'draft',
    });
    const thirdQuestion = templateQuestion({
      id: THIRD_KNOWLEDGE_ID,
      question: 'Is cash accepted?',
      answer: '',
      template_key: 'payment::Is cash accepted?',
      applicable: true,
      status: 'needs_update',
      ui_status: 'draft',
    });
    mockedFetchTemplate.mockResolvedValue({
      source: 'manual-template',
      sections: [
        {
          key: 'payment',
          title: 'Payment',
          questions: [
            templateQuestion({
              applicable: true,
              status: 'needs_update',
              ui_status: 'draft',
            }),
            thirdQuestion,
          ],
        },
        {
          key: 'services',
          title: 'Services',
          questions: [secondQuestion],
        },
      ],
      summary: {
        total: 3,
        completed: 2,
        approved: 0,
        pending: 3,
        not_applicable: 0,
      },
    });
    mockedPatchKnowledgeEntry.mockImplementation(async (knowledgeId, patch) =>
      knowledgeRow({
        id: knowledgeId,
        question: String(patch.question),
        answer: String(patch.answer),
        applicable: true,
        qa_approved: true,
        status: 'approved',
        embedding_status: 'generated',
        embedding_model: 'gemini-embedding-001',
        embedding_dimensions: 1024,
        approved_at: '2026-10-08T12:00:00.000Z',
      }),
    );
    const onSaved = vi.fn();

    render(
      <ManualQAForm
        isOpen
        onClose={vi.fn()}
        categories={[{ id: 'payment', name: 'Payment', description: 'Payment policies' }]}
        onSaved={onSaved}
      />,
    );

    await screen.findByDisplayValue('Yes, UPI payments are accepted.');
    fireEvent.change(screen.getByDisplayValue('Yes, UPI payments are accepted.'), {
      target: { value: 'UPI is accepted.' },
    });
    fireEvent.change(screen.getByDisplayValue('Is cash accepted?'), {
      target: { value: 'Can patients pay with cash?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Services/ }));
    fireEvent.change(screen.getByDisplayValue('Cards are accepted.'), {
      target: { value: 'Credit and debit cards are accepted.' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Save & Approve Edited \(2\)/ }));

    await waitFor(() => expect(mockedPatchKnowledgeEntry).toHaveBeenCalledTimes(2));
    expect(mockedPatchKnowledgeEntry).toHaveBeenCalledWith(
      KNOWLEDGE_ID,
      expect.objectContaining({ answer: 'UPI is accepted.', status: 'approved' }),
      CLINIC_ID,
    );
    expect(mockedPatchKnowledgeEntry).toHaveBeenCalledWith(
      SECOND_KNOWLEDGE_ID,
      expect.objectContaining({
        answer: 'Credit and debit cards are accepted.',
        status: 'approved',
      }),
      CLINIC_ID,
    );
    expect(mockedPatchKnowledgeEntry).not.toHaveBeenCalledWith(
      THIRD_KNOWLEDGE_ID,
      expect.anything(),
      CLINIC_ID,
    );
    expect(
      screen.queryByText('Answer is required before approving this question.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('2 questions approved successfully.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save & Approve Edited \(0\)/ })).toBeDisabled();
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
