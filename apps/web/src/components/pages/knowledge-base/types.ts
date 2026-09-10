export type KnowledgeStatus = 'pending_review' | 'approved' | 'disabled' | 'needs_update';
export type Language = 'english' | 'tamil' | 'tanglish';
export type ManualTemplateUiStatus = 'draft' | 'approved' | 'inactive';

export interface KnowledgeEntry {
  id: string;
  question: string;
  answer: string;
  category: string;
  alternativePhrases: string[];
  status: KnowledgeStatus;
   uiStatus?: ManualTemplateUiStatus;
  language: Language;
  source: 'manual' | 'upload';
  templateKey?: string | undefined;
  sectionKey?: string | undefined;
  sourceNotes?: string | undefined;
  serviceName?: string | undefined;
  applicable?: boolean | undefined;
  qaApproved?: boolean | undefined;
  serviceNameRequired?: boolean | undefined;
  exists?: boolean | undefined;
  sourceFileId?: string | undefined;
  sourceFile?: string | undefined;
  sourcePage?: number | undefined;
  createdAt: string;
  updatedAt: string;
  version?: number;
  auditLog?: AuditLog[];
}

export interface AuditLog {
  id: string;
  action: 'created' | 'approved' | 'edited' | 'disabled';
  performedBy: string;
  performedAt: string;
  previousValue?: string;
  newValue?: string;
}

export interface KnowledgeFile {
  id: string;
  fileName: string;
  uploadedAt: string;
  status: 'processing' | 'completed' | 'failed';
  error?: string;
  entriesCount?: number;
}

export interface Category {
  id: string;
  name: string;
  description: string;
}
