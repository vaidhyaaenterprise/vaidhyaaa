'use client';

import { PREDEFINED_CLINIC_SERVICES } from '@vaidya/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError, isAbortError } from '@/lib/api/client';
import {
  createManualKnowledgeSection,
  createManualKnowledgeEntry,
  fetchManualKnowledgeTemplate,
  patchKnowledgeEntry,
  removeManualKnowledgeQuestion,
  removeManualKnowledgeSection,
  updateManualKnowledgeSection,
  type CreateManualKnowledgeEntryPayload,
  type ManualTemplateApiResponse,
  type ManualTemplateQuestionApiRow,
  type TemplateUiStatus,
} from '@/lib/api/knowledge';

import type { Category } from './types';

type SaveMode = 'draft' | 'approve';

type TemplateQuestionBaseline = {
  question: string;
  answer: string;
  category: string;
  serviceName: string;
  applicable: boolean;
  qaApproved: boolean;
  status: string;
  uiStatus: TemplateUiStatus;
};

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
  baseline: TemplateQuestionBaseline;
  dirty: boolean;
  errorMessage: string | null;
  duplicateWarning: boolean;
};

type TemplateDraftSection = {
  key: string;
  title: string;
  isCustom: boolean;
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
  const category = row.category ?? 'general';
  const serviceName = row.service_name ?? '';

  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    category,
    templateKey: row.template_key ?? undefined,
    sectionKey: row.section_key ?? 'custom',
    status: row.status,
    serviceName,
    serviceNameRequired: row.service_name_required,
    applicable: row.applicable,
    qaApproved: row.qa_approved,
    uiStatus: row.ui_status,
    exists: row.exists,
    sourceFile: row.source_file ?? '',
    sourcePage: row.source_page ?? undefined,
    alternativePhrases: row.alternative_phrases_json,
    baseline: {
      question: row.question,
      answer: row.answer,
      category,
      serviceName,
      applicable: row.applicable,
      qaApproved: row.qa_approved,
      status: row.status,
      uiStatus: row.ui_status,
    },
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
  const baseline = updated.baseline;
  const contentChanged =
    updated.question.trim() !== baseline.question.trim() ||
    updated.answer.trim() !== baseline.answer.trim() ||
    updated.category.trim() !== baseline.category.trim() ||
    updated.serviceName.trim() !== baseline.serviceName.trim();
  const applicableChanged = updated.applicable !== baseline.applicable;
  const hasAnswer = updated.answer.trim().length > 0;
  const dirty = applicableChanged || (contentChanged && hasAnswer);

  if (!contentChanged && !applicableChanged) {
    return {
      ...updated,
      qaApproved: baseline.qaApproved,
      status: baseline.status,
      uiStatus: baseline.uiStatus,
      dirty: false,
      errorMessage: null,
      duplicateWarning: false,
    };
  }

  return {
    ...updated,
    qaApproved: false,
    status: updated.applicable
      ? updated.answer.trim().length > 0
        ? 'pending_review'
        : 'needs_update'
      : 'disabled',
    uiStatus: updated.applicable ? 'draft' : 'inactive',
    dirty,
    errorMessage: null,
    duplicateWarning: false,
  };
}

