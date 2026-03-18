import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

async function main() {
  const { data, error } = await sb
    .from('email_unsubscribes')
    .delete()
    .eq('email', 'tony@richmondpartner.com')
    .select();

  if (error) { console.error('Error:', error.message); return; }
  console.log(`Deleted ${data?.length ?? 0} unsubscribe record(s) for tony@richmondpartner.com`);
}

main();
