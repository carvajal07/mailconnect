/**
 * Contenido de las páginas legales (Habeas Data, Términos, Anti-spam, Privacidad).
 *
 * ⚠️ IMPORTANTE (para MailConnect):
 *  - Estos textos son una BASE alineada con la normativa colombiana (Ley 1581 de 2012,
 *    Decreto 1074 de 2015, Ley 527 de 1999). Deben ser REVISADOS por un abogado antes
 *    de publicarse en producción.
 *  - Completa los datos de la empresa en la constante COMPANY de abajo (razón social,
 *    NIT, domicilio, teléfono). Los marcados con [CORCHETES] son obligatorios de llenar.
 *  - Cambiar aquí actualiza las 4 páginas.
 */

export const COMPANY = {
  brand: 'MailConnect',
  legalName: '[RAZÓN SOCIAL DE LA EMPRESA]', // p. ej. "MailConnect S.A.S."
  nit: '[NIT]',
  address: '[DIRECCIÓN / DOMICILIO]',
  city: '[CIUDAD]',
  country: 'Colombia',
  email: 'comunicaciones@mailconnect.com.co',
  dataEmail: 'protecciondedatos@mailconnect.com.co',
  phone: '[TELÉFONO]',
  whatsapp: '+57 320 458 6576',
  web: 'mailconnect.com.co',
  updated: '10 de julio de 2026',
};

export interface LegalSection {
  heading?: string;
  /** Párrafos de la sección. */
  body?: string[];
  /** Ítems de lista (viñetas). */
  list?: string[];
}

export interface LegalDoc {
  slug: string;
  title: string;
  intro: string;
  sections: LegalSection[];
}

const C = COMPANY;