function mapTemplate(template: ManualTemplateApiResponse): TemplateDraftSection[] {
  return template.sections.map((section) => ({
    key: section.key,
    title: section.title,
    isCustom: section.is_custom ?? section.key === 'custom',
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
  const [batchSaving, setBatchSaving] = useState(false);
  const [questionActionId, setQuestionActionId] = useState<string | null>(null);
  const [sectionActionKey, setSectionActionKey] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [renamingSectionKey, setRenamingSectionKey] = useState<string | null>(null);
  const [renamedSectionTitle, setRenamedSectionTitle] = useState('');
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

  const activeSectionHasPersistedApprovedQuestions = useMemo(
    () =>
      activeSection?.questions.some((question) => question.baseline.uiStatus === 'approved') ??
      false,
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
      setBatchSaving(false);
      setQuestionActionId(null);
      setSectionActionKey(null);
      return;
    }
    openRef.current = true;
    const formContextSequence = ++formContextSequenceRef.current;
    setBatchSaving(false);
    setQuestionActionId(null);
    setSectionActionKey(null);
    setAddingSection(false);
    setNewSectionTitle('');
    setRenamingSectionKey(null);
    setRenamedSectionTitle('');
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

  const handleAddQuestion = (sectionKey: string) => {
    const newQuestionId = `${sectionKey}:new:${Date.now().toString()}`;

    setSections((current) => {
      const newQuestion: TemplateDraftQuestion = {
        id: newQuestionId,
        question: '',
        answer: '',
        category: 'general',
        templateKey: undefined,
        sectionKey,
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
        baseline: {
          question: '',
          answer: '',
          category: 'general',
          serviceName: '',
          applicable: true,
          qaApproved: false,
          status: 'needs_update',
          uiStatus: 'draft',
        },
        dirty: false,
        errorMessage: null,
        duplicateWarning: false,
      };

      return current.map((section) =>
        section.key !== sectionKey
          ? section
          : {
              ...section,
              questions: [newQuestion, ...section.questions],
            },
      );
    });

    setActiveSectionKey(sectionKey);
    setSelectedQuestionId(newQuestionId);
  };

  const handleRemoveUnsavedQuestion = (sectionKey: string, questionId: string) => {
    if (selectedQuestionId === questionId) {
      setSelectedQuestionId(null);
    }
    setSections((current) =>
      current.map((section) =>
        section.key !== sectionKey
          ? section
          : {
              ...section,
              questions: section.questions.filter((question) => question.id !== questionId),
            },
      ),
    );
  };

  const handleRemoveQuestion = async (sectionKey: string, questionId: string) => {
    const question = sections
      .find((section) => section.key === sectionKey)
      ?.questions.find((item) => item.id === questionId);
    if (
      !question ||
      question.baseline.uiStatus === 'approved' ||
      question.uiStatus === 'approved'
    ) {
      setBanner({
        tone: 'warning',
        message: 'Approved questions must be made inactive and saved before removal.',
      });
      return;
    }

    if (!question.exists && !question.templateKey) {
      handleRemoveUnsavedQuestion(sectionKey, questionId);
      return;
    }

    if (!window.confirm('Remove this question from the section?')) {
      return;
    }

    const targetClinicId = clinicId;
    const contextSequence = formContextSequenceRef.current;
    if (!targetClinicId) {
      return;
    }
    setQuestionActionId(questionId);
    setBanner(null);
    try {
      await removeManualKnowledgeQuestion(questionId);
      if (!isActiveFormContext(targetClinicId, contextSequence)) {
        return;
      }
      handleRemoveUnsavedQuestion(sectionKey, questionId);
      setBanner({ tone: 'success', message: 'Question removed successfully.' });
      await onSaved?.();
    } catch (error) {
      if (isActiveFormContext(targetClinicId, contextSequence)) {
        setBanner({
          tone: 'warning',
          message:
            error instanceof ApiRequestError
              ? error.apiError.message
              : 'Failed to remove the question.',
        });
      }
    } finally {
      if (isActiveFormContext(targetClinicId, contextSequence)) {
        setQuestionActionId(null);
      }
    }
  };

  const handleCreateSection = async () => {
    const title = newSectionTitle.trim();
    if (!clinicId || !title || sectionActionKey) {
      return;
    }
    const targetClinicId = clinicId;
    const contextSequence = formContextSequenceRef.current;
    setSectionActionKey('new');
    setBanner(null);
    try {
      const section = await createManualKnowledgeSection(title);
      if (!isActiveFormContext(targetClinicId, contextSequence)) {
        return;
      }
      setSections((current) => [
        ...current,
        {
          key: section.key,
          title: section.title,
          isCustom: section.is_custom ?? true,
          questions: [],
        },
      ]);
      setActiveSectionKey(section.key);
      setSelectedQuestionId(null);
      setAddingSection(false);
      setNewSectionTitle('');
      setBanner({ tone: 'success', message: 'Section added successfully.' });
    } catch (error) {
      if (isActiveFormContext(targetClinicId, contextSequence)) {
        setBanner({
          tone: 'warning',
          message:
            error instanceof ApiRequestError
              ? error.apiError.message
              : 'Failed to add the section.',
        });
      }
    } finally {
      if (isActiveFormContext(targetClinicId, contextSequence)) {
        setSectionActionKey(null);
      }
    }
  };

  const handleRenameSection = async (sectionKey: string) => {
    const title = renamedSectionTitle.trim();
    if (!clinicId || !title || sectionActionKey) {
      return;
    }
    const targetClinicId = clinicId;
    const contextSequence = formContextSequenceRef.current;
    setSectionActionKey(sectionKey);
    setBanner(null);
    try {
      const section = await updateManualKnowledgeSection(sectionKey, title);
      if (!isActiveFormContext(targetClinicId, contextSequence)) {
        return;
      }
      setSections((current) =>
        current.map((item) => (item.key === sectionKey ? { ...item, title: section.title } : item)),
      );
      setRenamingSectionKey(null);
      setRenamedSectionTitle('');
      setBanner({ tone: 'success', message: 'Section name updated successfully.' });
    } catch (error) {
      if (isActiveFormContext(targetClinicId, contextSequence)) {
        setBanner({
          tone: 'warning',
          message:
            error instanceof ApiRequestError
              ? error.apiError.message
              : 'Failed to rename the section.',
        });
      }
    } finally {
      if (isActiveFormContext(targetClinicId, contextSequence)) {
        setSectionActionKey(null);
      }
    }
  };

  const handleRemoveSection = async (sectionKey: string) => {
    const section = sections.find((item) => item.key === sectionKey);
    if (!clinicId || !section || sectionActionKey) {
      return;
    }
    if (section.questions.some((question) => question.baseline.uiStatus === 'approved')) {
      setBanner({
        tone: 'warning',
        message: 'Disable all approved questions before removing this section.',
      });
      return;
    }
    if (!window.confirm(`Remove the “${section.title}” section?`)) {
      return;
    }

    const targetClinicId = clinicId;
    const contextSequence = formContextSequenceRef.current;
    const fallbackSectionKey = sections.find((item) => item.key !== sectionKey)?.key ?? null;
    setSectionActionKey(sectionKey);
    setBanner(null);
    try {
      await removeManualKnowledgeSection(sectionKey);
      if (!isActiveFormContext(targetClinicId, contextSequence)) {
        return;
      }
      setSections((current) => current.filter((item) => item.key !== sectionKey));
      setActiveSectionKey((current) => (current === sectionKey ? fallbackSectionKey : current));
      setSelectedQuestionId(null);
      setBanner({ tone: 'success', message: 'Section removed successfully.' });
      await onSaved?.();
    } catch (error) {
      if (isActiveFormContext(targetClinicId, contextSequence)) {
        setBanner({
          tone: 'warning',
          message:
            error instanceof ApiRequestError
              ? error.apiError.message
              : 'Failed to remove the section.',
        });
      }
    } finally {
      if (isActiveFormContext(targetClinicId, contextSequence)) {
        setSectionActionKey(null);
      }
    }
  };

  const handleApplicableChange = (sectionKey: string, questionId: string, applicable: boolean) => {
    applyQuestionPatch(sectionKey, questionId, (current) =>
      markQuestionEdited(current, { applicable }),
    );
  };

  const saveEditedQuestions = async (requestedMode: SaveMode) => {
    if (!clinicId || batchSaving) {
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
      const mode: SaveMode =
        requestedMode === 'approve' && location.question.applicable ? 'approve' : 'draft';
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
        message: `${validationErrors.size} edited question${validationErrors.size === 1 ? '' : 's'} need${validationErrors.size === 1 ? 's' : ''} correction before ${requestedMode === 'approve' ? 'approval' : 'saving'}.`,
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
      const draftSavedCount = savedResults.filter(
        (result) => result.mode === 'draft' && result.question.applicable,
      ).length;
      const inactiveSavedCount = savedResults.filter(
        (result) => !result.question.applicable,
      ).length;
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
        draftSavedCount > 0
          ? `${draftSavedCount} question${draftSavedCount === 1 ? '' : 's'} saved as draft`
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-2 sm:p-4">
      <div className="flex h-[94vh] w-full max-w-[1280px] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-gradient-to-r from-cyan-50 via-white to-emerald-50 px-6 py-4">
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h3 className="text-xl font-black text-slate-900">Manual Knowledge Template</h3>
              <p className="mt-1 text-sm text-slate-600">
                Add and manage clinic-approved questions and answers section by section.
              </p>
            </div>
            <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:items-end lg:max-w-[640px]">
              <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={() => void saveEditedQuestions('draft')}
                  disabled={batchSaving || dirtyQuestionCount === 0 || loading}
                  className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {batchSaving
                    ? 'Saving edited questions...'
                    : `Save Draft (${dirtyQuestionCount})`}
                </button>
                <button
                  type="button"
                  onClick={() => void saveEditedQuestions('approve')}
                  disabled={batchSaving || dirtyQuestionCount === 0 || loading}
                  className="rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-xs font-bold text-green-800 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {batchSaving
                    ? 'Saving edited questions...'
                    : `Save & Approve Edited (${dirtyQuestionCount})`}
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
                <div className="mb-2 flex items-center justify-between gap-2 px-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Sections
                  </p>
                  <button
                    type="button"
                    onClick={() => setAddingSection(true)}
                    disabled={batchSaving || sectionActionKey !== null}
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                  >
                    + Add section
                  </button>
                </div>
                {addingSection && (
                  <div className="mb-3 rounded-xl border border-emerald-200 bg-white p-2">
                    <label
                      htmlFor="new-knowledge-section"
                      className="mb-1 block text-[11px] font-bold text-slate-600"
                    >
                      Section name
                    </label>
                    <input
                      id="new-knowledge-section"
                      value={newSectionTitle}
                      maxLength={80}
                      onChange={(event) => setNewSectionTitle(event.target.value)}
                      disabled={sectionActionKey !== null}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCreateSection()}
                        disabled={!newSectionTitle.trim() || sectionActionKey !== null}
                        className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
                      >
                        {sectionActionKey === 'new' ? 'Adding...' : 'Add'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingSection(false);
                          setNewSectionTitle('');
                        }}
                        disabled={sectionActionKey !== null}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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
                    <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1">
                        {renamingSectionKey === activeSection.key ? (
                          <div className="flex max-w-xl flex-wrap items-center gap-2">
                            <input
                              aria-label="Section name"
                              value={renamedSectionTitle}
                              maxLength={80}
                              onChange={(event) => setRenamedSectionTitle(event.target.value)}
                              disabled={sectionActionKey !== null}
                              className="min-w-[220px] flex-1 rounded-xl border border-cyan-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                            />
                            <button
                              type="button"
                              onClick={() => void handleRenameSection(activeSection.key)}
                              disabled={!renamedSectionTitle.trim() || sectionActionKey !== null}
                              className="rounded-xl bg-cyan-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                            >
                              {sectionActionKey === activeSection.key ? 'Saving...' : 'Save name'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingSectionKey(null);
                                setRenamedSectionTitle('');
                              }}
                              disabled={sectionActionKey !== null}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <h4 className="text-lg font-black text-slate-900">
                            {activeSection.title}
                          </h4>
                        )}
                        <p className="mt-1 text-sm text-slate-500">
                          Draft and approval actions process valid edits across every section.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleAddQuestion(activeSection.key)}
                          disabled={batchSaving || sectionActionKey !== null}
                          className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                        >
                          + Add question
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingSectionKey(activeSection.key);
                            setRenamedSectionTitle(activeSection.title);
                          }}
                          disabled={batchSaving || sectionActionKey !== null}
                          className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
                        >
                          Rename section
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemoveSection(activeSection.key)}
                          disabled={
                            batchSaving ||
                            sectionActionKey !== null ||
                            activeSectionHasPersistedApprovedQuestions
                          }
                          title={
                            activeSectionHasPersistedApprovedQuestions
                              ? 'Disable approved questions before removing this section.'
                              : undefined
                          }
                          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {sectionActionKey === activeSection.key
                            ? 'Removing...'
                            : 'Remove section'}
                        </button>
                      </div>
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
                        const removalRequiresDisable =
                          question.baseline.uiStatus === 'approved' ||
                          question.uiStatus === 'approved';
                        const removingQuestion = questionActionId === question.id;
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
                                  disabled={batchSaving}
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
                                  disabled={batchSaving}
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
                                  disabled={batchSaving}
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
                                    disabled={batchSaving}
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
                                    disabled={batchSaving}
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

                              <div className="flex items-center justify-end gap-2">
                                {removalRequiresDisable && (
                                  <span className="text-[11px] font-semibold text-slate-500">
                                    Make inactive and save before removal.
                                  </span>
                                )}
                                <button
                                  type="button"
                                  disabled={
                                    batchSaving ||
                                    questionActionId !== null ||
                                    removalRequiresDisable
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleRemoveQuestion(activeSection.key, question.id);
                                  }}
                                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {removingQuestion ? 'Removing...' : 'Remove question'}
                                </button>
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
