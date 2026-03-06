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

  'settings.plan.free':              'Gratis durante la beta',
  'settings.plan.freeDesc':          'Acceso completo, sin tarjeta de crédito. Los precios empiezan en $9/mes en el lanzamiento.',

  'settings.account.emailDesc':      'El correo de tu cuenta.',
  'settings.account.signOut':        'Cerrar sesión',

  'settings.badge.beta':             'Beta',
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
  'landing.nav.getStarted':   'Comenzar',
  'landing.badge':            'Inteligencia para operadores de Shopify',
  'landing.hero.title1':      'Tu tienda trabajó ayer.',
  'landing.hero.title2':      '\u00bfSabes qué te dijo?',
  'landing.hero.body':        'Sillages analiza tu tienda Shopify cada noche y te entrega un informe matutino claro \u2014 qué se movió, qué se estancó y exactamente qué hacer hoy.',
  'landing.cta.trial':        'Empezar gratis',
  'landing.cta.howItWorks':   'Ver cómo funciona \u2192',
  'landing.what.label':       'Qué obtienes',
  'landing.prop1.label':      'Informe de Inteligencia Diario',
  'landing.prop1.desc':       'Seis secciones enfocadas cada mañana: rendimiento, impulso, fricción, señal, oportunidad y la activación del día. Claridad, no dashboards.',
  'landing.prop2.label':      'Señales con Acción',
  'landing.prop2.desc':       'No es un reporte. Es una decisión. Cada informe termina con una acción específica \u2014 qué hacer, por qué importa, cómo ejecutarlo en menos de 30 minutos.',
  'landing.prop3.label':      'Diseñado para Operadores',
  'landing.prop3.desc':       'Para fundadores y gestores de tiendas que necesitan moverse rápido y bien. Sin gráficos que interpretar. Sin filtros que configurar. Solo claridad.',
  'landing.beta.badge':       'Beta',
  'landing.beta.title':       'Sillages es gratis durante la beta.',
  'landing.beta.desc':        'Los precios empiezan en $9/mes cuando lancemos. Sin tarjeta de crédito.',
  'landing.beta.cta':         'Obtener acceso gratuito',
  'landing.footer.copyright': '\u00a9 2026 Sillages. Todos los derechos reservados.',
  'landing.footer.privacy':   'Política de Privacidad',
  'landing.footer.terms':     'Términos de Servicio',

  // Brief card (mock demo in hero)
  'landing.card.date':         'VIERNES, 6 DE MARZO \u00b7 2026',
  'landing.card.active':       'Activo',
  'landing.card.greeting':     'Buenos días, Tony.',
  'landing.card.body':         'Registré $4.820 en 38 pedidos ayer \u2014 tu Sérum de Vitamina C fue el protagonista, pero solo 3 de cada 100 visitantes compraron algo, y creo que sé exactamente por qué.',
  'landing.card.sectionLabel': 'UNA COSA QUE HACER HOY',
  'landing.card.action':       'Envía un email de seguimiento a todos los que vieron la página del Sérum ayer pero no compraron. Te diré exactamente qué escribir.',
  'landing.card.footer':       'Esta noche recogeré los datos de hoy. El informe de mañana estará listo a las 6am.',

  // ── Onboarding ───────────────────────────────────────────────────────────────
  'onboarding.welcome.hi':     'Hola {firstName},',
  'onboarding.welcome.sub':    'Soy Sillages \u2014 tu agente personal de tienda.',
  'onboarding.welcome.body':   'Sé exactamente cómo te sientes. Tenemos una tienda, vemos los números, pero no entendemos bien por qué algunos días van bien y otros no. Demasiados datos, demasiadas pantallas, demasiadas cosas que supuestamente hay que hacer. Yo me encargo de eso.',
  'onboarding.step1':          'Cada mañana te diré qué pasó en nuestra tienda',
  'onboarding.step2':          'Trabajo cada noche mientras duermes \u2014 sin configuración',
  'onboarding.step3':          'Solo necesito acceso de solo lectura a nuestra tienda Shopify para empezar',
  'onboarding.cta':            'Vamos a trabajar \u2192',
  'onboarding.beta':           'Gratis durante la beta \u00b7 Sin tarjeta de crédito \u00b7 Cancela cuando quieras',
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
