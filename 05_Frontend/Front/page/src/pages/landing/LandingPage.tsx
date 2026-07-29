import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MailConnectLogo } from '../../components/MailConnectLogo';
import { LandingFloating } from '../../components/LandingFloating';
import { PRECIOS_CANAL, cop } from './precios';
import './landing.css';

/* Resultado de la activación de cuenta. La lambda Acount-activation redirige a
   /?activacion=ok|error|expirado (la raíz SIEMPRE carga, sin depender de rewrites del
   host para rutas profundas). Se muestra un aviso claro sobre la landing. */
const ACTIVACION_MSG: Record<string, { titulo: string; texto: string; color: string }> = {
  ok: { titulo: '¡Cuenta activada!', texto: 'Tu cuenta quedó activada. Ya puedes iniciar sesión.', color: '#1fbf87' },
  expirado: { titulo: 'El enlace expiró', texto: 'El enlace de activación ya no es válido (expira a las 24 horas). Regístrate de nuevo o solicita el reenvío.', color: '#ff9d2e' },
  error: { titulo: 'No se pudo activar', texto: 'El enlace no es válido o ya fue usado. Si tu cuenta ya está activa, inicia sesión normalmente.', color: '#ff5c72' },
};

const ActivacionAviso = () => {
  const [params] = useSearchParams();
  const raw = (params.get('activacion') || '').toLowerCase();
  const info = ACTIVACION_MSG[raw];
  const [open, setOpen] = useState(true);
  const caja = useRef<HTMLDivElement | null>(null);
  const abierto = Boolean(info) && open;

  /**
   * Accesibilidad del diálogo: cerrar con Escape, atrapar el Tab dentro y mover el foco al
   * abrirse. Sin esto, quien navega con teclado o lector de pantalla queda tabulando por la
   * landing de atrás mientras el modal la tapa, y solo puede cerrarlo con el ratón.
   */
  useEffect(() => {
    if (!abierto) return;
    const enfocables = () => Array.from(
      caja.current?.querySelectorAll<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])') ?? []);

    // El foco entra al diálogo; el `?? caja.current` cubre el caso sin nada enfocable.
    (enfocables()[0] ?? caja.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab') return;
      const items = enfocables();
      if (!items.length) return;
      const primero = items[0];
      const ultimo = items[items.length - 1];
      // Ciclo: del último al primero con Tab, y al revés con Shift+Tab.
      if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      else if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [abierto]);

  if (!info || !open) return null;
  return (
    <div role="dialog" aria-modal="true"
      aria-labelledby="activacion-titulo" aria-describedby="activacion-texto"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(10,18,32,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={() => setOpen(false)}>
      <div ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', color: '#16233f', maxWidth: 420, width: '100%', borderRadius: 16,
          padding: '28px 24px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.3)', outline: 'none' }}>
        <div aria-hidden="true"
          style={{ width: 64, height: 64, margin: '0 auto 12px', borderRadius: '50%',
            background: info.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 34, fontWeight: 800 }}>
          {raw === 'ok' ? '✓' : raw === 'expirado' ? '⏱' : '!'}
        </div>
        <h2 id="activacion-titulo" style={{ margin: '0 0 8px', fontSize: 22 }}>{info.titulo}</h2>
        <p id="activacion-texto" style={{ margin: '0 0 20px', color: '#4b5b7e', lineHeight: 1.5 }}>{info.texto}</p>
        <Link to="/login" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#00c3ff,#0075be)',
          color: '#04121f', fontWeight: 800, textDecoration: 'none', padding: '12px 26px', borderRadius: 10 }}>
          Iniciar sesión
        </Link>
        <button type="button" onClick={() => setOpen(false)}
          style={{ display: 'block', margin: '14px auto 0', background: 'none', border: 0,
            color: '#5b6b86', font: 'inherit', fontSize: 14, cursor: 'pointer', textDecoration: 'underline' }}>
          Cerrar
        </button>
      </div>
    </div>
  );
};

