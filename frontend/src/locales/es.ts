import type { Translations } from './en';

export const es: Translations = {
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
};
