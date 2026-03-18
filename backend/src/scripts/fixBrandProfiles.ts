import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

/**
 * Ensures brand_profiles has the required columns and NICOLINA has the correct values.
 * Run: npx tsx src/scripts/fixBrandProfiles.ts
 */

const ANDREA_ID = 'e77572ee-83df-43e8-8f69-f143a227fe56';

const NICOLINA = {
  logo_url: 'https://nicolina.es/cdn/shop/files/Logo-NICOLINA-sin_marco_bafd65b0-74df-4d6e-beb0-901d1ad206ae_170x.png?v=1720607162',
  primary_color: '#c0dcb0',
  shop_url: 'https://nicolina.es',
  contact_email: 'info@nicolina.es',
  contact_phone: '611 34 20 73',
  contact_address: 'C/ Potosí 4 · C/ Conde de Peñalver 18 · Madrid',
  social_links: { instagram: 'https://www.instagram.com/nicolinamadrid/' },
};

async function main() {
  // Check if brand_profiles exists for NICOLINA
  const { data: bp, error } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('account_id', ANDREA_ID)
    .maybeSingle();

  if (error) {
    console.error('Error reading brand_profiles:', error.message);
    console.log('\nIf the columns do not exist, run this SQL in Supabase:');
    console.log(`
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS primary_color TEXT,
  ADD COLUMN IF NOT EXISTS shop_url TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_address TEXT,
  ADD COLUMN IF NOT EXISTS social_links JSONB;
    `);
    return;
  }

  console.log('Current brand_profiles for NICOLINA:', bp);

  // Upsert with correct values
  const { error: upsertError } = await supabase
    .from('brand_profiles')
    .update(NICOLINA)
    .eq('account_id', ANDREA_ID);

  if (upsertError) {
    console.error('Update failed:', upsertError.message);
    console.log('\nThe columns may not exist. Run this SQL first:');
    console.log(`
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS primary_color TEXT,
  ADD COLUMN IF NOT EXISTS shop_url TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_address TEXT,
  ADD COLUMN IF NOT EXISTS social_links JSONB;
    `);
    console.log('\nThen run this SQL to populate:');
    console.log(`
UPDATE brand_profiles SET
  logo_url = '${NICOLINA.logo_url}',
  primary_color = '${NICOLINA.primary_color}',
  shop_url = '${NICOLINA.shop_url}',
  contact_email = '${NICOLINA.contact_email}',
  contact_phone = '${NICOLINA.contact_phone}',
  contact_address = '${NICOLINA.contact_address}',
  social_links = '${JSON.stringify(NICOLINA.social_links)}'
WHERE account_id = '${ANDREA_ID}';
    `);
    return;
  }

  // Verify
  const { data: updated } = await supabase
    .from('brand_profiles')
    .select('logo_url, primary_color, shop_url, contact_email, contact_phone, contact_address, social_links')
    .eq('account_id', ANDREA_ID)
    .single();

  console.log('\nUpdated brand_profiles:', updated);
  console.log('\n✅ Done. Logo URL:', updated?.logo_url ? 'SET' : 'MISSING');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
