'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { LanguageSettings as LanguageSettingsType, Language } from './types';

interface LanguageSettingsProps {
  settings: LanguageSettingsType;
  onUpdateSettings: (settings: Partial<LanguageSettingsType>) => void;
}

function getLanguageLabel(language: Language): string {
  switch (language) {
    case 'ta_tanglish':
      return 'Tanglish';
    case 'english':
      return 'English';
    case 'tamil':
      return 'Tamil';
  }
}

function getLanguageDescription(language: Language): string {
  switch (language) {
    case 'ta_tanglish':
      return 'Tamil written in English script — preferred by most patients';
    case 'english':
      return 'English — always enabled for fallback';
    case 'tamil':
      return 'Tamil — pure Tamil script';
  }
}

function LanguageBadge({ language, removable, onRemove }: { language: Language; removable?: boolean; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-teal-300 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
      {getLanguageLabel(language)}
      {removable && onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-teal-500 hover:bg-teal-200 hover:text-teal-800"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function LanguageSettings({ settings, onUpdateSettings }: LanguageSettingsProps) {
  const { effectiveRole } = useAuth();
  const isAdmin = effectiveRole === 'admin';

  const [isEditing, setIsEditing] = useState(false);
  const [tempSettings, setTempSettings] = useState<LanguageSettingsType>(settings);

  const handleEdit = () => {
    setTempSettings(settings);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTempSettings(settings);
  };

  const handleSave = () => {
    onUpdateSettings(tempSettings);
    setIsEditing(false);
  };

  const handleToggleLanguage = (language: Language) => {
    if (tempSettings.clinicLanguages.includes(language)) {
      setTempSettings({
        ...tempSettings,
        clinicLanguages: tempSettings.clinicLanguages.filter((l) => l !== language),
      });
    } else {
      setTempSettings({
        ...tempSettings,
        clinicLanguages: [...tempSettings.clinicLanguages, language],
      });
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Language settings</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Configure languages your clinic uses for voice conversations.
            </p>
          </div>
          {isAdmin && !isEditing && (
            <button
              onClick={handleEdit}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="p-5">
        {!isEditing || !isAdmin ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3.5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Default language</p>
                <p className="mt-0.5 text-sm text-slate-400">
                  Primary language used by Vaidya when speaking with patients
                </p>
              </div>
              <span className="rounded-full border-2 border-teal-300 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
                {getLanguageLabel(settings.defaultLanguage)}
              </span>
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Enabled languages</p>
              <div className="flex flex-wrap gap-2">
                {settings.clinicLanguages.map((lang) => (
                  <LanguageBadge key={lang} language={lang} />
                ))}
              </div>
              {settings.clinicLanguages.length === 0 && (
                <p className="text-sm text-slate-400">No languages enabled.</p>
              )}
            </div>

            {settings.missingTemplates.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5">
                <p className="text-xs font-bold text-amber-800">
                  Missing templates for: {settings.missingTemplates.map(getLanguageLabel).join(', ')}
                </p>
                <p className="mt-1 text-xs text-amber-700">
                  These languages are enabled but lack required templates. Add templates in the knowledge base.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Default language
              </label>
              <select
                value={tempSettings.defaultLanguage}
                onChange={(e) => setTempSettings({ ...tempSettings, defaultLanguage: e.target.value as Language })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              >
                <option value="ta_tanglish">Tanglish</option>
                <option value="english">English</option>
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Vaidya will use this language by default when initiating conversations.
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Enable languages</p>
              <div className="space-y-2">
                {settings.supportedLanguages.map((language) => {
                  const isAlwaysEnabled = language === 'english';
                  const enabled = tempSettings.clinicLanguages.includes(language);
                  return (
                    <label
                      key={language}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-colors ${
                        enabled
                          ? 'border-teal-200 bg-teal-50/50'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => handleToggleLanguage(language)}
                        disabled={isAlwaysEnabled}
                        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-bold text-slate-900">
                          {getLanguageLabel(language)}
                        </span>
                        <p className="text-xs text-slate-500">{getLanguageDescription(language)}</p>
                      </div>
                      {isAlwaysEnabled && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Required
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                className="rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-800"
              >
                Save
              </button>
              <button
                onClick={handleCancel}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
