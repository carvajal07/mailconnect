import { AUTH_API_BASE } from '../config/api';

/**
 * Cliente del ASISTENTE de IA (lambda pública Api_V1_Assistant_Ask → AWS Bedrock).
 * No usa apiClient (no requiere sesión): la landing lo llama sin login. Degrada con
 * gracia si el endpoint aún no está desplegado (para sugerir WhatsApp en la UI).
 */
export const ASSISTANT_ENDPOINT = '/Assistant/Ask';

export interface AssistantResult {
  ok: boolean;
  answer?: string;
  /** 'model' = el modelo falló; 'network' = no se pudo contactar (o no desplegado). */
  error?: string;
  reason?: 'model' | 'network';
}

export async function askAssistant(question: string): Promise<AssistantResult> {
  try {
    const res = await fetch(`${AUTH_API_BASE}${ASSISTANT_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await res.json().catch(() => ({} as { answer?: string; error?: string }));
    if (res.ok && data.answer) return { ok: true, answer: data.answer };
    return { ok: false, error: data.error || 'No se pudo obtener respuesta.', reason: 'model' };
  } catch {
    // CORS/404/red: el asistente no está disponible (p. ej. lambda no desplegada).
    return { ok: false, error: 'No se pudo contactar al asistente.', reason: 'network' };
  }
}
