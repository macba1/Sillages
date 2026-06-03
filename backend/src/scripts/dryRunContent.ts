/**
 * DRY-RUN content engine. Generates a real caption + branded image + 3 DM drafts.
 * Saves the image to disk. PUBLISHES NOTHING, persists nothing.
 *   node --env-file=.env node_modules/.bin/tsx src/scripts/dryRunContent.ts
 */
import fs from 'fs';
import { generateCaption } from '../services/contentCaption.js';
import { buildBrandedImage } from '../services/contentImage.js';
import { generateDmDraftsForTopLeads } from '../services/dmDraftGenerator.js';
import { supabase } from '../lib/supabase.js';

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // pull top pain tags from real leads
  const { data: leads } = await supabase.from('leads').select('pain_tags').gt('pain_score', 0).order('pain_score', { ascending: false }).limit(30);
  const freq = new Map<string, number>();
  for (const l of leads ?? []) for (const t of (l.pain_tags as string[] ?? [])) freq.set(t, (freq.get(t) ?? 0) + 1);
  const painTags = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);

  console.log('=== DRY-RUN content engine (nothing published) ===');
  console.log('Top lead pain tags:', painTags.join(', ') || '(none)');

  const caption = await generateCaption({ source: painTags.length ? 'lead_pattern' : 'evergreen', painTags, rotation: 0 });
  console.log('\n--- HOOK ---\n' + caption.hook);
  console.log('\n--- CAPTION ---\n' + caption.caption);

  const img = await buildBrandedImage({ hook: caption.hook, seed: 0 });
  const outPath = `${process.cwd()}/content-dryrun-${today}.png`;
  fs.writeFileSync(outPath, img);
  console.log(`\n--- IMAGE --- ${img.length} bytes saved to:\n${outPath}`);

  console.log('\n--- 3 DM DRAFTS (real leads, not persisted, not sent) ---');
  const drafts = await generateDmDraftsForTopLeads({ limit: 3, persist: false, requireHandle: false });
  drafts.forEach((d, i) => {
    console.log(`\n[${i + 1}] ${d.shop_domain} ig=@${d.instagram_handle ?? '(handle pending)'} (${d.draft_text.length} chars)`);
    console.log(d.draft_text);
  });

  console.log('\n=== END DRY-RUN ===');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
