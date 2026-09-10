'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import {
  createManualKnowledgeEntry,
  fetchManualKnowledgeTemplate,
  importManualKnowledgeTemplate,
  patchKnowledgeEntry,
  type CreateManualKnowledgeEntryPayload,
  type ManualTemplateApiResponse,
  type ManualTemplateQuestionApiRow,
  type TemplateUiStatus,
} from '@/lib/api/knowledge';

import type { Category } from './types';

type SaveMode = 'draft' | 'approve';

type TemplateDraftQuestion = {
  id: string;
  question: string;
  answer: string;
  category: string;
  templateKey: string | undefined;
  sectionKey: string;
  status: string;
  sourceNotes: string;
  serviceName: string;
  serviceNameRequired: boolean;
  applicable: boolean;
  qaApproved: boolean;
  uiStatus: TemplateUiStatus;
  exists: boolean;
  sourceFile: string;
  sourcePage: number | undefined;
  alternativePhrases: string[];
  errorMessage: string | null;
  duplicateWarning: boolean;
};

type TemplateDraftSection = {
  key: string;
  title: string;
  questions: TemplateDraftQuestion[];
};

type SaveTargetState = {
  applicable: boolean;
  qaApproved: boolean;
  status: 'pending_review' | 'needs_update' | 'approved' | 'disabled';
};

const STATUS_CONFIG: Record<
  TemplateUiStatus,
  { label: string; classes: string }
> = {
  draft: {
    label: 'Draft',
    classes: 'border-amber-300 bg-amber-50 text-amber-800',
  },
  approved: {
    label: 'Approved',
    classes: 'border-green-300 bg-green-50 text-green-800',
  },
  inactive: {
    label: 'Inactive',
    classes: 'border-slate-300 bg-slate-100 text-slate-600',
  },
};

function inferUiStatus(row: {
  applicable: boolean;
  qaApproved: boolean;
  answer: string;
  status?: string;
}): TemplateUiStatus {
  if (!row.applicable) {
    return 'inactive';
  }
  if (row.status === 'approved' && row.qaApproved && row.answer.trim().length > 0) {
    return 'approved';
  }
  return 'draft';
}

function mapApiQuestion(row: ManualTemplateQuestionApiRow): TemplateDraftQuestion {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    category: row.category ?? 'general',
    templateKey: row.template_key ?? undefined,
    sectionKey: row.section_key ?? 'custom',
    status: row.status,
    sourceNotes: row.source_notes ?? '',
    serviceName: row.service_name ?? '',
    serviceNameRequired: row.service_name_required,
    applicable: row.applicable,
    qaApproved: row.qa_approved,
    uiStatus: row.ui_status,
    exists: row.exists,
    sourceFile: row.source_file ?? '',
    sourcePage: row.source_page ?? undefined,
    alternativePhrases: row.alternative_phrases_json,
    errorMessage: null,
    duplicateWarning: false,
  };
}

function mapTemplate(template: ManualTemplateApiResponse): TemplateDraftSection[] {
  return template.sections.map((section) => ({
    key: section.key,
    title: section.title,
    questions: section.questions.map(mapApiQuestion),
  }));
}

function sectionProgress(section: TemplateDraftSection): {
  approved: number;
  draft: number;
  inactive: number;
} {
  return {
    approved: section.questions.filter((question) => question.uiStatus === 'approved').length,
    draft: section.questions.filter((question) => question.uiStatus === 'draft').length,
    inactive: section.questions.filter((question) => question.uiStatus === 'inactive').length,
  };
}

function getSaveTargetState(question: TemplateDraftQuestion, mode: SaveMode): SaveTargetState {
  if (mode === 'approve') {
    return {
      applicable: true,
      qaApproved: true,
      status: 'approved',
    };
  }

  if (!question.applicable) {
    return {
      applicable: false,
      qaApproved: false,
      status: 'disabled',
    };
  }

  return {
    applicable: true,
    qaApproved: false,
    status: question.answer.trim().length > 0 ? 'pending_review' : 'needs_update',
  };
}