export const LEGAL_DOCS: LegalDoc[] = [
  /* ============================ HABEAS DATA ============================ */
  {
    slug: 'habeas-data',
    title: 'Política de Tratamiento de Datos Personales (Habeas Data)',
    intro:
      `En cumplimiento de la Ley Estatutaria 1581 de 2012, el Decreto 1074 de 2015 y demás ` +
      `normas concordantes, ${C.legalName} (en adelante "${C.brand}") adopta la presente Política ` +
      `de Tratamiento de la Información, aplicable a los datos personales registrados en sus ` +
      `bases de datos, garantizando el derecho de Habeas Data de los titulares.`,
    sections: [
      {
        heading: '1. Responsable del tratamiento',
        list: [
          `Razón social: ${C.legalName}`,
          `NIT: ${C.nit}`,
          `Domicilio: ${C.address}, ${C.city}, ${C.country}`,
          `Correo de contacto para protección de datos: ${C.dataEmail}`,
          `Teléfono: ${C.phone} · WhatsApp: ${C.whatsapp}`,
          `Sitio web: ${C.web}`,
        ],
      },
      {
        heading: '2. Definiciones',
        list: [
          'Dato personal: cualquier información vinculada o que pueda asociarse a una persona natural determinada o determinable.',
          'Dato sensible: aquel que afecta la intimidad del titular o cuyo uso indebido puede generar discriminación (salud, origen racial, orientación política, sexual, religiosa, datos biométricos, etc.).',
          'Titular: persona natural cuyos datos personales son objeto de tratamiento.',
          'Tratamiento: cualquier operación sobre datos personales (recolección, almacenamiento, uso, circulación, supresión).',
          'Responsable del tratamiento: quien decide sobre la base de datos y/o el tratamiento (MailConnect y/o el cliente que carga sus bases).',
          'Encargado del tratamiento: quien realiza el tratamiento por cuenta del responsable.',
          'Autorización: consentimiento previo, expreso e informado del titular para el tratamiento.',
        ],
      },
      {
        heading: '3. Finalidades del tratamiento',
        body: [
          'Los datos personales recolectados por MailConnect se tratan para las siguientes finalidades:',
        ],
        list: [
          'Prestar los servicios de comunicación masiva (correo electrónico, SMS, WhatsApp y voz) contratados por el cliente.',
          'Gestionar el registro, la autenticación y la administración de las cuentas de usuario.',
          'Enviar información transaccional, técnica, comercial y de soporte relacionada con el servicio.',
          'Procesar las bases de datos de destinatarios que el cliente carga, únicamente para ejecutar los envíos que el cliente ordena.',
          'Atender consultas, peticiones, quejas y reclamos; y cumplir obligaciones legales, contables y contractuales.',
          'Generar reportes, estadísticas y facturación del servicio.',
        ],
      },
      {
        heading: '4. Tratamiento de las bases de datos cargadas por el cliente',
        body: [
          `Cuando un cliente carga en la plataforma bases de datos de sus propios destinatarios, el ` +
            `cliente actúa como Responsable del tratamiento de esos datos y ${C.brand} actúa como ` +
            `Encargado, tratándolos exclusivamente para ejecutar los envíos ordenados por el cliente. ` +
            `El cliente declara y garantiza que cuenta con la autorización previa, expresa e informada ` +
            `de cada titular para el envío de las comunicaciones, conforme a la ley.`,
        ],
      },
      {
        heading: '5. Derechos del titular (Art. 8, Ley 1581 de 2012)',
        list: [
          'Conocer, actualizar y rectificar sus datos personales.',
          'Solicitar prueba de la autorización otorgada.',
          'Ser informado sobre el uso que se ha dado a sus datos personales.',
          'Presentar quejas ante la Superintendencia de Industria y Comercio (SIC) por infracciones a la ley.',
          'Revocar la autorización y/o solicitar la supresión del dato cuando no exista un deber legal o contractual de conservarlo.',
          'Acceder de forma gratuita a sus datos personales que hayan sido objeto de tratamiento.',
        ],
      },
      {
        heading: '6. Deberes de MailConnect como responsable',
        list: [
          'Garantizar al titular el pleno y efectivo ejercicio del Habeas Data.',
          'Conservar la información bajo condiciones de seguridad para evitar su adulteración, pérdida, consulta o acceso no autorizado.',
          'Actualizar, rectificar o suprimir la información cuando corresponda y tramitar consultas y reclamos en los términos legales.',
          'Informar a la SIC cuando se presenten violaciones a los códigos de seguridad y existan riesgos en la administración de los datos.',
        ],
      },
      {
        heading: '7. Procedimiento para consultas y reclamos',
        body: [
          `El titular o sus causahabientes podrán ejercer sus derechos enviando una solicitud al correo ` +
            `${C.dataEmail}, indicando su nombre completo, documento de identidad, el derecho que desea ` +
            `ejercer y los datos de contacto.`,
          'Consultas: se atenderán en un término máximo de diez (10) días hábiles contados a partir de la fecha de recibo. Cuando no fuere posible, se informará al interesado antes del vencimiento, expresando los motivos y la fecha de respuesta, que no superará cinco (5) días hábiles siguientes.',
          'Reclamos: se atenderán en un término máximo de quince (15) días hábiles contados a partir del día siguiente a su recibo. Cuando no fuere posible, se informará al interesado los motivos de la demora y la fecha en que se atenderá, que no superará ocho (8) días hábiles siguientes al vencimiento del primer término.',
        ],
      },
      {
        heading: '8. Transferencia y transmisión de datos',
        body: [
          `Para prestar el servicio, ${C.brand} se apoya en proveedores tecnológicos (por ejemplo, ` +
            `servicios de infraestructura en la nube de Amazon Web Services), que pueden alojar o procesar ` +
            `información en servidores ubicados fuera de Colombia. En estos casos se adoptan las medidas ` +
            `contractuales y de seguridad necesarias para garantizar niveles adecuados de protección, ` +
            `conforme a la normativa vigente.`,
        ],
      },
      {
        heading: '9. Datos de menores y datos sensibles',
        body: [
          'MailConnect no solicita ni trata deliberadamente datos sensibles ni datos de menores de edad para sus propias finalidades comerciales. Cuando el tratamiento involucre este tipo de datos, se realizará atendiendo el interés superior del menor y respetando sus derechos fundamentales, y sujeto a la autorización del representante legal cuando aplique.',
        ],
      },
      {
        heading: '10. Seguridad de la información',
        body: [
          'MailConnect implementa medidas técnicas, humanas y administrativas razonables para proteger los datos personales: cifrado en tránsito, control de acceso, autenticación, registro de actividad y respaldo. Ningún sistema es completamente infalible; ante un incidente de seguridad se actuará conforme a la ley y se notificará a las autoridades y titulares cuando corresponda.',
        ],
      },
      {
        heading: '11. Vigencia',
        body: [
          `La presente política rige a partir del ${C.updated} y se mantendrá vigente mientras ${C.brand} ` +
            `desarrolle su objeto social. Las bases de datos se conservarán durante el tiempo necesario ` +
            `para cumplir las finalidades y las obligaciones legales aplicables. Cualquier cambio sustancial ` +
            `será comunicado a través del sitio web ${C.web}.`,
        ],
      },
    ],
  },

  /* ============================ TÉRMINOS Y CONDICIONES ============================ */
  {
    slug: 'terminos',
    title: 'Términos y Condiciones de Uso',
    intro:
      `Estos Términos y Condiciones regulan el acceso y uso de la plataforma ${C.brand} ` +
      `(${C.web}). Al registrarse o utilizar el servicio, el usuario declara haber leído, ` +
      `entendido y aceptado estos términos en su totalidad.`,
    sections: [
      {
        heading: '1. Objeto del servicio',
        body: [
          `${C.brand} es una plataforma de comunicación masiva omnicanal que permite a sus clientes ` +
            `diseñar, gestionar y ejecutar campañas de correo electrónico, SMS, WhatsApp y voz, así como ` +
            `administrar bases de datos de destinatarios, plantillas y reportes.`,
        ],
      },
      {
        heading: '2. Registro y cuenta',
        list: [
          'El usuario debe suministrar información veraz, completa y actualizada al registrarse.',
          'El usuario es responsable de la confidencialidad de sus credenciales y de toda actividad realizada desde su cuenta.',
          'La cuenta es personal e intransferible. El uso indebido puede dar lugar a la suspensión o terminación.',
        ],
      },
      {
        heading: '3. Obligaciones del usuario',
        list: [
          'Utilizar el servicio conforme a la ley, la moral, el orden público y estos términos.',
          'Garantizar que cuenta con la autorización (opt-in) de cada destinatario de sus comunicaciones.',
          'No enviar contenido ilícito, engañoso, difamatorio, discriminatorio o que infrinja derechos de terceros.',
          'Cumplir la Política Anti-Spam y la Política de Tratamiento de Datos Personales.',
          'Responder por el contenido y las bases de datos que carga en la plataforma.',
        ],
      },
      {
        heading: '4. Uso aceptable y prohibiciones',
        body: ['Está expresamente prohibido:'],
        list: [
          'Enviar comunicaciones no solicitadas (spam) o a listas compradas, alquiladas o de origen ilícito.',
          'Suplantar la identidad de personas o entidades, o falsear la información del remitente o del asunto.',
          'Distribuir malware, phishing, esquemas fraudulentos o contenido que vulnere la seguridad.',
          'Realizar ingeniería inversa, vulnerar o sobrecargar la infraestructura del servicio.',
          'Revender el servicio sin autorización escrita de MailConnect.',
        ],
      },
      {
        heading: '5. Planes, precios y pagos',
        body: [
          'El uso del servicio puede estar sujeto a planes y tarifas informadas al cliente. Los valores, impuestos aplicables (como el IVA) y condiciones de facturación se comunicarán previamente. El incumplimiento en los pagos podrá suspender el servicio.',
        ],
      },
      {
        heading: '6. Propiedad intelectual',
        body: [
          `La marca, el software, el diseño y los contenidos propios de ${C.brand} están protegidos por la ` +
            `normativa de propiedad intelectual. El usuario conserva la titularidad sobre el contenido y las ` +
            `bases de datos que él aporta, y otorga a ${C.brand} una licencia limitada para procesarlos con el ` +
            `único fin de prestar el servicio.`,
        ],
      },
      {
        heading: '7. Disponibilidad y limitación de responsabilidad',
        body: [
          `${C.brand} realiza esfuerzos razonables para mantener el servicio disponible, pero no garantiza ` +
            `una operación ininterrumpida ni libre de errores, ni la entrega efectiva de cada mensaje, que ` +
            `depende de terceros (proveedores de correo, operadores móviles, Meta/WhatsApp, etc.). En la ` +
            `medida permitida por la ley, ${C.brand} no será responsable por daños indirectos, lucro cesante ` +
            `o pérdidas derivadas del uso o la imposibilidad de uso del servicio, ni por el contenido enviado ` +
            `por el cliente.`,
        ],
      },
      {
        heading: '8. Suspensión y terminación',
        body: [
          'MailConnect podrá suspender o terminar el acceso ante el incumplimiento de estos términos, el uso indebido del servicio, actividades de spam o requerimiento de autoridad competente, sin perjuicio de las acciones legales que correspondan.',
        ],
      },
      {
        heading: '9. Modificaciones',
        body: [
          `${C.brand} podrá actualizar estos términos. Los cambios se publicarán en ${C.web} y regirán desde ` +
            `su publicación. El uso continuado del servicio implica la aceptación de la versión vigente.`,
        ],
      },
      {
        heading: '10. Ley aplicable y jurisdicción',
        body: [
          'Estos términos se rigen por las leyes de la República de Colombia. Cualquier controversia se someterá a los jueces y tribunales competentes del domicilio de MailConnect.',
        ],
      },
    ],
  },

  /* ============================ POLÍTICA ANTI-SPAM ============================ */
  {
    slug: 'anti-spam',
    title: 'Política Anti-Spam',
    intro:
      `${C.brand} promueve las comunicaciones responsables y con consentimiento. Esta Política ` +
      `Anti-Spam es de obligatorio cumplimiento para todos los clientes que utilizan la plataforma.`,
    sections: [
      {
        heading: '1. Qué consideramos spam',
        body: [
          'Se considera spam el envío de comunicaciones comerciales o publicitarias no solicitadas, de forma masiva, a destinatarios que no han otorgado su consentimiento previo, expreso e informado (opt-in).',
        ],
      },
      {
        heading: '2. Consentimiento (opt-in) obligatorio',
        list: [
          'El cliente debe contar con autorización demostrable de cada destinatario antes de enviarle comunicaciones.',
          'Está prohibido usar bases de datos compradas, alquiladas, extraídas de la web (scraping) o de origen ilícito.',
          'El cliente debe poder acreditar el origen y la fecha del consentimiento cuando MailConnect o una autoridad lo requiera.',
        ],
      },
      {
        heading: '3. Contenido de los envíos',
        list: [
          'El remitente debe estar identificado de forma clara y veraz.',
          'El asunto no debe ser engañoso ni inducir a error.',
          'El mensaje debe corresponder a la finalidad autorizada por el destinatario.',
        ],
      },
      {
        heading: '4. Desuscripción',
        body: [
          `Todas las comunicaciones de correo incluyen un mecanismo de desuscripción visible y funcional. ` +
            `MailConnect agrega automáticamente el enlace de baja y, cuando aplica, las cabeceras ` +
            `List-Unsubscribe (RFC 8058). Las solicitudes de baja se procesan y respetan: los destinatarios ` +
            `dados de baja se excluyen de los envíos reales.`,
        ],
      },
      {
        heading: '5. Monitoreo, sanciones y reportes de abuso',
        list: [
          'MailConnect puede monitorear métricas de reputación (quejas, rebotes, tasas de baja) para proteger la entregabilidad de todos sus clientes.',
          'El incumplimiento de esta política puede derivar en la suspensión inmediata de los envíos y/o la terminación de la cuenta.',
          `Los reportes de abuso pueden enviarse a ${C.email}.`,
        ],
      },
      {
        heading: '6. Marco normativo',
        body: [
          'Esta política se enmarca en la Ley 1581 de 2012 (protección de datos), la Ley 527 de 1999 (comercio electrónico) y las buenas prácticas internacionales de envío (incluido el estándar RFC 8058 para desuscripción con un clic).',
        ],
      },
    ],
  },

  /* ============================ PRIVACIDAD ============================ */
  {
    slug: 'privacidad',
    title: 'Política de Privacidad',
    intro:
      `Esta Política de Privacidad describe cómo ${C.brand} recolecta, usa y protege la información ` +
      `de quienes visitan ${C.web} y utilizan la plataforma. Complementa la Política de Tratamiento ` +
      `de Datos Personales (Habeas Data).`,
    sections: [
      {
        heading: '1. Información que recolectamos',
        list: [
          'Datos de registro y cuenta: nombre, correo, teléfono, empresa y NIT.',
          'Datos de uso: campañas, plantillas, bases de datos cargadas, reportes y actividad en la plataforma.',
          'Datos técnicos: dirección IP, tipo de dispositivo y navegador, y datos de sesión.',
        ],
      },
      {
        heading: '2. Finalidades',
        body: [
          'Usamos la información para prestar y mejorar el servicio, autenticar usuarios, brindar soporte, generar facturación y reportes, y cumplir obligaciones legales. No vendemos datos personales.',
        ],
      },
      {
        heading: '3. Cookies y tecnologías similares',
        body: [
          'La plataforma utiliza almacenamiento local y/o cookies estrictamente necesarias para mantener la sesión y las preferencias del usuario (por ejemplo, el token de sesión y el tema claro/oscuro). El usuario puede borrarlas desde su navegador, entendiendo que ello puede afectar el funcionamiento del servicio.',
        ],
      },
      {
        heading: '4. Con quién compartimos la información',
        body: [
          `Compartimos información con proveedores tecnológicos que nos ayudan a operar (por ejemplo, ` +
            `infraestructura y servicios de envío de Amazon Web Services), bajo acuerdos de confidencialidad ` +
            `y tratamiento. También podemos divulgar información cuando lo exija una autoridad competente o ` +
            `la ley. Nunca vendemos ni alquilamos datos personales a terceros con fines comerciales.`,
        ],
      },
      {
        heading: '5. Transferencias internacionales',
        body: [
          'Parte de la información puede procesarse o almacenarse en servidores ubicados fuera de Colombia (por ejemplo, en regiones de AWS). En estos casos adoptamos medidas contractuales y de seguridad para garantizar una protección adecuada.',
        ],
      },
      {
        heading: '6. Conservación y seguridad',
        body: [
          'Conservamos los datos durante el tiempo necesario para cumplir las finalidades y las obligaciones legales. Aplicamos medidas de seguridad razonables (cifrado en tránsito, control de acceso y monitoreo) para proteger la información.',
        ],
      },
      {
        heading: '7. Sus derechos',
        body: [
          `Usted puede conocer, actualizar, rectificar y suprimir sus datos, y revocar la autorización, ` +
            `conforme a la Ley 1581 de 2012. Para ejercerlos, escríbanos a ${C.dataEmail}. Consulte también ` +
            `nuestra Política de Tratamiento de Datos Personales (Habeas Data).`,
        ],
      },
      {
        heading: '8. Cambios a esta política',
        body: [
          `Podemos actualizar esta política; la versión vigente estará disponible en ${C.web}. Le ` +
            `recomendamos revisarla periódicamente.`,
        ],
      },
      {
        heading: '9. Contacto',
        list: [
          `Correo general: ${C.email}`,
          `Protección de datos: ${C.dataEmail}`,
          `WhatsApp: ${C.whatsapp}`,
        ],
      },
    ],
  },
];

export const getLegalDoc = (slug?: string): LegalDoc | undefined =>
  LEGAL_DOCS.find((d) => d.slug === slug);
