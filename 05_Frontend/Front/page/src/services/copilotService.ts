import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Copiloto de campañas (Opción B). Ver PLAN_COPILOTO.md. Endpoint no-proxy (envelope),
 * detrás del Authorizer del portal:
 *   POST /Assistant/Copilot  { action: 'analyze'|'draft'|'rewrite', ... }
 * `analyze` es DETERMINISTA (sin IA); `draft`/`rewrite` usan Bedrock.
 */
export const COPILOT_ENDPOINT = '/Assistant/Copilot';

export type CopilotChannel = 'EM' | 'EAU' | 'EAP' | 'SMS' | 'WSP' | 'VOZ';

export interface AnalyzeIssue { type: string; severity: 'info' | 'warning' | 'critical'; message: string }
export interface HabeasData { ok: boolean; present: string[]; missing: string[]; requiredMissing: string[] }
export interface SendTime { suggestion: string; rationale: string; audience: string }
export interface AnalyzeResult {
  score: number;
  level: 'ok' | 'warning' | 'critical';
  issues: AnalyzeIssue[];
  suggestions: string[];
  habeasData: HabeasData;
  sendTime: SendTime;
}
export interface DraftResult { subjects?: string[]; body: string }
export interface RewriteResult { text: string }

export const copilotService = {
  /** Análisis determinista: spam/entregabilidad + Habeas Data + hora óptima. */
  analyze: (args: { channel: CopilotChannel; subject?: string; body: string; company?: string; audience?: string }): Promise<ApiResponse<AnalyzeResult>> =>
    apiPost(COPILOT_ENDPOINT, { action: 'analyze', ...args }),

  /** Redacta con IA (asunto(s) + cuerpo). */
  draft: (args: { objective: string; channel: CopilotChannel; audience?: string; tone?: string }): Promise<ApiResponse<DraftResult>> =>
    apiPost(COPILOT_ENDPOINT, { action: 'draft', ...args }),

  /** Mejora/reescribe un texto con IA. */
  rewrite: (args: { text: string; channel: CopilotChannel; goal?: string }): Promise<ApiResponse<RewriteResult>> =>
    apiPost(COPILOT_ENDPOINT, { action: 'rewrite', ...args }),
};
