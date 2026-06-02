import 'dotenv/config';
import { runOutreachWorkflow } from '../workflows/outreach.js';
async function main() {
  console.log('Running outreach workflow...');
  const result = await runOutreachWorkflow();
  console.log('\nRESULT:', JSON.stringify(result, null, 2));
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
