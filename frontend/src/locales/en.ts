export const en = {
  // ── Navigation ──────────────────────────────────────────────────────────────
  'nav.dashboard':   'Dashboard',
  'nav.briefs':      'Briefs',
  'nav.alerts':      'Alerts',
  'nav.settings':    'Settings',
  'nav.signOut':     'Sign out',

  // ── Dashboard ───────────────────────────────────────────────────────────────
  'dash.statusPill':           'Sillages is active',
  'dash.greeting.morning':     'Good morning',
  'dash.greeting.afternoon':   'Good afternoon',
  'dash.greeting.evening':     'Good evening',

  'dash.generating.title':     'Generating your first brief\u2026',
  'dash.generating.body':      'Pulling your store data now. This usually takes under a minute.',

  'dash.empty.title':          'Your first brief will arrive tomorrow morning, once your store data is ready.',
  'dash.empty.settingsWord':   'Settings',

  'dash.cta':                  "Read this morning\u2019s brief \u2192",
  'dash.readTime':             '5 min read',

  'dash.section.working':      "What I\u2019m working on",
  'dash.section.previous':     'Previous briefings',
  'dash.readArrow':            'Read \u2192',

  // Working item timing labels
  'when.tonight':   'Tonight',
  'when.tomorrow':  'Tomorrow',
  'when.thisWeek':  'This week',

  // Working item body strings ({product}, {issue}, {metric} are interpolated)
  'work.watching':         'Watching if {product} keeps selling',
  'work.watchingDefault':  "Pulling today\u2019s orders and comparing against yesterday",
  'work.checking':         'Looking into {issue} \u2014 {metric}',
  'work.checkingDefault':  'Checking whether abandoned carts closed today',
  'work.briefReady':       'Brief ready by 6am',
  'work.gapDefault':       'Tracking whether more visitors complete their purchase',

  // ── Briefs list ──────────────────────────────────────────────────────────────
  'briefs.title':   'Your briefings.',
  'briefs.empty':   'No briefs yet. Your first one will arrive tomorrow morning.',
  'briefs.readArrow': 'Read \u2192',

  // ── Brief detail ─────────────────────────────────────────────────────────────
  'brief.back':               'Back',
  'brief.section.worked':     'What worked yesterday',
  'brief.section.notWorked':  "What didn\u2019t",
  'brief.section.watching':   "What I\u2019m watching",
  'brief.section.gap':        'The gap',
  'brief.section.activation': 'One thing to do today',
  'brief.upside':             'Upside:',
  'brief.expected':           'Expected:',
  'brief.footer':             "Tonight I\u2019ll pull today\u2019s data. Tomorrow\u2019s brief ready by 6am.",

  // ── Alerts ───────────────────────────────────────────────────────────────────
  'alerts.title':    'Alerts.',
  'alerts.subtitle': 'Things I noticed that I thought you should know about.',
  'alerts.empty':    'Nothing to flag right now.',
  'alerts.gotIt':    'Got it',
  'alerts.exampleNote': 'These are examples. Real alerts will appear here when I notice something worth telling you about.',
  'alerts.example1.title': "Something\u2019s off with our visitors",
  'alerts.example1.message': "A lot of people came to our store but very few actually bought something. I traced it back to the product page \u2014 something there is creating hesitation. I\u2019ll tell you exactly what to fix.",
  'alerts.example2.title': 'Our best product deserves more visibility',
  'alerts.example2.message': "The same product has been our top seller for 3 days in a row but it\u2019s not the first thing people see when they land on our store. Moving it to the top of the page takes 5 minutes and will probably sell more today.",

  // ── Settings ─────────────────────────────────────────────────────────────────
  'settings.title':                  'Settings',
  'settings.section.shopify':        'Shopify connection',
  'settings.section.preferences':    'Brief preferences',
  'settings.section.plan':           'Plan',
  'settings.section.account':        'Account',
  'settings.section.testing':        'Testing',

  'settings.lang.label':             'Language',
  'settings.lang.desc':              'Language for your briefs and the app.',

  'settings.shopify.connected':      'Connected',
  'settings.shopify.disconnect':     'Disconnect',
  'settings.shopify.briefsNightly':  'Briefs are generated nightly',
  'settings.shopify.briefsDesc':     "I pull your store data every night and have your brief ready by 6am.",
  'settings.shopify.noStore':        'No store connected',
  'settings.shopify.noStoreDesc':    'Connect your Shopify store to start receiving daily briefs.',
  'settings.shopify.connect':        'Connect store',

  'settings.delivery.label':         'Delivery time',
  'settings.delivery.desc':          'When you receive your morning brief.',

  'settings.plan.free':              'Free during beta',
  'settings.plan.freeDesc':          'Full access, no credit card required. Pricing starts at $9/month at launch.',

  'settings.account.emailDesc':      'Your account email.',
  'settings.account.signOut':        'Sign out',

  'settings.badge.beta':             'Beta',
  'settings.badge.comingSoon':       'Coming soon',

  'settings.testing.generateLabel':  'Generate brief now',
  'settings.testing.generateDesc':   "Sync yesterday\u2019s store data and generate a brief immediately.",
  'settings.testing.generateBtn':    'Generate brief',
  'settings.testing.generating':     'Generating\u2026',
  'settings.testing.seedLabel':      'Load test data & generate',
  'settings.testing.seedDesc':       'Insert realistic store data and generate a brief without Shopify.',
  'settings.testing.seedBtn':        'Load & generate',
  'settings.testing.loading':        'Loading\u2026',
} as const;

export type Translations = typeof en;
export type TranslationKey = keyof Translations;
