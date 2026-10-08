'use client';

import { PREDEFINED_CLINIC_SERVICES } from '@vaidya/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError, isAbortError } from '@/lib/api/client';
import {
  createManualKnowledgeEntry,
  fetchManualKnowledgeTemplate,
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
  serviceName: string;
  serviceNameRequired: boolean;
  applicable: boolean;
  qaApproved: boolean;
  uiStatus: TemplateUiStatus;
  exists: boolean;
  sourceFile: string;
  sourcePage: number | undefined;
  alternativePhrases: string[];
  dirty: boolean;
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

type FormBanner = {
  tone: 'success' | 'warning';
  message: string;
};

type QuestionSaveLocation = {
  sectionKey: string;
  question: TemplateDraftQuestion;
};

type SavedQuestionResult = {
  sectionKey: string;
  originalQuestionId: string;
  question: TemplateDraftQuestion;
  mode: SaveMode;
};

const BATCH_SAVE_CONCURRENCY = 3;

const STATUS_CONFIG: Record<TemplateUiStatus, { label: string; classes: string }> = {
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
    serviceName: row.service_name ?? '',
    serviceNameRequired: row.service_name_required,
    applicable: row.applicable,
    qaApproved: row.qa_approved,
    uiStatus: row.ui_status,
    exists: row.exists,
    sourceFile: row.source_file ?? '',
    sourcePage: row.source_page ?? undefined,
    alternativePhrases: row.alternative_phrases_json,
    dirty: false,
    errorMessage: null,
    duplicateWarning: false,
  };
}

