'use client';

import { useState } from 'react';
import type { TemplateCoverage } from './types';

const MOCK_TEMPLATES: TemplateCoverage[] = [
  { templateKey: 'booking.greeting', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.ask_problem_or_doctor', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.ask_date', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.ask_time', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.propose_slots', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.ask_patient_name', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.ask_phone', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.confirm_details', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.confirm_doctor', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.slot_unavailable', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.thank_you', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.created_pending', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.created_confirmed', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.unsupported_service', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.flow_cancelled', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.ask_reason', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.ask_alternate_time', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.offer_help', taTanglishExists: true, englishExists: true },
  { templateKey: 'booking.ask_what_help', taTanglishExists: true, englishExists: true },
  { templateKey: 'fee.answer', taTanglishExists: true, englishExists: true },
  { templateKey: 'fee.followup_answer', taTanglishExists: true, englishExists: true },
  { templateKey: 'fee.ask_doctor', taTanglishExists: true, englishExists: true },
  { templateKey: 'fee.not_found', taTanglishExists: true, englishExists: true },
  { templateKey: 'timing.answer', taTanglishExists: true, englishExists: true },
  { templateKey: 'timing.day_answer', taTanglishExists: true, englishExists: true },
  { templateKey: 'timing.day_closed', taTanglishExists: true, englishExists: true },
  { templateKey: 'location.answer', taTanglishExists: true, englishExists: true },
  { templateKey: 'availability.today_slots', taTanglishExists: true, englishExists: true },
  { templateKey: 'availability.no_slots', taTanglishExists: true, englishExists: true },
  { templateKey: 'availability.not_available', taTanglishExists: true, englishExists: true },
  { templateKey: 'knowledge.answer', taTanglishExists: true, englishExists: true },
  { templateKey: 'knowledge.no_answer', taTanglishExists: true, englishExists: true },
  { templateKey: 'cancel.confirm', taTanglishExists: true, englishExists: true },
  { templateKey: 'cancel.completed', taTanglishExists: true, englishExists: true },
  { templateKey: 'cancel.not_cancelled', taTanglishExists: true, englishExists: true },
  { templateKey: 'cancel.no_appointment_found', taTanglishExists: true, englishExists: true },
  { templateKey: 'cancel.select_appointment', taTanglishExists: true, englishExists: true },
  { templateKey: 'cancel.request_submitted', taTanglishExists: true, englishExists: true },
  { templateKey: 'reschedule.ask_new_date', taTanglishExists: true, englishExists: true },
  { templateKey: 'reschedule.ask_new_time', taTanglishExists: true, englishExists: true },
  { templateKey: 'reschedule.propose_slots', taTanglishExists: true, englishExists: true },
  { templateKey: 'reschedule.confirm', taTanglishExists: true, englishExists: true },
  { templateKey: 'reschedule.completed', taTanglishExists: true, englishExists: true },
  { templateKey: 'reschedule.not_changed', taTanglishExists: true, englishExists: true },
  { templateKey: 'reschedule.request_submitted', taTanglishExists: true, englishExists: true },
  { templateKey: 'handoff.ask_reason', taTanglishExists: true, englishExists: true },
  { templateKey: 'handoff.ask_name', taTanglishExists: true, englishExists: true },
  { templateKey: 'handoff.ask_phone', taTanglishExists: true, englishExists: true },
  { templateKey: 'handoff.created', taTanglishExists: true, englishExists: true },
  { templateKey: 'handoff.cancelled', taTanglishExists: true, englishExists: true },
  { templateKey: 'safety.emergency', taTanglishExists: true, englishExists: true },
  { templateKey: 'safety.medical_advice_refusal', taTanglishExists: true, englishExists: true },
  { templateKey: 'unknown.clarify', taTanglishExists: true, englishExists: true },
  { templateKey: 'language.switched', taTanglishExists: true, englishExists: true },
];

export function TemplateCoverageDisplay() {
  const [filter, setFilter] = useState<'all' | 'missing'>('all');
  const [templates] = useState<TemplateCoverage[]>(MOCK_TEMPLATES);

  const filtered = filter === 'missing' ? templates.filter((t) => !t.taTanglishExists || !t.englishExists) : templates;
  const missingCount = templates.filter((t) => !t.taTanglishExists || !t.englishExists).length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                Internal
              </span>
              <h3 className="text-lg font-bold text-slate-900">Template coverage</h3>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              Verify that message templates exist for all supported languages.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {missingCount > 0 ? (
                <span className="font-bold text-red-600">{missingCount} missing</span>
              ) : (
                <span className="font-bold text-teal-600">All complete</span>
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-100 px-5 py-3">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              filter === 'all'
                ? 'bg-teal-700 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({templates.length})
          </button>
          <button
            onClick={() => setFilter('missing')}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              filter === 'missing'
                ? 'bg-red-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Missing ({missingCount})
          </button>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto p-1">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Template key</th>
              <th className="px-4 py-2.5 text-center">Tanglish</th>
              <th className="px-4 py-2.5 text-center">English</th>
              <th className="px-4 py-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tpl) => {
              const hasAll = tpl.taTanglishExists && tpl.englishExists;
              return (
                <tr key={tpl.templateKey} className="border-t border-slate-100 text-sm">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-800">
                    {tpl.templateKey}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {tpl.taTanglishExists ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs font-bold">
                        ✓
                      </span>
                    ) : (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600 text-xs font-bold">
                        ×
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {tpl.englishExists ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs font-bold">
                        ✓
                      </span>
                    ) : (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600 text-xs font-bold">
                        ×
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {hasAll ? (
                      <span className="inline-flex rounded-full bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-700">
                        Complete
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
                        Missing
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                  No templates found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