function validateQuestion(question: TemplateDraftQuestion, mode: SaveMode): string | null {
  if (!question.question.trim()) {
    return 'Question is required.';
  }

  const target = getSaveTargetState(question, mode);
  const answer = question.answer.trim();
  if (target.applicable && target.qaApproved && answer.length === 0) {
    return 'Answer is required before approving this question.';
  }

  if (
    target.applicable &&
    target.qaApproved &&
    question.serviceNameRequired &&
    question.serviceName.trim().length === 0
  ) {
    return 'Service name is required for this service-specific question before approval.';
  }

  return null;
}

interface ManualQAFormProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  onSaved?: () => Promise<void> | void;
}

export function ManualQAForm({ isOpen, onClose, categories, onSaved }: ManualQAFormProps) {
  const clinicId = useActiveClinicId();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sections, setSections] = useState<TemplateDraftSection[]>([]);
  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [importingTemplate, setImportingTemplate] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    const deduped: Array<{ id: string; name: string }> = [];
    for (const category of categories) {
      if (seen.has(category.id)) {
        continue;
      }
      seen.add(category.id);
      deduped.push({ id: category.id, name: category.name });
    }
    if (!seen.has('general')) {
      deduped.push({ id: 'general', name: 'General FAQ' });
    }
    return deduped;
  }, [categories]);

  const activeSection = useMemo(
    () => sections.find((section) => section.key === activeSectionKey) ?? null,
    [sections, activeSectionKey],
  );

  const applyQuestionPatch = useCallback(
    (
      sectionKey: string,
      questionId: string,
      updater: (question: TemplateDraftQuestion) => TemplateDraftQuestion,
    ) => {
      setSections((current) =>
        current.map((section) =>
          section.key !== sectionKey
            ? section
            : {
                ...section,
                questions: section.questions.map((question) =>
                  question.id === questionId ? updater(question) : question,
                ),
              },
        ),
      );
    },
    [],
  );

  const selectedQuestionContext = useMemo(() => {
    if (!activeSection || !selectedQuestionId) {
      return null;
    }
    const question = activeSection.questions.find((item) => item.id === selectedQuestionId);
    if (!question) {
      return null;
    }
    return {
      sectionKey: activeSection.key,
      question,
      questionIndex: activeSection.questions.findIndex((item) => item.id === selectedQuestionId),
    };
  }, [activeSection, selectedQuestionId]);

  const selectedQuestion = selectedQuestionContext?.question ?? null;
  const selectedQuestionSectionKey = selectedQuestionContext?.sectionKey ?? null;
  const selectedQuestionSaving =
    selectedQuestion !== null && savingQuestionId === selectedQuestion.id;

  const loadTemplate = useCallback(async () => {
    if (!clinicId) {
      setLoadError('Clinic context is required to manage manual knowledge template.');
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const template = await fetchManualKnowledgeTemplate();
      if (!template) {
        setSections([]);
        setActiveSectionKey(null);
        return;
      }

      const mapped = mapTemplate(template);
      setSections(mapped);
      setActiveSectionKey((current) => {
        if (current && mapped.some((section) => section.key === current)) {
          return current;
        }
        return mapped[0]?.key ?? null;
      });
      setSelectedQuestionId((current) => {
        if (!current) {
          return mapped[0]?.questions[0]?.id ?? null;
        }

        for (const section of mapped) {
          if (section.questions.some((question) => question.id === current)) {
            return current;
          }
        }

        return mapped[0]?.questions[0]?.id ?? null;
      });
    } catch (error) {
      setLoadError(
        error instanceof ApiRequestError
          ? error.apiError.message
          : 'Failed to load manual Q&A template.',
      );
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setBannerMessage(null);
    void loadTemplate();
  }, [isOpen, loadTemplate]);

  useEffect(() => {
    if (sections.length === 0) {
      setActiveSectionKey(null);
      setSelectedQuestionId(null);
      return;
    }

    if (activeSectionKey && sections.some((section) => section.key === activeSectionKey)) {
      return;
    }

    setActiveSectionKey(sections[0]?.key ?? null);
  }, [sections, activeSectionKey]);

  useEffect(() => {
    if (!activeSection) {
      setSelectedQuestionId(null);
      return;
    }

    if (
      selectedQuestionId &&
      activeSection.questions.some((question) => question.id === selectedQuestionId)
    ) {
      return;
    }

    setSelectedQuestionId(activeSection.questions[0]?.id ?? null);
  }, [activeSection, selectedQuestionId]);

  const handleImportTemplate = async () => {
    if (!clinicId) {
      return;
    }

    setImportingTemplate(true);
    setBannerMessage(null);
    try {
      const result = await importManualKnowledgeTemplate();
      setBannerMessage(
        `Template import completed. Added ${result.imported} new rows, ${result.existing} already existed.`,
      );
      await loadTemplate();
      await onSaved?.();
    } catch (error) {
      setLoadError(
        error instanceof ApiRequestError
          ? error.apiError.message
          : 'Failed to import template questions.',
      );
    } finally {
      setImportingTemplate(false);
    }
  };

  const handleAddCustomQuestion = () => {
    const newQuestionId = `custom:new:${Date.now().toString()}`;

    setSections((current) => {
      const customIndex = current.findIndex((section) => section.key === 'custom');
      const newQuestion: TemplateDraftQuestion = {
        id: newQuestionId,
        question: '',
        answer: '',
        category: 'general',
        templateKey: undefined,
        sectionKey: 'custom',
        status: 'needs_update',
        sourceNotes: '',
        serviceName: '',
        serviceNameRequired: false,
        applicable: true,
        qaApproved: false,
        uiStatus: 'draft',
        exists: false,
        sourceFile: '',
        sourcePage: undefined,
        alternativePhrases: [],
        errorMessage: null,
        duplicateWarning: false,
      };

      if (customIndex === -1) {
        return [
          ...current,
          {
            key: 'custom',
            title: 'Custom Q&A',
            questions: [newQuestion],
          },
        ];
      }

      return current.map((section, index) =>
        index !== customIndex
          ? section
          : {
              ...section,
              questions: [newQuestion, ...section.questions],
            },
      );
    });

    setActiveSectionKey('custom');
    setSelectedQuestionId(newQuestionId);
  };

  const handleRemoveUnsavedQuestion = (sectionKey: string, questionId: string) => {
    if (selectedQuestionId === questionId) {
      setSelectedQuestionId(null);
    }
    setSections((current) =>
      current
        .map((section) =>
          section.key !== sectionKey
            ? section
            : {
                ...section,
                questions: section.questions.filter((question) => question.id !== questionId),
              },
        )
        .filter((section) => section.key !== 'custom' || section.questions.length > 0),
    );
  };

  const saveQuestion = async (sectionKey: string, questionId: string, mode: SaveMode) => {
    if (!clinicId) {
      return;
    }

    const section = sections.find((item) => item.key === sectionKey);
    const question = section?.questions.find((item) => item.id === questionId);
    if (!question) {
      return;
    }

    const validationError = validateQuestion(question, mode);
    if (validationError) {
      applyQuestionPatch(sectionKey, questionId, (current) => ({
        ...current,
        errorMessage: validationError,
        duplicateWarning: false,
      }));
      return;
    }

    const targetState = getSaveTargetState(question, mode);
    const trimmedQuestion = question.question.trim();
    const trimmedAnswer = question.answer.trim();
    const trimmedCategory = question.category.trim() || 'general';
    const trimmedSourceNotes = question.sourceNotes.trim();
    const trimmedServiceName = question.serviceName.trim();

    setSavingQuestionId(questionId);
    applyQuestionPatch(sectionKey, questionId, (current) => ({
      ...current,
      errorMessage: null,
      duplicateWarning: false,
    }));

    try {
      const payload: CreateManualKnowledgeEntryPayload = {
        question: trimmedQuestion,
        answer: trimmedAnswer,
        category: trimmedCategory,
        alternative_phrases_json: question.alternativePhrases,
        section_key: question.sectionKey,
        applicable: targetState.applicable,
        qa_approved: targetState.qaApproved,
        status: targetState.status,
        ...(question.templateKey ? { template_key: question.templateKey } : {}),
        ...(trimmedSourceNotes.length > 0 ? { source_notes: trimmedSourceNotes } : {}),
        ...(trimmedServiceName.length > 0 ? { service_name: trimmedServiceName } : {}),
        ...(question.sourceFile ? { source_file: question.sourceFile } : {}),
        ...(question.sourcePage !== undefined ? { source_page: question.sourcePage } : {}),
      };

      const saved = question.exists
        ? await patchKnowledgeEntry(question.id, payload, clinicId)
        : await createManualKnowledgeEntry(payload);

      const savedQuestion: ManualTemplateQuestionApiRow = {
        ...saved,
        exists: true,
        service_name_required: question.serviceNameRequired,
        ui_status: inferUiStatus({
          applicable: saved.applicable,
          qaApproved: saved.qa_approved,
          answer: saved.answer,
          status: saved.status,
        }),
      };

      setSections((current) =>
        current.map((item) =>
          item.key !== sectionKey
            ? item
            : {
                ...item,
                questions: item.questions.map((entry) =>
                  entry.id !== questionId ? entry : mapApiQuestion(savedQuestion),
                ),
              },
        ),
      );

      setBannerMessage('Question saved successfully.');
      await onSaved?.();
    } catch (error) {
      const duplicateWarning =
        error instanceof ApiRequestError && error.apiError.code === 'IDEMPOTENCY_CONFLICT';
      const message =
        error instanceof ApiRequestError
          ? error.apiError.message
          : 'Failed to save this question.';

      applyQuestionPatch(sectionKey, questionId, (current) => ({
        ...current,
        errorMessage: message,
        duplicateWarning,
      }));
    } finally {
      setSavingQuestionId(null);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="flex h-[94vh] w-full max-w-[1280px] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-gradient-to-r from-cyan-50 via-white to-emerald-50 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-black text-slate-900">Manual Knowledge Template</h3>
              <p className="mt-1 text-sm text-slate-600">
                Fill clinic-approved answers section by section. Medical advice is blocked and
                duplicates are checked before save.
              </p>
            </div>
            <div className="flex max-w-[640px] flex-col items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={handleImportTemplate}
                  disabled={importingTemplate || loading}
                  className="rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {importingTemplate ? 'Importing...' : 'Import Template Rows'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedQuestion || !selectedQuestionSectionKey) {
                      return;
                    }
                    void saveQuestion(selectedQuestionSectionKey, selectedQuestion.id, 'draft');
                  }}
                  disabled={
                    selectedQuestionSaving || !selectedQuestion || !selectedQuestionSectionKey || loading
                  }
                  className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedQuestion || !selectedQuestionSectionKey) {
                      return;
                    }
                    void saveQuestion(selectedQuestionSectionKey, selectedQuestion.id, 'approve');
                  }}
                  disabled={
                    selectedQuestionSaving || !selectedQuestion || !selectedQuestionSectionKey || loading
                  }
                  className="rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-xs font-bold text-green-800 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save & Approve
                </button>
                <button
                  type="button"
                  onClick={handleAddCustomQuestion}
                  className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                >
                  + Add Custom Q&A
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
          </div>

        </div>

        {loadError && (
          <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">{loadError}</div>
        )}

        {bannerMessage && (
          <div className="border-b border-emerald-200 bg-emerald-50 px-6 py-3 text-sm text-emerald-700">
            {bannerMessage}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm font-semibold text-slate-500">Loading template questions...</p>
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[270px_1fr]">
              <aside className="h-full min-h-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 px-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Sections
                </p>
                <div className="space-y-1.5">
                  {sections.map((section) => {
                    const progress = sectionProgress(section);
                    const active = section.key === activeSectionKey;
                    return (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => {
                          setActiveSectionKey(section.key);
                          setSelectedQuestionId(section.questions[0]?.id ?? null);
                        }}
                        className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                          active
                            ? 'border-cyan-300 bg-cyan-50'
                            : 'border-slate-200 bg-white hover:border-cyan-200 hover:bg-cyan-50/40'
                        }`}
                      >
                        <p className="text-sm font-bold text-slate-900">{section.title}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {section.questions.length} questions
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {progress.approved} approved • {progress.draft} draft • {progress.inactive}{' '}
                          inactive
                        </p>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="h-full min-h-0 overflow-y-auto bg-white p-5">
                {!activeSection ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm text-slate-600">No section selected.</p>
                  </div>
                ) : (
                  <>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-lg font-black text-slate-900">{activeSection.title}</h4>
                        <p className="text-sm text-slate-500">
                          Review each row and use top-right controls to save.
                        </p>
                      </div>
                      {activeSection.key === 'custom' && (
                        <button
                          type="button"
                          onClick={handleAddCustomQuestion}
                          className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                        >
                          + Add Another Custom Row
                        </button>
                      )}
                    </div>

                    <div className="space-y-4">
                      {activeSection.questions.map((question, index) => {
                        const statusConfig = STATUS_CONFIG[question.uiStatus];
                        const isSelected = selectedQuestionId === question.id;
                        const showInlineRemove = !question.exists && question.sectionKey === 'custom';

                        return (
                          <article
                            key={question.id}
                            onClick={() => setSelectedQuestionId(question.id)}
                            onFocusCapture={() => setSelectedQuestionId(question.id)}
                            className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
                              isSelected
                                ? 'border-cyan-300 ring-2 ring-cyan-100'
                                : 'border-slate-200 hover:border-cyan-200'
                            }`}
                          >
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                  Question {index + 1}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {question.exists ? 'Saved row' : 'New row'}
                                </p>
                              </div>
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusConfig.classes}`}
                              >
                                {statusConfig.label}
                              </span>
                            </div>

                            <div className="space-y-3">
                              <div>
                                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                                  Question
                                </label>
                                <textarea
                                  value={question.question}
                                  onChange={(event) =>
                                    applyQuestionPatch(activeSection.key, question.id, (current) => ({
                                      ...current,
                                      question: event.target.value,
                                      errorMessage: null,
                                      duplicateWarning: false,
                                    }))
                                  }
                                  rows={2}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/10"
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                                  Answer
                                </label>
                                <textarea
                                  value={question.answer}
                                  onChange={(event) =>
                                    applyQuestionPatch(activeSection.key, question.id, (current) => ({
                                      ...current,
                                      answer: event.target.value,
                                      errorMessage: null,
                                      duplicateWarning: false,
                                    }))
                                  }
                                  rows={3}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/10"
                                />
                              </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                                    Category
                                  </label>
                                  <select
                                    value={question.category}
                                    onChange={(event) =>
                                      applyQuestionPatch(activeSection.key, question.id, (current) => ({
                                        ...current,
                                        category: event.target.value,
                                        errorMessage: null,
                                        duplicateWarning: false,
                                      }))
                                    }
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/10"
                                  >
                                    {availableCategories.map((category) => (
                                      <option key={category.id} value={category.id}>
                                        {category.name}
                                      </option>
                                    ))}
                                    {!availableCategories.some(
                                      (category) => category.id === question.category,
                                    ) && (
                                      <option value={question.category}>{question.category}</option>
                                    )}
                                  </select>
                                </div>

                                <div>
                                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                                    Service Name {question.serviceNameRequired ? '*' : '(optional)'}
                                  </label>
                                  <input
                                    type="text"
                                    value={question.serviceName}
                                    onChange={(event) =>
                                      applyQuestionPatch(activeSection.key, question.id, (current) => ({
                                        ...current,
                                        serviceName: event.target.value,
                                        errorMessage: null,
                                        duplicateWarning: false,
                                      }))
                                    }
                                    placeholder={
                                      question.serviceNameRequired
                                        ? 'Example: Dental cleaning'
                                        : 'Optional'
                                    }
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/10"
                                  />
                                </div>
                              </div>

                              <div>
                                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                                  Source Notes
                                </label>
                                <textarea
                                  value={question.sourceNotes}
                                  onChange={(event) =>
                                    applyQuestionPatch(activeSection.key, question.id, (current) => ({
                                      ...current,
                                      sourceNotes: event.target.value,
                                      errorMessage: null,
                                      duplicateWarning: false,
                                    }))
                                  }
                                  rows={2}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/10"
                                />
                              </div>

                              {question.duplicateWarning && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                  Possible duplicate detected. Review existing entries before adding
                                  another version.
                                </div>
                              )}

                              {question.errorMessage && (
                                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                  {question.errorMessage}
                                </div>
                              )}

                              {showInlineRemove && (
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleRemoveUnsavedQuestion(activeSection.key, question.id);
                                    }}
                                    className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                                  >
                                    Remove custom row
                                  </button>
                                </div>
                              )}

                              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                Use top-right Template Controls for save actions.
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