function markQuestionEdited(
  question: TemplateDraftQuestion,
  changes: Partial<
    Pick<TemplateDraftQuestion, 'question' | 'answer' | 'category' | 'serviceName' | 'applicable'>
  >,
): TemplateDraftQuestion {
  const updated = { ...question, ...changes };
  return {
    ...updated,
    qaApproved: false,
    status: updated.applicable
      ? updated.answer.trim().length > 0
        ? 'pending_review'
        : 'needs_update'
      : 'disabled',
    uiStatus: updated.applicable ? 'draft' : 'inactive',
    dirty: true,
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
  if (!question.applicable) {
    return {
      applicable: false,
      qaApproved: false,
      status: 'disabled',
    };
  }

  if (mode === 'approve') {
    return {
      applicable: true,
      qaApproved: true,
      status: 'approved',
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

function buildQuestionPayload(
  question: TemplateDraftQuestion,
  mode: SaveMode,
): CreateManualKnowledgeEntryPayload {
  const targetState = getSaveTargetState(question, mode);
  const serviceName = question.serviceName.trim();

  return {
    question: question.question.trim(),
    answer: question.answer.trim(),
    category: question.category.trim() || 'general',
    alternative_phrases_json: question.alternativePhrases,
    section_key: question.sectionKey,
    applicable: targetState.applicable,
    qa_approved: targetState.qaApproved,
    status: targetState.status,
    ...(question.templateKey ? { template_key: question.templateKey } : {}),
    ...(serviceName.length > 0 ? { service_name: serviceName } : {}),
    ...(question.sourceFile ? { source_file: question.sourceFile } : {}),
    ...(question.sourcePage !== undefined ? { source_page: question.sourcePage } : {}),
  };
}

async function persistQuestion(
  location: QuestionSaveLocation,
  mode: SaveMode,
  clinicId: string,
): Promise<SavedQuestionResult> {
  const { question, sectionKey } = location;
  const payload = buildQuestionPayload(question, mode);
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

  return {
    sectionKey,
    originalQuestionId: question.id,
    question: mapApiQuestion(savedQuestion),
    mode,
  };
}

function getQuestionSaveError(error: unknown): {
  message: string;
  duplicateWarning: boolean;
} {
  return {
    duplicateWarning:
      error instanceof ApiRequestError && error.apiError.code === 'IDEMPOTENCY_CONFLICT',
    message:
      error instanceof ApiRequestError ? error.apiError.message : 'Failed to save this question.',
  };
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
  const [batchSaving, setBatchSaving] = useState(false);
  const [banner, setBanner] = useState<FormBanner | null>(null);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;
  const activeClinicIdRef = useRef(clinicId);
  activeClinicIdRef.current = clinicId;
  const formContextSequenceRef = useRef(0);
  const activeLoadControllerRef = useRef<AbortController | null>(null);
  const loadSequenceRef = useRef(0);

  const isActiveFormContext = useCallback(
    (targetClinicId: string, contextSequence: number) =>
      openRef.current &&
      activeClinicIdRef.current === targetClinicId &&
      formContextSequenceRef.current === contextSequence,
    [],
  );

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

  const approvedQuestionsInActiveSection = useMemo(
    () => activeSection?.questions.filter((question) => question.uiStatus === 'approved') ?? [],
    [activeSection],
  );

  const dirtyQuestionCount = useMemo(
    () =>
      sections.reduce(
        (count, section) => count + section.questions.filter((question) => question.dirty).length,
        0,
      ),
    [sections],
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

  const applySavedQuestions = useCallback((results: SavedQuestionResult[]) => {
    const byOriginalId = new Map(results.map((result) => [result.originalQuestionId, result]));
    setSections((current) =>
      current.map((section) => ({
        ...section,
        questions: section.questions.map((question) => {
          const result = byOriginalId.get(question.id);
          return result?.sectionKey === section.key ? result.question : question;
        }),
      })),
    );
    setSelectedQuestionId((current) =>
      current ? (byOriginalId.get(current)?.question.id ?? current) : current,
    );
  }, []);

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
    if (!openRef.current) {
      return;
    }

    if (!clinicId) {
      setLoadError('Clinic context is required to manage manual knowledge template.');
      return;
    }

    activeLoadControllerRef.current?.abort();
    const controller = new AbortController();
    activeLoadControllerRef.current = controller;
    const sequence = ++loadSequenceRef.current;
    const isCurrent = () =>
      openRef.current &&
      activeClinicIdRef.current === clinicId &&
      !controller.signal.aborted &&
      loadSequenceRef.current === sequence;

    setLoading(true);
    setLoadError(null);

    try {
      const template = await fetchManualKnowledgeTemplate(controller.signal);
      if (!isCurrent()) {
        return;
      }
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
      if (!isCurrent() || isAbortError(error)) {
        return;
      }
      setLoadError(
        error instanceof ApiRequestError
          ? error.apiError.message
          : 'Failed to load manual Q&A template.',
      );
    } finally {
      if (isCurrent()) {
        setLoading(false);
      }
      if (activeLoadControllerRef.current === controller) {
        activeLoadControllerRef.current = null;
      }
    }
  }, [clinicId]);

  useEffect(() => {
    if (!isOpen) {
      openRef.current = false;
      formContextSequenceRef.current += 1;
      activeLoadControllerRef.current?.abort();
      activeLoadControllerRef.current = null;
      loadSequenceRef.current += 1;
      setSavingQuestionId(null);
      setBatchSaving(false);
      return;
    }
    openRef.current = true;
    const formContextSequence = ++formContextSequenceRef.current;
    setSavingQuestionId(null);
    setBatchSaving(false);
    setBanner(null);
    void loadTemplate();
    return () => {
      if (formContextSequenceRef.current === formContextSequence) {
        openRef.current = false;
        formContextSequenceRef.current += 1;
        activeLoadControllerRef.current?.abort();
        activeLoadControllerRef.current = null;
        loadSequenceRef.current += 1;
      }
    };
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
        serviceName: '',
        serviceNameRequired: false,
        applicable: true,
        qaApproved: false,
        uiStatus: 'draft',
        exists: false,
        sourceFile: '',
        sourcePage: undefined,
        alternativePhrases: [],
        dirty: false,
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

  const handleApplicableChange = (sectionKey: string, questionId: string, applicable: boolean) => {
    applyQuestionPatch(sectionKey, questionId, (current) =>
      markQuestionEdited(current, { applicable }),
    );
  };

  const saveQuestion = async (sectionKey: string, questionId: string, mode: SaveMode) => {
    if (!clinicId) {
      return;
    }
    const targetClinicId = clinicId;
    const contextSequence = formContextSequenceRef.current;

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

    setSavingQuestionId(questionId);
    setBanner(null);
    applyQuestionPatch(sectionKey, questionId, (current) => ({
      ...current,
      errorMessage: null,
      duplicateWarning: false,
    }));

    try {
      const result = await persistQuestion({ sectionKey, question }, mode, targetClinicId);

      if (!isActiveFormContext(targetClinicId, contextSequence)) {
        return;
      }

      applySavedQuestions([result]);
      setBanner({
        tone: 'success',
        message:
          mode === 'approve'
            ? 'Question saved, activated, and approved successfully.'
            : result.question.applicable
              ? 'Active draft saved successfully.'
              : 'Question saved as inactive.',
      });
      await onSaved?.();
    } catch (error) {
      if (!isActiveFormContext(targetClinicId, contextSequence)) {
        return;
      }
      const { duplicateWarning, message } = getQuestionSaveError(error);

      applyQuestionPatch(sectionKey, questionId, (current) => ({
        ...current,
        errorMessage: message,
        duplicateWarning,
      }));
    } finally {
      if (isActiveFormContext(targetClinicId, contextSequence)) {
        setSavingQuestionId(null);
      }
    }
  };

  const saveAndApproveEditedQuestions = async () => {
    if (!clinicId || batchSaving || savingQuestionId !== null) {
      return;
    }

    const targetClinicId = clinicId;
    const contextSequence = formContextSequenceRef.current;
    const editedQuestions: QuestionSaveLocation[] = sections.flatMap((section) =>
      section.questions
        .filter((question) => question.dirty)
        .map((question) => ({ sectionKey: section.key, question })),
    );

    if (editedQuestions.length === 0) {
      setBanner({ tone: 'warning', message: 'No edited questions are waiting to be saved.' });
      return;
    }

    const validationErrors = new Map<string, string>();
    const validQuestions = editedQuestions.flatMap((location) => {
      const mode: SaveMode = location.question.applicable ? 'approve' : 'draft';
      const validationError = validateQuestion(location.question, mode);
      if (validationError) {
        validationErrors.set(location.question.id, validationError);
        return [];
      }
      return [{ ...location, mode }];
    });

    setSections((current) =>
      current.map((section) => ({
        ...section,
        questions: section.questions.map((question) => {
          if (!question.dirty) {
            return question;
          }
          return {
            ...question,
            errorMessage: validationErrors.get(question.id) ?? null,
            duplicateWarning: false,
          };
        }),
      })),
    );

    if (validQuestions.length === 0) {
      setBanner({
        tone: 'warning',
        message: `${validationErrors.size} edited question${validationErrors.size === 1 ? '' : 's'} need${validationErrors.size === 1 ? 's' : ''} correction before approval.`,
      });
      return;
    }

    setBatchSaving(true);
    setBanner(null);
    const savedResults: SavedQuestionResult[] = [];
    const saveErrors = new Map<string, ReturnType<typeof getQuestionSaveError>>();

    try {
      for (let offset = 0; offset < validQuestions.length; offset += BATCH_SAVE_CONCURRENCY) {
        const chunk = validQuestions.slice(offset, offset + BATCH_SAVE_CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map(async ({ mode, ...location }) => {
            try {
              return await persistQuestion(location, mode, targetClinicId);
            } catch (error) {
              saveErrors.set(location.question.id, getQuestionSaveError(error));
              return null;
            }
          }),
        );

        if (!isActiveFormContext(targetClinicId, contextSequence)) {
          return;
        }
        savedResults.push(
          ...chunkResults.filter((result): result is SavedQuestionResult => result !== null),
        );
      }

      applySavedQuestions(savedResults);
      if (saveErrors.size > 0) {
        setSections((current) =>
          current.map((section) => ({
            ...section,
            questions: section.questions.map((question) => {
              const error = saveErrors.get(question.id);
              return error
                ? {
                    ...question,
                    errorMessage: error.message,
                    duplicateWarning: error.duplicateWarning,
                  }
                : question;
            }),
          })),
        );
      }

      const approvedCount = savedResults.filter((result) => result.mode === 'approve').length;
      const inactiveSavedCount = savedResults.filter((result) => result.mode === 'draft').length;
      const issueCount = validationErrors.size + saveErrors.size;
      const firstIssue = editedQuestions.find(
        ({ question }) => validationErrors.has(question.id) || saveErrors.has(question.id),
      );
      if (firstIssue) {
        setActiveSectionKey(firstIssue.sectionKey);
        setSelectedQuestionId(firstIssue.question.id);
      }
      const successfulParts = [
        approvedCount > 0
          ? `${approvedCount} question${approvedCount === 1 ? '' : 's'} approved`
          : null,
        inactiveSavedCount > 0
          ? `${inactiveSavedCount} inactive question${inactiveSavedCount === 1 ? '' : 's'} saved`
          : null,
      ].filter((part): part is string => part !== null);

      setBanner({
        tone: issueCount > 0 ? 'warning' : 'success',
        message:
          issueCount > 0
            ? `${successfulParts.join(' and ') || 'No questions were saved'}. ${issueCount} edited question${issueCount === 1 ? '' : 's'} still need${issueCount === 1 ? 's' : ''} attention.`
            : `${successfulParts.join(' and ')} successfully.`,
      });

      if (savedResults.length > 0) {
        await onSaved?.();
      }
    } finally {
      if (isActiveFormContext(targetClinicId, contextSequence)) {
        setBatchSaving(false);
      }
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
                  onClick={() => {
                    if (!selectedQuestion || !selectedQuestionSectionKey) {
                      return;
                    }
                    void saveQuestion(selectedQuestionSectionKey, selectedQuestion.id, 'draft');
                  }}
                  disabled={
                    batchSaving ||
                    selectedQuestionSaving ||
                    !selectedQuestion ||
                    !selectedQuestionSectionKey ||
                    loading
                  }
                  className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={() => void saveAndApproveEditedQuestions()}
                  disabled={
                    batchSaving || savingQuestionId !== null || dirtyQuestionCount === 0 || loading
                  }
                  className="rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-xs font-bold text-green-800 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {batchSaving
                    ? 'Saving edited questions...'
                    : `Save & Approve Edited (${dirtyQuestionCount})`}
                </button>
                <button
                  type="button"
                  onClick={handleAddCustomQuestion}
                  disabled={batchSaving || savingQuestionId !== null}
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
          <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {banner && (
          <div
            role="status"
            className={`border-b px-6 py-3 text-sm ${
              banner.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            {banner.message}
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
                          {progress.approved} approved • {progress.draft} draft •{' '}
                          {progress.inactive} inactive
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
                          Save &amp; Approve Edited processes valid changes across every section.
                        </p>
                      </div>
                      {activeSection.key === 'custom' && (
                        <button
                          type="button"
                          onClick={handleAddCustomQuestion}
                          disabled={batchSaving || savingQuestionId !== null}
                          className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                        >
                          + Add Another Custom Row
                        </button>
                      )}
                    </div>

                    <section
                      aria-label={`Approved questions in ${activeSection.title}`}
                      className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h5 className="text-sm font-bold text-emerald-900">Approved questions</h5>
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                          {approvedQuestionsInActiveSection.length}
                        </span>
                      </div>
                      {approvedQuestionsInActiveSection.length === 0 ? (
                        <p className="mt-2 text-xs text-emerald-800/75">
                          No approved questions in this section yet.
                        </p>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {approvedQuestionsInActiveSection.map((question) => (
                            <button
                              key={question.id}
                              type="button"
                              onClick={() => setSelectedQuestionId(question.id)}
                              className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-left text-xs font-semibold text-emerald-900 hover:border-emerald-400"
                            >
                              {question.question}
                            </button>
                          ))}
                        </div>
                      )}
                    </section>

                    <div className="space-y-4">
                      {activeSection.questions.map((question, index) => {
                        const statusConfig = STATUS_CONFIG[question.uiStatus];
                        const isSelected = selectedQuestionId === question.id;
                        const showInlineRemove =
                          !question.exists && question.sectionKey === 'custom';
                        const hasLegacyServiceName =
                          question.serviceName.length > 0 &&
                          !PREDEFINED_CLINIC_SERVICES.some(
                            (service) => service.service_name === question.serviceName,
                          );

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
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {question.dirty && (
                                  <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                                    Unsaved changes
                                  </span>
                                )}
                                <span
                                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusConfig.classes}`}
                                >
                                  {statusConfig.label}
                                </span>
                                <button
                                  type="button"
                                  aria-pressed={question.applicable}
                                  disabled={batchSaving || savingQuestionId !== null}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleApplicableChange(
                                      activeSection.key,
                                      question.id,
                                      !question.applicable,
                                    );
                                  }}
                                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                                    question.applicable
                                      ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                      : 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
                                  }`}
                                >
                                  {question.applicable ? 'Make inactive' : 'Make active'}
                                </button>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div>
                                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                                  Question
                                </label>
                                <textarea
                                  value={question.question}
                                  onChange={(event) =>
                                    applyQuestionPatch(activeSection.key, question.id, (current) =>
                                      markQuestionEdited(current, {
                                        question: event.target.value,
                                      }),
                                    )
                                  }
                                  disabled={batchSaving || savingQuestionId !== null}
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
                                    applyQuestionPatch(activeSection.key, question.id, (current) =>
                                      markQuestionEdited(current, {
                                        answer: event.target.value,
                                      }),
                                    )
                                  }
                                  disabled={batchSaving || savingQuestionId !== null}
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
                                      applyQuestionPatch(
                                        activeSection.key,
                                        question.id,
                                        (current) =>
                                          markQuestionEdited(current, {
                                            category: event.target.value,
                                          }),
                                      )
                                    }
                                    disabled={batchSaving || savingQuestionId !== null}
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
                                  <label
                                    htmlFor={`service-name-${question.id}`}
                                    className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500"
                                  >
                                    Service Name {question.serviceNameRequired ? '*' : '(optional)'}
                                  </label>
                                  <select
                                    id={`service-name-${question.id}`}
                                    value={question.serviceName}
                                    onChange={(event) =>
                                      applyQuestionPatch(
                                        activeSection.key,
                                        question.id,
                                        (current) =>
                                          markQuestionEdited(current, {
                                            serviceName: event.target.value,
                                          }),
                                      )
                                    }
                                    disabled={batchSaving || savingQuestionId !== null}
                                    required={question.serviceNameRequired}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/10"
                                  >
                                    <option value="">Select service</option>
                                    {hasLegacyServiceName && (
                                      <option value={question.serviceName}>
                                        {question.serviceName} (Current service)
                                      </option>
                                    )}
                                    {PREDEFINED_CLINIC_SERVICES.map((service) => (
                                      <option
                                        key={service.service_key}
                                        value={service.service_name}
                                      >
                                        {service.service_name}
                                      </option>
                                    ))}
                                  </select>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    Use this only when the answer belongs to one specific clinic
                                    service. It is required only for service-specific template rows.
                                  </p>
                                </div>
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
                                    disabled={batchSaving || savingQuestionId !== null}
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
