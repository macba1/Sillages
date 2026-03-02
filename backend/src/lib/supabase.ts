import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Service role client — bypasses RLS, only used server-side
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
