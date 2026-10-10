'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { AgentSettings } from '@/components/pages/settings/AgentSettings';
import { NotificationSettings } from '@/components/pages/settings/NotificationSettings';
import { LanguageSettings } from '@/components/pages/settings/LanguageSettings';
import { SubscriptionDisplay } from '@/components/pages/settings/SubscriptionDisplay';
import { PlatformSubscriptionManager } from '@/components/pages/settings/PlatformSubscriptionManager';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import {
  changeClinicSubscription,
  fetchClinicLanguages,
  fetchClinicSubscription,
  fetchClinicUsage,
  fetchSupportedLanguages,
  replaceClinicLanguages,
} from '@/lib/api/clinic-subscription';
import {
  fetchClinicSettings,
  patchClinicSettings,
  type ClinicSettingsResponse,
} from '@/lib/api/clinic-settings';
import type {
  AgentSettings as AgentSettingsType,
  Language,
  LanguageSettings as LanguageSettingsType,
  NotificationSettings as NotificationSettingsType,
  SubscriptionPlan,
  NotificationEvent,
  PlatformSubscriptionChange,
} from '@/components/pages/settings/types';

function mapSettingsToAgent(settings: ClinicSettingsResponse): AgentSettingsType {
  return {
    agentEnabled: settings.agent_enabled,
    bookingMode: settings.booking_mode as AgentSettingsType['bookingMode'],
    onboardingComplete: true,
  };
}

function mapSettingsToNotification(settings: ClinicSettingsResponse): NotificationSettingsType {
  return {
    notifyStaffOnPendingAppointment: settings.notify_staff_on_pending_appointment,
    notificationContacts: [],
  };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

async function readOptional<T>(request: Promise<T>, fallback: T): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return fallback;
  }
}

type OptionalSettingsData = {
  subscriptionRow: Awaited<ReturnType<typeof fetchClinicSubscription>> | null;
  usageRow: Awaited<ReturnType<typeof fetchClinicUsage>> | null;
  languagesRow: Awaited<ReturnType<typeof fetchClinicLanguages>> | null;
  supported: Awaited<ReturnType<typeof fetchSupportedLanguages>>;
};

async function loadOptionalSettingsData(clinicId: string, isAdmin: boolean, signal: AbortSignal) {
  const result: OptionalSettingsData = {
    subscriptionRow: null,
    usageRow: null,
    languagesRow: null,
    supported: [],
  };
  const loadLanguages = async () => {
    result.languagesRow = await readOptional(fetchClinicLanguages(clinicId, signal), null);
  };
  const loadSupportedLanguages = async () => {
    result.supported = await readOptional(fetchSupportedLanguages(signal), []);
  };
  const tasks: Array<() => Promise<void>> = isAdmin
    ? [
        async () => {
          result.subscriptionRow = await readOptional(
            fetchClinicSubscription(clinicId, signal),
            null,
          );
        },
        loadLanguages,
        async () => {
          result.usageRow = await readOptional(fetchClinicUsage(clinicId, signal), null);
        },
        loadSupportedLanguages,
      ]
    : [loadLanguages, loadSupportedLanguages];

  // Keep optional reads behind the required settings request and cap their
  // concurrency. A worker starts the next read as soon as its current read
  // settles, avoiding both a serverless request burst and batch head-of-line
  // blocking while preserving the existing optional-data fallbacks.
  let nextTaskIndex = 0;
  const runWorker = async () => {
    while (nextTaskIndex < tasks.length) {
      const task = tasks[nextTaskIndex];
      nextTaskIndex += 1;
      await task?.();
    }
  };
  await Promise.all([runWorker(), runWorker()]);

  return result;
}

const DEFAULT_LANGUAGE_SETTINGS: LanguageSettingsType = {
  supportedLanguages: ['ta_tanglish', 'english'],
  clinicLanguages: ['ta_tanglish', 'english'],
  defaultLanguage: 'ta_tanglish',
  missingTemplates: [],
};

const DEFAULT_SUBSCRIPTION: SubscriptionPlan = {
  planKey: 'pilot',
  planName: 'Pilot',
  status: 'manual_free',
  includedVoiceMinutes: 500,
  usedVoiceMinutes: 0,
  maxConcurrentCalls: 3,
  recordingRetentionDays: 10,
  transcriptRetentionDays: 30,
};

