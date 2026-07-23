export interface TemplateListItem {
  id: string;
  name: string;
  updatedAt: string;
}

export interface TemplateResponse {
  id: string;
  name: string;
  xml: string;
  updatedAt: string;
}

export interface ImageUploadResponse {
  id: string;
  url: string;
  name: string;
  sizeBytes: number;
}

export interface ExportRequest {
  templateId: string;
  data?: Record<string, unknown>;
  pages?: number[];
}
