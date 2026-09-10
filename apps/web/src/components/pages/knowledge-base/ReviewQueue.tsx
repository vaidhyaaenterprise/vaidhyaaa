'use client';

import { useState } from 'react';
import type { KnowledgeEntry, Category } from './types';

interface ReviewQueueProps {
  entries: KnowledgeEntry[];
  categories: Category[];
  onApprove: (id: string) => void;
  onBulkApprove: (ids: string[]) => void;
  onEdit: (id: string, entry: Partial<KnowledgeEntry>) => void;
  onDisable: (id: string) => void;
}

export function ReviewQueue({
  entries,
  categories,
  onApprove,
  onBulkApprove,
  onEdit,
  onDisable,
}: ReviewQueueProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<KnowledgeEntry>>({});

  const handleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map(e => e.id)));
    }
  };

  const handleBulkApprove = () => {
    if (selectedIds.size > 0) {
      onBulkApprove(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  };

  const handleEditStart = (entry: KnowledgeEntry) => {
    setEditingId(entry.id);
    setEditForm({
      question: entry.question,
      answer: entry.answer,
      category: entry.category,
      alternativePhrases: entry.alternativePhrases,
    });
  };

  const handleEditSave = () => {
    if (editingId && editForm.question && editForm.answer && editForm.category) {
      onEdit(editingId, editForm);
      setEditingId(null);
      setEditForm({});
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditForm({});
  };

  const getCategoryName = (categoryId: string) => {
    return categories.find(c => c.id === categoryId)?.name || categoryId;
  };

  const getLanguageBadge = (language: string) => {
    return (
      <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
        {language}
      </span>
    );
  };

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-slate-900">Review queue</h3>
        <p className="text-sm text-slate-500">No pending entries to review</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900">Review queue</h3>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={handleBulkApprove}
              className="rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-800"
            >
              Approve selected ({selectedIds.size})
            </button>
          )}
          <button
            onClick={handleSelectAll}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
          >
            {selectedIds.size === entries.length ? 'Deselect all' : 'Select all'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`rounded-xl border p-4 ${
              editingId === entry.id
                ? 'border-teal-300 bg-teal-50'
                : 'border-slate-200 bg-slate-50'
            }`}
          >
            <div className="mb-3 flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(entry.id)}
                onChange={() => handleSelect(entry.id)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
              />
              <div className="flex-1">
                {editingId === entry.id ? (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                        Question
                      </label>
                      <textarea
                        value={editForm.question}
                        onChange={(e) => setEditForm({ ...editForm, question: e.target.value })}
                        className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                        rows={2}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                        Answer
                      </label>
                      <textarea
                        value={editForm.answer}
                        onChange={(e) => setEditForm({ ...editForm, answer: e.target.value })}
                        className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                        rows={3}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                        Category
                      </label>
                      <select
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                      >
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-bold text-slate-900">{entry.question}</h4>
                      {getLanguageBadge(entry.language)}
                    </div>
                    <p className="text-sm text-slate-600">{entry.answer}</p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold">{getCategoryName(entry.category)}</span>
                      {entry.source === 'upload' && <span>• Uploaded from DOCX</span>}
                    </div>
                    {entry.alternativePhrases.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold text-slate-500">Alternative phrases:</p>
                        <p className="text-xs text-slate-600">{entry.alternativePhrases.join(', ')}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              {editingId === entry.id ? (
                <>
                  <button
                    onClick={handleEditSave}
                    className="rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-800"
                  >
                    Save
                  </button>
                  <button
                    onClick={handleEditCancel}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => onApprove(entry.id)}
                    className="rounded-xl border-2 border-green-300 bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700 hover:bg-green-100"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleEditStart(entry)}
                    className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDisable(entry.id)}
                    className="rounded-xl border-2 border-red-300 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                  >
                    Disable
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
