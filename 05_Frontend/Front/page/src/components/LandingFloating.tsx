import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { askAssistant } from '../services/assistantService';

/**
 * Botones FLOTANTES de la landing (abajo-derecha):
 *  - WhatsApp: enlace directo a wa.me (cotización / soporte).
 *  - Asistente IA: abre un chat que responde preguntas sobre MailConnect (lambda Bedrock).
 *
 * Autocontenido (estilos en línea) para poder reusarlo fuera de la landing sin depender de
 * landing.css. Si el asistente no está disponible (lambda no desplegada), sugiere WhatsApp.
 */

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  fallback?: boolean; // true → mostrar enlace a WhatsApp bajo el mensaje
}

const BRAND = '#0075be';
const BRAND_CYAN = '#00c3ff';
const NAVY = '#16233f';
const WA_GREEN = '#25D366';

const WaIcon = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.6.2-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.7-.9-2.9-1.6-4-3.5-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5s-.6-1.5-.9-2.1c-.2-.5-.4-.4-.6-.4H8c-.2 0-.5.1-.7.3-.7.7-1 1.6-1 2.6.1 1.5.9 2.9 1 3.1.2.2 2.1 3.3 5.2 4.6 3 1.2 3 .8 3.6.8.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.1-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2z" />
  </svg>
);

const AiIcon = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="7" width="16" height="12" rx="3" />
    <path d="M12 7V4M9 3h6" />
    <circle cx="9" cy="13" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="13" r="1.3" fill="currentColor" stroke="none" />
    <path d="M9.5 16.5h5" />
  </svg>
);

const fab: CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  border: 'none',
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
  color: '#fff',
  boxShadow: '0 8px 24px rgba(16,35,63,.28)',
};

export const LandingFloating = ({ whatsappUrl }: { whatsappUrl: string }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      text: '¡Hola! 👋 Soy el asistente de MailConnect. Pregúntame sobre los canales (correo, SMS, WhatsApp, voz), precios, plantillas o cómo empezar.',
    },
  ]);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollDown = () => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  };

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setLoading(true);
    scrollDown();
    const res = await askAssistant(q);
    setLoading(false);
    setMessages((m) => [
      ...m,
      res.ok
        ? { role: 'assistant', text: res.answer as string }
        : {
            role: 'assistant',
            text: 'Ahora mismo no puedo responder. ¿Te ayudamos por WhatsApp?',
            fallback: true,
          },
    ]);
    scrollDown();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* Panel de chat */}
      {open && (
        <div
          role="dialog"
          aria-label="Asistente de MailConnect"
          style={{
            position: 'fixed',
            right: 20,
            bottom: 92,
            zIndex: 920,
            width: 'min(360px, calc(100vw - 32px))',
            maxHeight: 'min(70vh, 560px)',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(16,35,63,.32)',
            fontFamily: 'Nunito, system-ui, Arial, sans-serif',
          }}
        >
          <div style={{ background: `linear-gradient(135deg, ${BRAND_CYAN}, ${BRAND})`, color: '#04121f', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,.35)' }}>
              <AiIcon size={20} />
            </span>
            <div style={{ flex: 1, lineHeight: 1.15 }}>
              <strong style={{ display: 'block', fontSize: 15 }}>Asistente MailConnect</strong>
              <span style={{ fontSize: 11, opacity: 0.8 }}>Responde al instante</span>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: '#04121f', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
              ×
            </button>
          </div>

          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 14, background: '#f6f8fb', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 12,
                    fontSize: 14,
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    color: m.role === 'user' ? '#fff' : NAVY,
                    background: m.role === 'user' ? BRAND : '#fff',
                    border: m.role === 'user' ? 'none' : '1px solid #e4eaf2',
                    borderBottomRightRadius: m.role === 'user' ? 3 : 12,
                    borderBottomLeftRadius: m.role === 'user' ? 12 : 3,
                  }}
                >
                  {m.text}
                </div>
                {m.fallback && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, color: WA_GREEN, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}
                  >
                    <WaIcon size={16} /> Escribir por WhatsApp
                  </a>
                )}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-start', color: '#7b879c', fontSize: 13, fontStyle: 'italic', padding: '4px 6px' }}>
                Escribiendo…
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #e9edf3', background: '#fff' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Escribe tu pregunta…"
              aria-label="Escribe tu pregunta"
              style={{ flex: 1, resize: 'none', border: '1px solid #d6deea', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', maxHeight: 96 }}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              aria-label="Enviar"
              style={{ ...fab, width: 42, height: 42, borderRadius: 10, background: input.trim() && !loading ? BRAND : '#c3ccd9', boxShadow: 'none', flexShrink: 0 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>
            </button>
          </div>
          <div style={{ padding: '0 12px 10px', fontSize: 10.5, color: '#9aa6b6', textAlign: 'center', background: '#fff' }}>
            Respuestas generadas por IA — verifica datos sensibles con soporte.
          </div>
        </div>
      )}

      {/* Botones flotantes (se ocultan mientras el chat está abierto para no solaparse;
          el chat se cierra con la × de su encabezado). */}
      {!open && (
        <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 900, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            onClick={() => setOpen(true)}
            aria-label="Abrir asistente de IA"
            title="Pregúntale a la IA sobre MailConnect"
            style={{ ...fab, background: `linear-gradient(135deg, ${BRAND_CYAN}, ${BRAND})` }}
          >
            <AiIcon />
          </button>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Contactar por WhatsApp"
            title="Escríbenos por WhatsApp"
            style={{ ...fab, background: WA_GREEN, textDecoration: 'none' }}
          >
            <WaIcon />
          </a>
        </div>
      )}
    </>
  );
};

export default LandingFloating;
