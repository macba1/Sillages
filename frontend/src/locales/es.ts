import type { Translations } from './en';

export const translations: Translations = {
  // ── Navigation ──────────────────────────────────────────────────────────────
  'nav.dashboard':   'Inicio',
  'nav.briefs':      'Informes',
  'nav.alerts':      'Alertas',
  'nav.settings':    'Ajustes',
  'nav.signOut':     'Cerrar sesión',

  // ── Dashboard ───────────────────────────────────────────────────────────────
  'dash.statusPill':           'Sillages está activo',
  'dash.greeting.morning':     'Buenos días',
  'dash.greeting.afternoon':   'Buenas tardes',
  'dash.greeting.evening':     'Buenas noches',

  'dash.generating.title':     'Generando tu primer informe\u2026',
  'dash.generating.body':      'Recogiendo los datos de tu tienda. Esto suele tardar menos de un minuto.',

  'dash.empty.title':          'Tu primer informe llegará mañana por la mañana, cuando los datos de tu tienda estén listos.',
  'dash.empty.settingsWord':   'Ajustes',

  'dash.cta':                  'Leer el informe de esta mañana \u2192',
  'dash.readTime':             '5 min de lectura',

  'dash.section.working':      'En qué estoy trabajando',
  'dash.section.previous':     'Informes anteriores',
  'dash.readArrow':            'Leer \u2192',
  'dash.orders':               'pedidos',

  // Working item timing labels
  'when.tonight':   'Esta noche',
  'when.tomorrow':  'Mañana',
  'when.thisWeek':  'Esta semana',

  // Working item body strings
  'work.watching':         'Vigilando si {product} sigue vendiéndose',
  'work.watchingDefault':  'Revisando los pedidos de hoy y comparando con ayer',
  'work.checking':         'Investigando {issue} \u2014 {metric}',
  'work.checkingDefault':  'Viendo si se recuperaron los carritos abandonados de hoy',
  'work.briefReady':       'El informe estará listo a las 6am',
  'work.gapDefault':       'Siguiendo si más visitantes completan su compra',

  // ── Briefs list ──────────────────────────────────────────────────────────────
  'briefs.title':     'Tus informes.',
  'briefs.empty':     'Todavía no hay informes. El primero llegará mañana por la mañana.',
  'briefs.readArrow': 'Leer \u2192',

  // ── Brief detail ─────────────────────────────────────────────────────────────
  'brief.back':               'Volver',
  'brief.section.worked':     'Qué funcionó ayer',
  'brief.section.notWorked':  'Qué no funcionó',
  'brief.section.watching':   'Lo que estoy vigilando',
  'brief.section.gap':        'La oportunidad perdida',
  'brief.section.activation': 'Una cosa que hacer hoy',
  'brief.upside':             'Potencial:',
  'brief.expected':           'Resultado esperado:',
  'brief.footer':             'Esta noche recogeré los datos de hoy. El informe de mañana estará listo a las 6am.',
  'brief.deepenChat':         'Profundizar con Sillages \u2192',

  // ── Alerts ───────────────────────────────────────────────────────────────────
  'alerts.title':    'Alertas.',
  'alerts.subtitle': 'Cosas que noté y que creo que deberías saber.',
  'alerts.empty':    'Nada que señalar por ahora.',
  'alerts.gotIt':    'Entendido',
  'alerts.exampleNote': 'Estos son ejemplos. Las alertas reales aparecerán aquí cuando note algo que valga la pena contarte.',
  'alerts.example1.title': 'Algo falla con nuestros visitantes',
  'alerts.example1.message': 'Mucha gente vino a nuestra tienda pero muy pocos compraron. Lo rastreé hasta la página de producto — algo allí está creando dudas. Te diré exactamente qué arreglar.',
  'alerts.example2.title': 'Nuestro mejor producto merece más visibilidad',
  'alerts.example2.message': "El mismo producto ha sido nuestro más vendido durante 3 días seguidos, pero no es lo primero que la gente ve al entrar a nuestra tienda. Subirlo a la parte superior de la página lleva 5 minutos y probablemente nos haga vender más hoy.",

  // ── Settings ─────────────────────────────────────────────────────────────────
  'settings.title':                  'Ajustes',
  'settings.section.shopify':        'Conexión con Shopify',
  'settings.section.preferences':    'Preferencias del informe',
  'settings.section.plan':           'Plan',
  'settings.section.account':        'Cuenta',
  'settings.section.testing':        'Pruebas',

  'settings.lang.label':             'Idioma',
  'settings.lang.desc':              'Idioma de tus informes y la aplicación.',

  'settings.shopify.connected':      'Conectada',
  'settings.shopify.disconnect':     'Desconectar',
  'settings.shopify.briefsNightly':  'Los informes se generan cada noche',
  'settings.shopify.briefsDesc':     'Recojo los datos de tu tienda cada noche y tengo tu informe listo a las 6am.',
  'settings.shopify.noStore':        'Sin tienda conectada',
  'settings.shopify.noStoreDesc':    'Conecta tu tienda Shopify para empezar a recibir informes diarios.',
  'settings.shopify.connect':        'Conectar tienda',

  'settings.delivery.label':         'Hora de entrega',
  'settings.delivery.desc':          'Cuándo recibes tu informe matutino.',

  'settings.plan.free':              'Plan actual',
  'settings.plan.freeDesc':          'Gestiona tu plan desde Shopify \u2192 Ajustes \u2192 Apps.',

  'settings.account.emailDesc':      'El correo de tu cuenta.',
  'settings.account.signOut':        'Cerrar sesión',

  'settings.badge.beta':             'Activo',
  'settings.badge.comingSoon':       'Próximamente',

  'settings.testing.generateLabel':  'Generar informe ahora',
  'settings.testing.generateDesc':   'Sincronizar los datos de ayer y generar un informe de inmediato.',
  'settings.testing.generateBtn':    'Generar informe',
  'settings.testing.generating':     'Generando\u2026',
  'settings.testing.seedLabel':      'Cargar datos de prueba y generar',
  'settings.testing.seedDesc':       'Insertar datos realistas y generar un informe sin Shopify.',
  'settings.testing.seedBtn':        'Cargar y generar',
  'settings.testing.loading':        'Cargando\u2026',

  // ── Landing page ─────────────────────────────────────────────────────────────
  'landing.nav.signIn':       'Iniciar sesión',
  'landing.nav.install':      'Instalar en Shopify',
  'landing.badge':            'El brief diario para tiendas Shopify',
  'landing.hero.title1':      'El director de operaciones',
  'landing.hero.title2':      'que tu tienda no puede pagar.',
  'landing.hero.body':        'Cada mañana, un brief que te cuenta qué pasó ayer en tu tienda y qué hacer hoy — en un lenguaje que entiendes, basado en la memoria de TU negocio.',
  'landing.cta.install':      'Instalar en Shopify \u2014 Gratis',
  'landing.cta.howItWorks':   'Ver un brief real \u2192',
  'landing.hero.trust':       'Potenciado por IA \u00b7 De confianza para merchants de Shopify \u00b7 Facturado por Shopify',

  'landing.why.h2':           '¿Por qué no preguntarle a ChatGPT?',
  'landing.why.p1':           'Puedes. Pero ChatGPT no sabe que los miércoles son tu mejor día. No sabe que María lleva 4 compras y debería ser VIP. No sabe que tu brioche normalmente se agota en 2 días y lleva 4 sin venderse.',
  'landing.why.p2':           'Sillages vive dentro de tu tienda. Cada día que pasa, conoce mejor tu negocio. Esa memoria no se puede copiar, exportar ni preguntar a una IA genérica.',
  'landing.why.p3':           'Tú no preguntas. Sillages te cuenta.',

  'landing.features.label':   'Qué obtienes',
  'landing.features.title':   'El brief, y las acciones que recomienda.',
  'landing.feature1.title':   'El Brief Diario',
  'landing.feature1.desc':    'Cada mañana a las 7:00, qué pasó y qué hacer. Sin dashboards, sin buscar nada.',
  'landing.feature2.title':   'Memoria de tu negocio',
  'landing.feature2.desc':    'Aprende los patrones de TU tienda: tus mejores días, tus clientes que repiten, tus productos que frenan.',
  'landing.feature3.title':   'Acciones a un clic',
  'landing.feature3.desc':    'El brief no solo informa. Propone la acción con el texto ya escrito. Tú apruebas, Sillages ejecuta: recuperación de carritos, bienvenidas, reactivaciones.',

  'landing.pricing.label':    'Precios',
  'landing.pricing.title':    'Precios simples y transparentes.',
  'landing.pricing.subtitle': 'Empieza gratis, mejora tu plan cuando quieras. Todos los planes de pago incluyen 14 días gratis.',
  'landing.pricing.free':     'Gratis siempre',
  'landing.pricing.note':     'Toda la facturación gestionada de forma segura por Shopify. Cancela cuando quieras desinstalando.',

  'landing.pricing.starter.f1':  'El brief básico, cada mañana',
  'landing.pricing.starter.f2':  'Dashboard de tienda',
  'landing.pricing.starter.f3':  'Analítica básica',
  'landing.pricing.starter.cta': 'Instalar Gratis',

  'landing.pricing.basico.f1':  'El brief completo con memoria + voz de tu marca',
  'landing.pricing.basico.f2':  'Todo lo de Starter',
  'landing.pricing.basico.f3':  'Tendencias y recomendaciones',
  'landing.pricing.basico.f4':  'Personalización de voz de marca',
  'landing.pricing.basico.cta': 'Empezar 14 días gratis',

  'landing.pricing.crecimiento.f1':  'Brief + acciones automáticas (carritos)',
  'landing.pricing.crecimiento.f2':  'Todo lo de Básico',
  'landing.pricing.crecimiento.f3':  'Notificaciones push',
  'landing.pricing.crecimiento.cta': 'Empezar 14 días gratis',

  'landing.pricing.pro.f1':  'Brief + todas las acciones (bienvenida, reactivación)',
  'landing.pricing.pro.f2':  'Todo lo de Crecimiento',
  'landing.pricing.pro.f3':  'Soporte prioritario',
  'landing.pricing.pro.cta': 'Empezar 14 días gratis',

  'landing.bottom.title':    'Instala hoy.',
  'landing.bottom.desc':     'Mañana a las 7:00 recibes tu primer brief.',
  'landing.bottom.cta':      'Instalar en Shopify',

  'landing.footer.copyright': '\u00a9 2026 Sillages. Todos los derechos reservados.',
  'landing.footer.privacy':   'Política de Privacidad',
  'landing.footer.terms':     'Términos de Servicio',

  // ── Actions ─────────────────────────────────────────────────────────────────
  'nav.actions':          'Acciones',
  'actions.title':        'Acciones.',
  'actions.subtitle':     'Acciones de crecimiento que preparé para ti. Revisa, edita o aprueba.',
  'actions.empty.title':  'Sin acciones por ahora',
  'actions.empty.body':   'Sugeriré acciones de crecimiento en tu próximo informe matutino.',
  'actions.history':      'Historial',

  // ── Reconnect ───────────────────────────────────────────────────────────────
  'reconnect.redirecting':  'Reconectando tu tienda\u2026',
  'reconnect.goSettings':   'Ir a Ajustes \u2192',
  'reconnect.loginTitle':   'Reconectar tu tienda',
  'reconnect.loginDesc':    'Inicia sesi\u00f3n para reconectar tu tienda Shopify. Solo toma un momento.',
  'reconnect.password':     'Contrase\u00f1a',
  'reconnect.loginBtn':     'Entrar y reconectar',
  'reconnect.noSession':    'No se encontr\u00f3 sesi\u00f3n. Int\u00e9ntalo de nuevo.',
  'reconnect.success':      'Tienda reconectada. Sincronizando datos frescos \u2014 tu pr\u00f3ximo informe estar\u00e1 listo en breve.',

  // ── Push / PWA ──────────────────────────────────────────────────────────────
  'push.modal.title':        'Recibe tu brief como notificación',
  'push.modal.body':         'Sin abrir email. Tu brief diario aparece directamente en tu móvil cada mañana.',
  'push.modal.activate':     'Activar notificaciones',
  'push.modal.later':        'Ahora no',
  'pwa.banner.title':        'Instala Sillages en tu móvil',
  'pwa.banner.ios':          'Toca Compartir (\u2b06) \u2192 Añadir a pantalla de inicio',
  'pwa.banner.native':       'Acceso directo desde tu pantalla de inicio',
  'pwa.banner.install':      'Instalar',
  'push.label':              'Notificaciones push',
  'push.desc.active':        'Tu brief diario llega como notificación push',
  'push.desc.denied':        'Bloqueadas en el navegador \u2014 actívalas en la configuración del navegador',
  'push.desc.prompt':        'Recibe tu brief diario como notificación push',
  'push.btn.deactivate':     'Desactivar',
  'push.btn.activate':       'Activar',
  'push.badge.blocked':      'Bloqueadas',

  // Brief card (mock demo in hero)
  'landing.card.date':         'MARTES, 9 DE JUNIO \u00b7 2026',
  'landing.card.active':       'Activo',
  'landing.card.greeting':     'Buenos días, Tony.',
  'landing.card.body':         'Ayer: €482 en 12 pedidos. Buen martes \u2014 23% sobre tu media de martes.',
  'landing.card.sectionLabel': 'LO QUE VEO HOY',
  'landing.card.action':       '⚠️ El Pack Degustación lleva 5 días sin venderse. Normalmente sale cada 2 días — revisa si está visible en la home.\n\n⭐ Laura G. hizo su 4ª compra. Es momento de tratarla como VIP — tengo un email de agradecimiento listo, apruébalo con un clic.',
  'landing.card.footer':       'Mañana a las 7:00 te cuento cómo fue hoy.',

  // ── Onboarding ───────────────────────────────────────────────────────────────
  'onboarding.welcome.hi':     'Hola {firstName},',
  'onboarding.welcome.sub':    'Soy Sillages \u2014 tu agente personal de tienda.',
  'onboarding.welcome.body':   'Sé exactamente cómo te sientes. Tenemos una tienda, vemos los números, pero no entendemos bien por qué algunos días van bien y otros no. Demasiados datos, demasiadas pantallas, demasiadas cosas que supuestamente hay que hacer. Yo me encargo de eso.',
  'onboarding.step1':          'Cada mañana te diré qué pasó en nuestra tienda',
  'onboarding.step2':          'Trabajo cada noche mientras duermes \u2014 sin configuración',
  'onboarding.step3':          'Solo necesito acceso de solo lectura a nuestra tienda Shopify para empezar',
  'onboarding.cta':            'Vamos a trabajar \u2192',
  'onboarding.beta':           'Plan gratuito disponible \u00b7 Sin tarjeta de crédito \u00b7 Cancela cuando quieras',
  'onboarding.connect.back':   '\u2190 Volver',
  'onboarding.connect.title':  'Conectar nuestra tienda',
  'onboarding.connect.desc':   'Serás redirigido a Shopify para aprobar el acceso de solo lectura. Nunca modifico tus datos.',
  'onboarding.connect.btn':            'Conectar tienda',
  'onboarding.connect.loading':        'Conectando\u2026',
  'onboarding.connect.placeholder':    'mitienda (no mitienda.com)',
  'onboarding.connect.helper':         'Solo el nombre de la tienda \u2014 añadiremos .myshopify.com automáticamente si hace falta',
  'onboarding.connect.whereToggle':    '¿Dónde lo encuentro?',
  'onboarding.connect.whereBody':      'Tu tienda Shopify tiene una URL privada que es distinta de tu dirección web pública. Siempre termina en .myshopify.com y tiene este aspecto: mitienda.myshopify.com',
  'onboarding.connect.whereStep1':     'Inicia sesión en tu panel de Shopify (admin.shopify.com)',
  'onboarding.connect.whereStep2':     'Haz clic en el nombre de tu tienda en la esquina superior izquierda',
  'onboarding.connect.whereStep3':     'Verás la URL de tu tienda \u2014 termina en .myshopify.com',
  'onboarding.connect.whereStep4':     'Copia solo la parte antes de .myshopify.com y pégala aquí',
};
