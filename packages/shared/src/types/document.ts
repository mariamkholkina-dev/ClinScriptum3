export interface Document {
  id: string;
  studyId: string;
  type: DocumentType;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentType = "protocol" | "icf" | "ib" | "csr";

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  fileUrl: string;
  status: DocumentVersionStatus;
  createdAt: Date;
}

export type DocumentVersionStatus = "uploading" | "parsing" | "parsed" | "error";

export interface SourceAnchor {
  paragraphIndex?: number;
  sectionPath?: string[];
  pageNumber?: number;
  textSnippet?: string;
}
