'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { fetchClinicSettings, patchClinicSettings, type ClinicSettingsResponse } from '@/lib/api/clinic-settings';
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
    answeringMode: settings.answering_mode as AgentSettingsType['answeringMode'],
    bookingMode: settings.booking_mode as AgentSettingsType['bookingMode'],
    fallbackPhone: settings.fallback_phone ?? '',
    overflowAfterRings: settings.overflow_after_rings ?? 4,
    onboardingComplete: true,
  };
}

function mapSettingsToNotification(settings: ClinicSettingsResponse): NotificationSettingsType {
  return {
    notifyStaffOnPendingAppointment: settings.notify_staff_on_pending_appointment,
    pendingNotificationChannel:
      (settings.pending_appointment_notification_channel as NotificationSettingsType['pendingNotificationChannel']) ??
      'whatsapp',
    notificationContacts: [],
  };
}

export function SettingsPageContent() {
  const { effectiveRole } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';
  const isDoctor = effectiveRole === 'doctor';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentSettings, setAgentSettings] = useState<AgentSettingsType | null>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettingsType | null>(
    null,
  );
  const [languageSettings, setLanguageSettings] = useState<LanguageSettingsType>({
    supportedLanguages: ['ta_tanglish', 'english'],
    clinicLanguages: ['ta_tanglish', 'english'],
    defaultLanguage: 'ta_tanglish',
    missingTemplates: [],
  });
  const [subscription, setSubscription] = useState<SubscriptionPlan>({
    planKey: 'pilot',
    planName: 'Pilot',
    status: 'manual_free',
    includedVoiceMinutes: 500,
    usedVoiceMinutes: 0,
    maxConcurrentCalls: 3,
    recordingRetentionDays: 10,
    transcriptRetentionDays: 30,
  });
  const [notificationEvents] = useState<NotificationEvent[]>([]);

  const loadSettings = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [settings, subscriptionRow, usageRow, languagesRow, supported] = await Promise.all([
        isAdmin ? fetchClinicSettings(clinicId) : Promise.resolve(null),
        fetchClinicSubscription(clinicId).catch(() => null),
        fetchClinicUsage(clinicId).catch(() => null),
        fetchClinicLanguages(clinicId).catch(() => null),
        fetchSupportedLanguages().catch(() => []),
      ]);

      if (settings) {
        setAgentSettings(mapSettingsToAgent(settings));
        setNotificationSettings(mapSettingsToNotification(settings));
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
      setError(
        err instanceof ApiRequestError
          ? err.apiError.message
          : 'Failed to load clinic settings from the API.',
      );
    } finally {
      setLoading(false);
    }
  }, [clinicId, isAdmin]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleUpdateAgentSettings = async (settings: Partial<AgentSettingsType>) => {
    if (!clinicId || !agentSettings) {
      return;
    }
    const next = { ...agentSettings, ...settings };
    setAgentSettings(next);
    await patchClinicSettings(clinicId, {
      agent_enabled: next.agentEnabled,
      answering_mode: next.answeringMode,
      booking_mode: next.bookingMode,
      fallback_phone: next.fallbackPhone,
      overflow_after_rings: next.overflowAfterRings,
    });
  };

  const handleUpdateNotificationSettings = async (settings: Partial<NotificationSettingsType>) => {
    if (!clinicId || !notificationSettings) {
      return;
    }
    const next = { ...notificationSettings, ...settings };
    setNotificationSettings(next);
    await patchClinicSettings(clinicId, {
      notify_staff_on_pending_appointment: next.notifyStaffOnPendingAppointment,
      pending_appointment_notification_channel: next.pendingNotificationChannel,
    });
  };

  const handleTestNotification = () => {
    // Notification test API not yet exposed
  };

  const handleUpdateLanguageSettings = async (settings: Partial<LanguageSettingsType>) => {
    if (!clinicId || !isAdmin) {
      return;
    }
    const next = { ...languageSettings, ...settings };
    setLanguageSettings(next);
    await replaceClinicLanguages(clinicId, {
      default_language_code: next.defaultLanguage,
      languages: next.supportedLanguages.map((language) => ({
        language_code: language,
        enabled: next.clinicLanguages.includes(language),
        is_default: language === next.defaultLanguage,
      })),
    });
  };

  const handlePlanChange = async (change: PlatformSubscriptionChange) => {
    if (!clinicId) {
      return;
    }
    await changeClinicSubscription(clinicId, {
      plan_key: change.planKey,
      status: change.status,
      trial_end: change.trialEnd ?? null,
      notes: change.notes ?? null,
    });
    setSubscription((prev) => ({
      ...prev,
      planKey: change.planKey,
      status: change.status,
      ...(change.trialEnd !== undefined ? { trialEnd: change.trialEnd } : {}),
      ...(change.notes !== undefined ? { notes: change.notes } : {}),
    }));
    await loadSettings();
  };

  if (loading) {
    return <LoadingState title="Loading settings" description="Fetching clinic settings from the API." />;
  }

  if (error) {
    return (
      <ErrorState title="Could not load settings" description={error}>
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
              onTestNotification={handleTestNotification}
            />
          </>
        )}

        <LanguageSettings settings={languageSettings} onUpdateSettings={handleUpdateLanguageSettings} />

        {isAdmin && <SubscriptionDisplay subscription={subscription} />}

        {isAdmin && (
          <PlatformSubscriptionManager
            subscription={subscription}
            onPlanChange={(change) => void handlePlanChange(change)}
          />
        )}
      </div>
    </>
  );
}
