import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const id = process.argv[2];
if (!id) { console.error('Usage: npx tsx src/scripts/deleteAction.ts <action-id>'); process.exit(1); }

async function main() {
  const { error } = await supabase.from('pending_actions').delete().eq('id', id);
  console.log(error ? `Error: ${error.message}` : `Deleted action ${id}`);
}
main();