/* === Configuración de contacto por WhatsApp ===
   1) Cambia WHATSAPP_PHONE por el número REAL de MailConnect en formato
      internacional, SIN "+", espacios ni guiones. Ej: 57 + celular -> '573001234567'.
   2) whatsappUrl() arma el enlace con un mensaje pre-cargado (editable). */
const WHATSAPP_PHONE = '573204586576'; // Número real de MailConnect (57 + 320 458 6576)
const WHATSAPP_MSG = 'Hola, quiero solicitar una cotización de MailConnect.';
/** Correo público de contacto (el mismo remitente verificado en SES). */
const CORREO_CONTACTO = 'comunicaciones@mailconnect.com.co';
const whatsappUrl = (msg: string = WHATSAPP_MSG) =>
  `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(msg)}`;

/* Logo oficial de WhatsApp (trazado del glifo de marca). El que había en la tarjeta del
   canal era un bocadillo genérico de contorno, que no se lee como WhatsApp. */
const WhatsAppGlyph = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.47 14.38c-.29-.15-1.7-.84-1.97-.94-.26-.1-.45-.14-.64.15-.19.28-.74.93-.9 1.12-.17.19-.33.21-.62.07-.29-.15-1.22-.45-2.33-1.44-.86-.77-1.44-1.72-1.61-2-.17-.29-.02-.45.13-.59.13-.13.29-.34.44-.51.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.14-.64-1.55-.88-2.13-.23-.56-.47-.48-.64-.49h-.55c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.38s1.02 2.76 1.17 2.95c.14.19 2.01 3.08 4.88 4.32.68.29 1.21.47 1.63.6.68.22 1.31.19 1.8.11.55-.08 1.7-.69 1.94-1.37.24-.67.24-1.25.17-1.37-.07-.12-.26-.19-.55-.33z" />
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2m0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23a8.18 8.18 0 0 1 5.82 2.42 8.17 8.17 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23" />
  </svg>
);

const BARS = [38, 56, 47, 72, 63, 88, 70, 95, 80];

