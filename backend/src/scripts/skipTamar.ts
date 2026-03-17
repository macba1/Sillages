import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

async function main() {
  const { error } = await supabase
    .from('pending_actions')
    .update({
      status: 'completed',
      approved_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      result: { skipped: true, reason: 'Tamar ya completó su compra (Order #8003). Email no enviado.' },
    })
    .eq('id', '95268a13-952f-4cc1-a992-636198b3e66d');

  console.log(error ? `Error: ${error.message}` : '✓ Tamar action marked as skipped');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
