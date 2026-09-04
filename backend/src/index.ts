import 'dotenv/config';

import { env } from './config/env.js';
import { getProductMode, isLegacyMode } from './config/productMode.js';
import { createApp } from './app.js';

import { startScheduler } from './services/scheduler.js';
import { startAuditor } from './services/auditor.js';

const app = createApp();

// ── Start server ──────────────────────────────────────────────
const PORT = env.PORT;

app.listen(PORT, () => {
  const mode = getProductMode();
  console.log(`[server] Running on port ${PORT} in ${env.NODE_ENV} mode (product=${mode})`);

  if (isLegacyMode()) {
    // Legacy product only: hourly event loop, daily/weekly briefs, orchestrator,
    // trial reminders, leads, outreach, nurture, inbox, content engine, Shopify
    // webhook verification and the auditor.
    startScheduler();
    startAuditor();
  } else {
    console.log('[server] Legacy background jobs disabled: scheduler and auditor not started');
  }
});

export default app;
