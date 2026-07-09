import { Link } from 'react-router-dom';
import { MailConnectLogo } from '../../components/MailConnectLogo';
import './landing.css';

/* === Configuración de contacto por WhatsApp ===
   1) Cambia WHATSAPP_PHONE por el número REAL de MailConnect en formato
      internacional, SIN "+", espacios ni guiones. Ej: 57 + celular -> '573001234567'.
   2) whatsappUrl() arma el enlace con un mensaje pre-cargado (editable). */
const WHATSAPP_PHONE = '573204586576'; // Número real de MailConnect (57 + 320 458 6576)
const WHATSAPP_MSG = 'Hola, quiero solicitar una cotización de MailConnect.';
const whatsappUrl = (msg: string = WHATSAPP_MSG) =>
  `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(msg)}`;

const BARS = [38, 56, 47, 72, 63, 88, 70, 95, 80];

export const LandingPage = () => {
  return (
    <div className="mc-landing">

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
            <Link to="/login" className="btn btn-ghost btn-sm nav-hide">Iniciar sesión</Link>
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
            <div className="price-flag"><b>Desde $8</b><small>por correo · según volumen</small></div>
            <div className="hero-actions">
              <Link to="/register" className="btn btn-primary">Prueba gratis · 500 correos
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
              <a href={whatsappUrl()} className="btn btn-wa" target="_blank" rel="noopener noreferrer">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.6.2-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.7-.9-2.9-1.6-4-3.5-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5s-.6-1.5-.9-2.1c-.2-.5-.4-.4-.6-.4H8c-.2 0-.5.1-.7.3-.7.7-1 1.6-1 2.6.1 1.5.9 2.9 1 3.1.2.2 2.1 3.3 5.2 4.6 3 1.2 3 .8 3.6.8.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.1-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2z" /></svg>
                Cotizar por WhatsApp
              </a>
            </div>
            <div className="hero-trust">
              <span><span className="tick">✓</span> Sin tarjeta de crédito</span>
              <span><span className="tick">✓</span> Créditos válidos 1 año</span>
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
              <span className="tagpill">Desde $8 / correo</span>
            </div>
            <div className="card">
              <span className="ico sms"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></span>
              <h3>SMS</h3>
              <p>Mensajes de texto a móviles con segmentación y gestión de opt-in / opt-out para cumplir la normativa.</p>
              <span className="tagpill">Cobertura nacional</span>
            </div>
            <div className="card">
              <span className="ico wa"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg></span>
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
      <section id="precios" style={{ background: 'var(--bg-alt)' }}>
        <div className="wrap">
          <div className="center">
            <span className="eyebrow">Precios</span>
            <h2>Paga solo por lo que envías</h2>
            <p className="lead">Compra paquetes de correos y úsalos cuando quieras. Entre más volumen, menor precio por correo.</p>
          </div>
          <div className="grid g3" style={{ marginTop: 46 }}>
            <div className="card plan">
              <h3>Inicial</h3>
              <div className="vol">10.000 correos</div>
              <div className="price">$190.000 <small>COP</small></div>
              <div className="per">≈ $19 por correo</div>
              <ul>
                <li><span className="tick">✓</span> Email marketing HTML</li>
                <li><span className="tick">✓</span> Plantillas y segmentación</li>
                <li><span className="tick">✓</span> Estadísticas en tiempo real</li>
                <li><span className="tick">✓</span> Créditos válidos 1 año</li>
              </ul>
              <Link to="/register" className="btn btn-ghost">Comprar paquete</Link>
            </div>
            <div className="card plan featured">
              <h3>Profesional</h3>
              <div className="vol">50.000 correos</div>
              <div className="price">$750.000 <small>COP</small></div>
              <div className="per">≈ $15 por correo</div>
              <ul>
                <li><span className="tick">✓</span> Todo lo de Inicial</li>
                <li><span className="tick">✓</span> Depurador de listas</li>
                <li><span className="tick">✓</span> Combinación de correspondencia</li>
                <li><span className="tick">✓</span> Sub-cuentas y soporte prioritario</li>
              </ul>
              <Link to="/register" className="btn btn-primary">Comprar paquete</Link>
            </div>
            <div className="card plan">
              <h3>Corporativo</h3>
              <div className="vol">100.000 correos</div>
              <div className="price">$1.300.000 <small>COP</small></div>
              <div className="per">≈ $13 por correo</div>
              <ul>
                <li><span className="tick">✓</span> Todo lo de Profesional</li>
                <li><span className="tick">✓</span> SMS, WhatsApp y voz</li>
                <li><span className="tick">✓</span> Dominio y DMARC dedicados</li>
                <li><span className="tick">✓</span> Acompañamiento comercial</li>
              </ul>
              <a href={whatsappUrl('Hola, me interesa el plan Corporativo (100.000 correos) de MailConnect.')} className="btn btn-ghost" target="_blank" rel="noopener noreferrer">Comprar paquete</a>
            </div>
          </div>

          {/* Tabla de volumen */}
          <div className="pricetable">
            <table>
              <thead><tr><th>Volumen de correos</th><th>Precio por correo</th><th>Total (COP)</th></tr></thead>
              <tbody>
                <tr><td>1.000</td><td className="per-cell">$25</td><td>$25.000</td></tr>
                <tr><td>5.000</td><td className="per-cell">$21</td><td>$105.000</td></tr>
                <tr><td>10.000</td><td className="per-cell">$19</td><td>$190.000</td></tr>
                <tr><td>20.000</td><td className="per-cell">$17</td><td>$340.000</td></tr>
                <tr><td>50.000</td><td className="per-cell">$15</td><td>$750.000</td></tr>
                <tr><td>100.000</td><td className="per-cell">$13</td><td>$1.300.000</td></tr>
                <tr><td>500.000</td><td className="per-cell">$10</td><td>$5.000.000</td></tr>
                <tr><td>1.000.000</td><td className="per-cell">$8</td><td>$8.000.000</td></tr>
              </tbody>
            </table>
          </div>
          <div className="pay">
            <span>Medios de pago:</span>
            <span className="chip">PSE</span><span className="chip">Nequi</span><span className="chip">Tarjeta</span>
            <span className="chip">+500.000 · cotización a la medida</span>
          </div>
          <p className="price-note">Precios de referencia en pesos colombianos (COP), tomados de la calculadora interna — ajustables. Email con adjunto personalizado (EAP) desde $12/correo. SMS, WhatsApp y voz se cotizan por separado.</p>
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section id="cta">
        <div className="wrap">
          <div className="cta">
            <h2>Haz tu primer envío hoy</h2>
            <p>Crea tu cuenta, prueba con 500 correos gratis y lanza tu primera campaña en minutos.</p>
            <div className="cta-actions">
              <Link to="/register" className="btn btn-light">Crear cuenta gratis</Link>
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
            <div>
              <h4>Empresa</h4>
              <a href="#">Sobre nosotros</a><a href="#">Contacto</a><a href="#">Blog</a><a href="#">Soporte</a>
            </div>
            <div>
              <h4>Legal</h4>
              <a href="#">Términos y condiciones</a><a href="#">Habeas Data · Ley 1581</a><a href="#">Política anti-spam</a><a href="#">Privacidad</a>
            </div>
          </div>
          <div className="foot-bottom">
            <span>© 2026 MailConnect · mailconnect.com.co · Todos los derechos reservados.</span>
            <span>Hecho con ☕ en Colombia</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
