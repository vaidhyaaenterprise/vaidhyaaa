'use client';

import { useState } from 'react';
import type { KnowledgeFile } from './types';

interface DocxUploadProps {
  onUpload: (file: File) => void;
  uploadStatus: KnowledgeFile | null;
}

export function DocxUpload({ onUpload, uploadStatus }: DocxUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const docxFile = files.find(f => f.name.endsWith('.docx') || f.name.endsWith('.doc'));

    if (docxFile) {
      setSelectedFile(docxFile);
      onUpload(docxFile);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      onUpload(file);
    }
  };

  const getStatusBadge = () => {
    if (!uploadStatus) return null;

    switch (uploadStatus.status) {
      case 'processing':
        return (
          <span className="rounded-full border-2 border-blue-300 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
            Processing...
          </span>
        );
      case 'completed':
        return (
          <span className="rounded-full border-2 border-green-300 bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
            Completed
          </span>
        );
      case 'failed':
        return (
          <span className="rounded-full border-2 border-red-300 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
            Failed
          </span>
        );
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-bold text-slate-900">Upload DOCX template</h3>
      
      <div
        className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          isDragging
            ? 'border-teal-400 bg-teal-50'
            : 'border-slate-300 bg-slate-50 hover:border-slate-400'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".docx,.doc"
          onChange={handleFileSelect}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
        
        <div className="flex flex-col items-center gap-2">
          <svg className="h-12 w-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm font-semibold text-slate-700">
            Drag and drop your DOCX file here, or click to browse
          </p>
          <p className="text-xs text-slate-500">Only .docx files are supported</p>
        </div>
      </div>

      {selectedFile && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">{selectedFile.name}</p>
              <p className="text-xs text-slate-500">{(selectedFile.size / 1024).toFixed(2)} KB</p>
            </div>
            {getStatusBadge()}
          </div>
          
          {uploadStatus?.error && (
            <p className="mt-2 text-xs text-red-600">{uploadStatus.error}</p>
          )}
          
          {uploadStatus?.status === 'completed' && uploadStatus.entriesCount !== undefined && (
            <p className="mt-2 text-xs text-green-600">
              Successfully parsed {uploadStatus.entriesCount} Q&A entries
            </p>
          )}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs font-bold text-amber-800">
          ⚠ Uploaded rows will be pending review and never auto-approved
        </p>
        <p className="mt-1 text-xs text-amber-700">
          Use the review queue to approve entries after upload.
        </p>
      </div>
    </div>
  );
}