export function SettingsPageContent() {
  const { effectiveRole } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';
  const isDoctor = effectiveRole === 'doctor';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [agentSettings, setAgentSettings] = useState<AgentSettingsType | null>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettingsType | null>(
    null,
  );
  const [languageSettings, setLanguageSettings] =
    useState<LanguageSettingsType>(DEFAULT_LANGUAGE_SETTINGS);
  const [subscription, setSubscription] = useState<SubscriptionPlan>(DEFAULT_SUBSCRIPTION);
  const [notificationEvents] = useState<NotificationEvent[]>([]);
  const activeLoadControllerRef = useRef<AbortController | null>(null);
  const loadSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const activeClinicIdRef = useRef(clinicId);
  const postMutationReadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      postMutationReadAbortRef.current?.abort();
      postMutationReadAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    activeClinicIdRef.current = clinicId;
    postMutationReadAbortRef.current?.abort();
    postMutationReadAbortRef.current = null;
  }, [clinicId]);

  const loadSettings = useCallback(async () => {
    activeLoadControllerRef.current?.abort();
    const controller = new AbortController();
    activeLoadControllerRef.current = controller;
    const loadSequence = ++loadSequenceRef.current;
    const isCurrentLoad = () =>
      !controller.signal.aborted && loadSequence === loadSequenceRef.current;

    if (!clinicId) {
      if (isCurrentLoad()) {
        setAgentSettings(null);
        setNotificationSettings(null);
        setLanguageSettings(DEFAULT_LANGUAGE_SETTINGS);
        setSubscription(DEFAULT_SUBSCRIPTION);
        setLoading(false);
        activeLoadControllerRef.current = null;
      }
      return;
    }
    setLoading(true);
    setError(null);
    setAgentSettings(null);
    setNotificationSettings(null);
    setLanguageSettings(DEFAULT_LANGUAGE_SETTINGS);
    setSubscription(DEFAULT_SUBSCRIPTION);
    try {
      // Core settings are required. Give this read priority so an optional
      // request cannot consume the last available upstream/database capacity.
      // The shared API client already applies one bounded retry to GETs. Keep
      // one retry budget here so a persistent outage cannot multiply timeouts.
      const settings = isAdmin ? await fetchClinicSettings(clinicId, controller.signal) : null;

      if (!isCurrentLoad()) {
        return;
      }

      if (settings) {
        setAgentSettings(mapSettingsToAgent(settings));
        setNotificationSettings(mapSettingsToNotification(settings));
      }

      const { subscriptionRow, usageRow, languagesRow, supported } = await loadOptionalSettingsData(
        clinicId,
        isAdmin,
        controller.signal,
      );

      if (!isCurrentLoad()) {
        return;
      }

      if (languagesRow) {
        setLanguageSettings({
          supportedLanguages: supported
            .filter((row) => row.enabled_platform_wide)
            .map((row) => row.language_code as Language),
          clinicLanguages: languagesRow.languages
            .filter((row) => row.enabled)
            .map((row) => row.language_code as Language),
          defaultLanguage: languagesRow.default_language_code as Language,
          missingTemplates: [],
        });
      }

      if (subscriptionRow) {
        setSubscription({
          planKey: subscriptionRow.plan_key,
          planName: subscriptionRow.plan_name,
          status: subscriptionRow.status as SubscriptionPlan['status'],
          includedVoiceMinutes: subscriptionRow.included_voice_minutes,
          usedVoiceMinutes: usageRow?.used_voice_minutes ?? 0,
          maxConcurrentCalls: subscriptionRow.max_concurrent_calls,
          recordingRetentionDays: subscriptionRow.recording_retention_days,
          transcriptRetentionDays: subscriptionRow.transcript_retention_days,
          ...(subscriptionRow.trial_end ? { trialEnd: subscriptionRow.trial_end } : {}),
          ...(subscriptionRow.notes ? { notes: subscriptionRow.notes } : {}),
        });
      } else if (settings) {
        setSubscription((prev) => ({
          ...prev,
          maxConcurrentCalls: settings.max_concurrent_calls,
          recordingRetentionDays: settings.recording_retention_days,
          transcriptRetentionDays: settings.transcript_retention_days,
        }));
      }
    } catch (err) {
      if (!isCurrentLoad() || isAbortError(err)) {
        return;
      }
      const message =
        err instanceof ApiRequestError
          ? err.apiError.message
          : 'Failed to load clinic settings from the API.';
      const requestId = err instanceof ApiRequestError ? err.apiError.requestId : undefined;
      setError({ message, ...(requestId ? { requestId } : {}) });
    } finally {
      if (isCurrentLoad()) {
        setLoading(false);
        if (activeLoadControllerRef.current === controller) {
          activeLoadControllerRef.current = null;
        }
      }
    }
  }, [clinicId, isAdmin]);

  useEffect(() => {
    void loadSettings();
    return () => {
      activeLoadControllerRef.current?.abort();
      activeLoadControllerRef.current = null;
      loadSequenceRef.current += 1;
    };
  }, [loadSettings]);

  const handleUpdateAgentSettings = async (settings: Partial<AgentSettingsType>) => {
    if (!clinicId || !agentSettings) {
      return;
    }
    const targetClinicId = clinicId;
    const next = { ...agentSettings, ...settings };
    const saved = await patchClinicSettings(targetClinicId, {
      agent_enabled: next.agentEnabled,
      booking_mode: next.bookingMode,
    });
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      setAgentSettings(mapSettingsToAgent(saved));
    }
  };

  const handleUpdateNotificationSettings = async (settings: Partial<NotificationSettingsType>) => {
    if (!clinicId || !notificationSettings) {
      return;
    }
    const targetClinicId = clinicId;
    const next = { ...notificationSettings, ...settings };
    const saved = await patchClinicSettings(targetClinicId, {
      notify_staff_on_pending_appointment: next.notifyStaffOnPendingAppointment,
    });
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      setNotificationSettings(mapSettingsToNotification(saved));
    }
  };

  const handleUpdateLanguageSettings = async (settings: Partial<LanguageSettingsType>) => {
    if (!clinicId || !isAdmin) {
      return;
    }
    const targetClinicId = clinicId;
    const next = { ...languageSettings, ...settings };
    const saved = await replaceClinicLanguages(targetClinicId, {
      default_language_code: next.defaultLanguage,
      languages: next.supportedLanguages.map((language) => ({
        language_code: language,
        enabled: next.clinicLanguages.includes(language),
        is_default: language === next.defaultLanguage,
      })),
    });
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      setLanguageSettings({
        ...next,
        clinicLanguages: saved.languages
          .filter((language) => language.enabled)
          .map((language) => language.language_code as Language),
        defaultLanguage: saved.default_language_code as Language,
      });
    }
  };

  const handlePlanChange = async (change: PlatformSubscriptionChange) => {
    if (!clinicId) {
      return;
    }
    const targetClinicId = clinicId;
    await changeClinicSubscription(targetClinicId, {
      plan_key: change.planKey,
      status: change.status,
      trial_end: change.trialEnd ?? null,
      notes: change.notes ?? null,
    });
    if (!mountedRef.current || activeClinicIdRef.current !== targetClinicId) {
      return;
    }
    postMutationReadAbortRef.current?.abort();
    const controller = new AbortController();
    postMutationReadAbortRef.current = controller;
    let saved: Awaited<ReturnType<typeof fetchClinicSubscription>>;
    try {
      saved = await fetchClinicSubscription(targetClinicId, controller.signal);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return;
      }
      throw error;
    } finally {
      if (postMutationReadAbortRef.current === controller) {
        postMutationReadAbortRef.current = null;
      }
    }
    if (!mountedRef.current || activeClinicIdRef.current !== targetClinicId) {
      return;
    }
    setSubscription((previous) => ({
      planKey: saved.plan_key,
      planName: saved.plan_name,
      status: saved.status as SubscriptionPlan['status'],
      includedVoiceMinutes: saved.included_voice_minutes,
      usedVoiceMinutes: previous.usedVoiceMinutes,
      maxConcurrentCalls: saved.max_concurrent_calls,
      recordingRetentionDays: saved.recording_retention_days,
      transcriptRetentionDays: saved.transcript_retention_days,
      ...(saved.trial_end ? { trialEnd: saved.trial_end } : {}),
      ...(saved.notes ? { notes: saved.notes } : {}),
    }));
  };

  if (loading) {
    return (
      <LoadingState title="Loading settings" description="Fetching clinic settings from the API." />
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load settings"
        description={`${error.message}${error.requestId ? ` Reference ID: ${error.requestId}.` : ''}`}
      >
        <button
          type="button"
          onClick={() => void loadSettings()}
          className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
        >
          Retry
        </button>
      </ErrorState>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          isDoctor
            ? 'View clinic settings and language preferences.'
            : 'Configure agent behavior, notifications, languages, and view subscription details.'
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {isAdmin && agentSettings && notificationSettings && (
          <>
            <AgentSettings settings={agentSettings} onUpdateSettings={handleUpdateAgentSettings} />
            <NotificationSettings
              settings={notificationSettings}
              notificationEvents={notificationEvents}
              onUpdateSettings={handleUpdateNotificationSettings}
            />
          </>
        )}

        <LanguageSettings
          settings={languageSettings}
          onUpdateSettings={handleUpdateLanguageSettings}
        />

        {isAdmin && <SubscriptionDisplay subscription={subscription} />}

        {isAdmin && (
          <PlatformSubscriptionManager
            subscription={subscription}
            onPlanChange={handlePlanChange}
          />
        )}
      </div>
    </>
  );
}