export const LandingPage = () => {
  return (
    <div className="mc-landing">
      <ActivacionAviso />

      {/* ================= NAV ================= */}
      <header className="nav">
        <div className="wrap nav-inner">
          <MailConnectLogo height={34} />
          <nav className="nav-links">
            <a href="#canales">Canales</a>
            <a href="#funciones">Funciones</a>
            <a href="#correspondencia">Correspondencia</a>
            <a href="#precios">Precios</a>
          </nav>
          <div className="nav-cta">
            <Link to="/login" className="btn btn-ghost btn-sm">Iniciar sesión</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Crear cuenta</Link>
          </div>
        </div>
      </header>

      {/* ================= HERO ================= */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">Correo masivo · Comunicaciones omnicanal</span>
            <h1>Envía <span className="accent">correo masivo</span> que sí llega a la bandeja de entrada.</h1>
            <p className="lead">Diseña, segmenta y envía campañas de <strong>email marketing, SMS, WhatsApp y voz</strong> desde una sola plataforma. Con plantillas, combinación de correspondencia y métricas en tiempo real, sobre infraestructura AWS de alta entregabilidad.</p>
            <div className="price-flag"><b>Precio por volumen</b><small>cotización a la medida de tu operación</small></div>
            <div className="hero-actions">
              <Link to="/register" className="btn btn-primary">Crear cuenta
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
              <a href={whatsappUrl()} className="btn btn-wa" target="_blank" rel="noopener noreferrer">
                <WhatsAppGlyph size={17} />
                Cotizar por WhatsApp
              </a>
            </div>
            <div className="hero-trust">
              <span><span className="tick">✓</span> Sin tarjeta de crédito</span>
              <span><span className="tick">✓</span> Saldo prepago sin vencimiento mensual</span>
              <span><span className="tick">✓</span> Soporte en español</span>
            </div>
          </div>

          {/* Dashboard mock */}
          <div className="panel" aria-hidden="true">
            <div className="panel-head"><b>Campaña · Newsletter Junio</b><span className="pill">● Enviando</span></div>
            <div className="kpis">
              <div className="kpi"><b>48.250</b><span>Enviados</span></div>
              <div className="kpi"><b>61%</b><span>Apertura</span></div>
              <div className="kpi"><b>24%</b><span>Clics</span></div>
            </div>
            <div className="bars">
              {BARS.map((h, i) => (<div key={i} className="bar" style={{ height: `${h}%` }} />))}
            </div>
            <div className="chan-mini">
              <span className="chan-tag"><i className="dot-brand" />Email</span>
              <span className="chan-tag"><i className="dot-amber" />SMS</span>
              <span className="chan-tag"><i className="dot-green" />WhatsApp</span>
              <span className="chan-tag"><i className="dot-violet" />Voz</span>
            </div>
          </div>
        </div>
      </section>

      {/* ================= TRUST BAR ================= */}
      <div className="trustbar">
        <div className="wrap">
          <span className="tbadge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V5z" /><path d="m9 12 2 2 4-4" /></svg> Ley 1581 · Habeas Data</span>
          <span className="tbadge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64" /><path d="M12 2v10" /></svg> Política anti-spam</span>
          <span className="tbadge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> DKIM · SPF · DMARC</span>
          <span className="tbadge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.5 19a4.5 4.5 0 1 0 0-9 6 6 0 0 0-11.6-1.5A4 4 0 0 0 6 19z" /></svg> Infraestructura AWS</span>
        </div>
      </div>

      {/* ================= CANALES ================= */}
      <section id="canales">
        <div className="wrap">
          <div className="center">
            <span className="eyebrow">Canales</span>
            <h2>Un mensaje, todos los canales</h2>
            <p className="lead">Reutiliza tus plantillas y contactos en cada canal y mide todo desde un mismo panel.</p>
          </div>
          <div className="grid g4" style={{ marginTop: 46 }}>
            <div className="card">
              <span className="ico email"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg></span>
              <h3>Email marketing</h3>
              <p>Campañas y transaccionales con plantillas HTML personalizadas. Newsletters, promociones y automatizaciones.</p>
              <span className="tagpill">Plantillas HTML</span>
            </div>
            <div className="card">
              <span className="ico sms"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></span>
              <h3>SMS</h3>
              <p>Mensajes de texto a móviles con segmentación y gestión de opt-in / opt-out para cumplir la normativa.</p>
              <span className="tagpill">Cobertura nacional</span>
            </div>
            <div className="card">
              <span className="ico wa"><WhatsAppGlyph /></span>
              <h3>WhatsApp</h3>
              <p>API oficial de WhatsApp Business: plantillas aprobadas, multimedia y respuestas automáticas.</p>
              <span className="tagpill">API oficial</span>
            </div>
            <div className="card">
              <span className="ico voice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg></span>
              <h3>Voz</h3>
              <p>Llamadas con mensajes pregrabados o texto-a-voz para recordatorios, alertas y campañas.</p>
              <span className="tagpill">Texto a voz</span>
            </div>
          </div>
        </div>
      </section>

      {/* ================= FUNCIONES (A + B) ================= */}
      <section id="funciones" style={{ background: 'var(--bg-alt)' }}>
        <div className="wrap">
          <div className="center">
            <span className="eyebrow">Funciones</span>
            <h2>Todo lo que necesitas para enviar como un profesional</h2>
            <p className="lead">Desde el diseño de la plantilla hasta la depuración de la base, el envío masivo y el reporte final.</p>
          </div>
          <div className="grid g3" style={{ marginTop: 46 }}>
            <div className="feature"><span className="ico soft"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg></span>
              <div><h3>Editor drag &amp; drop</h3><p>Arma tus correos con bloques prediseñados y plantillas responsive, sin saber de código.</p></div></div>

            <div className="feature"><span className="ico soft"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v4H4zM4 12h10v8H4zM18 12h2v8h-2z" /></svg></span>
              <div><h3>Plantillas reutilizables</h3><p>Plantillas HTML personalizables para marketing, notificaciones transaccionales y correos con adjuntos.</p></div></div>

            <div className="feature"><span className="ico soft"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="7" r="3" /><path d="M2 21v-1a6 6 0 0 1 12 0v1M16 3.13a4 4 0 0 1 0 7.75M22 21v-1a6 6 0 0 0-4-5.65" /></svg></span>
              <div><h3>Contactos y segmentación</h3><p>Listas ilimitadas y segmentos por cliente, campaña o atributos para dirigir cada envío.</p></div></div>

            <div className="feature"><span className="ico soft"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 11v5M14 11v5" /></svg></span>
              <div><h3>Depurador de listas</h3><p>Lista negra por cliente y validación de correos para proteger la reputación de tu IP de envío.</p></div></div>

            <div className="feature"><span className="ico soft"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0zM12 7v5l3 2" /></svg></span>
              <div><h3>Programación de envíos</h3><p>Agenda campañas por fecha u hora y envía muestras de prueba antes del disparo real.</p></div></div>

            <div className="feature"><span className="ico soft"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M7 15l4-4 3 3 5-6" /></svg></span>
              <div><h3>Estadísticas en tiempo real</h3><p>Entregas, aperturas, clics y rebotes por campaña y canal, con reportes exportables.</p></div></div>

            <div className="feature"><span className="ico soft"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2 2 7l10 5 10-5zM2 12l10 5 10-5M2 17l10 5 10-5" /></svg></span>
              <div><h3>Envíos masivos por lotes</h3><p>Procesamiento por lotes con colas (SQS) para enviar a miles de destinatarios sin cuellos de botella.</p></div></div>

            <div className="feature"><span className="ico soft"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05 12 20.5 3 11.5V6a2 2 0 0 1 2-2h5.5M15 3h6v6M21 3l-9 9" /></svg></span>
              <div><h3>Adjuntos personalizados</h3><p>Envía facturas, recibos o certificados individuales a cada destinatario en el mismo envío.</p></div></div>

            <div className="feature"><span className="ico soft"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>
              <div><h3>Seguridad y accesos</h3><p>Autenticación con OTP, recuperación de contraseña y control de accesos para operar con tranquilidad.</p></div></div>
          </div>
        </div>
      </section>

      {/* ================= COMBINACIÓN DE CORRESPONDENCIA ================= */}
      <section id="correspondencia" className="merge">
        <div className="wrap merge-grid">
          <div>
            <span className="eyebrow">Combinación de correspondencia</span>
            <h2>Documentos personalizados, a escala</h2>
            <p className="lead">Genera miles de documentos únicos por destinatario a partir de una plantilla y tu base de datos. Ahorra tiempo y elimina errores humanos.</p>
            <div className="doc-list">
              <div className="doc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg> Cartas</div>
              <div className="doc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2h9l5 5v15H6z" /><path d="M9 13h6M9 17h6" /></svg> Facturas</div>
              <div className="doc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 3h16v18l-3-2-2 2-3-2-3 2-2-2-3 2z" /></svg> Recibos</div>
              <div className="doc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="9" r="5" /><path d="M8 13l-2 8 6-3 6 3-2-8" /></svg> Certificados</div>
              <div className="doc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /></svg> Invitaciones</div>
              <div className="doc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v12H4z" /><path d="M8 20h8M12 16v4" /></svg> Informes</div>
            </div>
          </div>
          <div className="panel panel--merge">
            <div className="panel-head"><b style={{ color: '#fff' }}>plantilla_certificado.html</b><span className="pill">4.134 generados</span></div>
            <div className="merge-code">
              Estimado <span className="mc-var">{'{{nombre}}'}</span>,<br />
              certificamos que <span className="mc-var">{'{{empresa}}'}</span><br />
              completó el curso el <span className="mc-var">{'{{fecha}}'}</span>.<br />
              Código: <span className="mc-var-ok">{'{{codigo}}'}</span>
            </div>
            <div className="chan-mini" style={{ marginTop: 20 }}>
              <span className="chan-tag chan-tag--dark"><i className="dot-green" /> PDF por destinatario</span>
              <span className="chan-tag chan-tag--dark"><i className="dot-brand" /> Envío con adjunto</span>
            </div>
          </div>
        </div>
      </section>

      {/* ================= CÓMO FUNCIONA ================= */}
      <section>
        <div className="wrap">
          <div className="center"><span className="eyebrow">Cómo funciona</span><h2>De la idea al envío en 4 pasos</h2></div>
          <div className="steps" style={{ marginTop: 46 }}>
            <div className="step"><div className="num">1</div><h3>Diseña</h3><p>Crea tu plantilla con el editor o parte de una prediseñada.</p></div>
            <div className="step"><div className="num">2</div><h3>Carga y depura</h3><p>Sube tu base, valídala y arma el segmento exacto.</p></div>
            <div className="step"><div className="num">3</div><h3>Prueba y programa</h3><p>Envía muestras y agenda el disparo real.</p></div>
            <div className="step"><div className="num">4</div><h3>Mide</h3><p>Sigue aperturas, clics y entregas en tiempo real.</p></div>
          </div>
        </div>
      </section>

      {/* ================= PRECIOS ================= */}
      {/* ================= PRECIOS =================
          Sin cifras a propósito (ago 2026). Las que había (planes de $190.000 / $750.000 /
          $1.300.000 y una tabla de volumen) NO coincidían con lo que cobra el sistema —la
          landing decía $19 por correo a 10.000 y el backend cobraba $25—, así que un cliente
          se registraba con un número y se encontraba otro. Además SMS, WhatsApp y voz tienen
          costo variable por operador: publicar una tarifa fija ahí amarra el margen. El
          precio real vive en `pricingRate` y se cotiza por cliente. */}
      <section id="precios" style={{ background: 'var(--bg-alt)' }}>
        <div className="wrap">
          <div className="center">
            <span className="eyebrow">Precios</span>
            <h2>Paga solo por lo que envías</h2>
            <p className="lead">Modelo <strong>prepago</strong>: recargas tu saldo y se descuenta por envío, sin mensualidad ni permanencia. El precio por mensaje baja con el volumen y cada canal se cotiza según tu operación.</p>
          </div>

          <div className="grid g3" style={{ marginTop: 46 }}>
            <div className="card">
              <h3>Sin cuota fija</h3>
              <p>No pagas mensualidad ni contratos de permanencia. Recargas cuando lo necesitas y el saldo no se vence al final del mes.</p>
            </div>
            <div className="card">
              <h3>Precio por volumen</h3>
              <p>Entre más envíos, menor costo por mensaje. Te pasamos la tabla de tramos de tu canal junto con la cotización.</p>
            </div>
            <div className="card">
              <h3>Lo ves antes de enviar</h3>
              <p>La plataforma te muestra el costo estimado exacto de cada campaña —con IVA y desglose— antes de confirmar el envío.</p>
            </div>
          </div>

          {/* Tabla "desde": precios de referencia por canal, tomados de `precios.ts`, que a
              su vez es espejo de VOLUME_TIERS del backend. NO es la tabla completa de
              tramos —esa va en la cotización—: se publican el punto de partida y algunos
              volúmenes para que se entienda que baja con el volumen. */}
          <div className="pricetable pricetable--canales" style={{ marginTop: 40 }}>
            <table>
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Desde</th>
                  <th>1.000</th>
                  <th>10.000</th>
                  <th>100.000</th>
                </tr>
              </thead>
              <tbody>
                {PRECIOS_CANAL.map((c) => (
                  <tr key={c.canal}>
                    <td>
                      <b>{c.canal}</b>
                      <small style={{ display: 'block', color: 'var(--text-muted)' }}>{c.unidad}</small>
                    </td>
                    <td className="per-cell">{cop(c.desde)}</td>
                    {c.ejemplos.map((e) => (
                      <td key={e.volumen}>{cop(e.unitario)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="price-fine">
            <li>Valores en pesos colombianos, <b>sin IVA</b>, por unidad enviada. El precio baja por tramos a medida que sube el volumen mensual; arriba solo se muestran tres puntos de referencia.</li>
            {PRECIOS_CANAL.filter((c) => c.nota).map((c) => (
              <li key={c.canal}><b>{c.canal}:</b> {c.nota}</li>
            ))}
            <li>Correo con adjunto (único o personalizado por destinatario) tiene su propia tarifa; se cotiza aparte.</li>
          </ul>

          <div className="center" style={{ marginTop: 40 }}>
            <div className="hero-actions" style={{ justifyContent: 'center' }}>
              <a href={whatsappUrl('Hola, quiero cotizar el envío masivo con MailConnect. Les cuento mi volumen y canales.')} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
                Cotizar por WhatsApp
              </a>
              <Link to="/register" className="btn btn-ghost">Crear cuenta y probar</Link>
            </div>
          </div>

          <div className="pay">
            <span>Medios de pago:</span>
            <span className="chip">PSE</span><span className="chip">Nequi</span><span className="chip">Tarjeta</span>
            <span className="chip">Transferencia</span>
          </div>
          <p className="price-note">Cotizamos correo, SMS, WhatsApp y voz por separado, según el volumen mensual y el tipo de campaña. Escríbenos y te pasamos la tabla de tramos que aplica a tu caso.</p>
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section id="cta">
        <div className="wrap">
          <div className="cta">
            <h2>Hablemos de tu próxima campaña</h2>
            <p>Cuéntanos cuánto envías y por qué canales, y te armamos la cotización con la tabla de tramos que te aplica. Crear la cuenta es gratis y sin tarjeta.</p>
            <div className="cta-actions">
              <Link to="/register" className="btn btn-light">Crear cuenta</Link>
              <a href={whatsappUrl('Hola, quiero solicitar una cotización de MailConnect.')} className="btn btn-outline-light" target="_blank" rel="noopener noreferrer">Solicitar cotización</a>
            </div>
          </div>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="footer">
        <div className="wrap">
          <div className="foot-grid">
            <div>
              <MailConnectLogo height={38} />
              <p className="foot-desc">Plataforma colombiana de correo masivo y comunicaciones omnicanal. Email, SMS, WhatsApp y voz, sobre AWS.</p>
            </div>
            <div>
              <h4>Producto</h4>
              <a href="#canales">Canales</a><a href="#funciones">Funciones</a><a href="#correspondencia">Correspondencia</a><a href="#precios">Precios</a>
            </div>
            {/* Solo enlaces que llevan a algún lado. "Sobre nosotros" y "Blog" estaban
                en href="#": un enlace que no hace nada erosiona la confianza más de lo que
                aporta el nombre en el menú, y Google los cuenta como enlaces rotos. Vuelven
                cuando existan las páginas. */}
            <div>
              <h4>Contacto</h4>
              <a href={whatsappUrl('Hola, quiero información sobre MailConnect.')} target="_blank" rel="noopener noreferrer">WhatsApp comercial</a>
              <a href={`mailto:${CORREO_CONTACTO}`}>{CORREO_CONTACTO}</a>
              <a href={whatsappUrl('Hola, necesito soporte con mi cuenta de MailConnect.')} target="_blank" rel="noopener noreferrer">Soporte</a>
              <a href="#precios">Cotizar</a>
            </div>
            <div>
              <h4>Legal</h4>
              <Link to="/legal/terminos">Términos y condiciones</Link><Link to="/legal/habeas-data">Habeas Data · Ley 1581</Link><Link to="/legal/anti-spam">Política anti-spam</Link><Link to="/legal/privacidad">Privacidad</Link>
            </div>
          </div>
          <div className="foot-bottom">
            <span>© 2026 MailConnect · mailconnect.com.co · Todos los derechos reservados.</span>
            <span>Hecho con ☕ en Colombia</span>
          </div>
        </div>
      </footer>

      {/* Botones flotantes: WhatsApp + Asistente de IA (abajo-derecha). */}
      <LandingFloating whatsappUrl={whatsappUrl()} />
    </div>
  );
};

export default LandingPage;
