import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualQAForm } from './ManualQAForm';
import {
  fetchManualKnowledgeTemplate,
  patchKnowledgeEntry,
  type KnowledgeEntryApiRow,
  type ManualTemplateApiResponse,
  type ManualTemplateQuestionApiRow,
} from '@/lib/api/knowledge';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const KNOWLEDGE_ID = '00000000-0000-0000-0000-000000000501';
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
  createManualKnowledgeEntry: vi.fn(),
  fetchManualKnowledgeTemplate: vi.fn(),
  patchKnowledgeEntry: vi.fn(),
}));

const mockedFetchTemplate = vi.mocked(fetchManualKnowledgeTemplate);
const mockedPatchKnowledgeEntry = vi.mocked(patchKnowledgeEntry);

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
});

afterEach(() => {
  cleanup();
});

describe('ManualQAForm activation and approval', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Save & Approve' }));

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
    expect(
      screen.getByText('Question saved, activated, and approved successfully.'),
    ).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
