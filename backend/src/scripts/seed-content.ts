/**
 * SEED content — one-shot (NOT a cron). Generates 12 Instagram posts and
 * schedules them via Postiz across 4 days, 3/day at 10:00 / 14:00 / 19:00 Madrid,
 * starting tomorrow. Day-1 batch goes in as Postiz DRAFTS for Tony to approve.
 * All 12 are saved to content_posts with status='seeded'.
 *
 *   node --env-file=.env node_modules/.bin/tsx src/scripts/seed-content.ts          # real (needs Postiz)
 *   node --env-file=.env node_modules/.bin/tsx src/scripts/seed-content.ts --dry     # preview, no Postiz, no DB
 *   node --env-file=.env node_modules/.bin/tsx src/scripts/seed-content.ts --force   # re-seed even if seeds exist
 *
 * The normal daily cron skips while any seeded post is still queued (see content-engine.ts).
 */
import fs from 'fs';
import { fromZonedTime } from 'date-fns-tz';
import { supabase } from '../lib/supabase.js';
import { generateCaption, type CaptionSource } from '../services/contentCaption.js';
import { buildBrandedImage, TEMPLATES } from '../services/contentImage.js';
import { isPostizConfigured, uploadMedia, resolveInstagramIntegrationId, createPost } from '../lib/postiz.js';

const TZ = 'Europe/Madrid';
const SLOT_HOURS = [10, 14, 19];          // Madrid local
const PER_DAY = 3;
const TOTAL = 12;

// 12 topics. 'lead_pattern' ones use real anonymized pain tags.
const TOPICS: Array<{ theme: string; source: CaptionSource }> = [
  { theme: 'carritos abandonados que nadie recupera', source: 'evergreen' },
  { theme: 'la recompra: el cliente que ya te compró es oro', source: 'evergreen' },
  { theme: 'clientes que compran una vez y desaparecen', source: 'evergreen' },
  { theme: 'casos reales (anónimos) de tiendas pequeñas', source: 'lead_pattern' },
  { theme: 'descripciones de producto que no venden', source: 'evergreen' },
  { theme: 'falta de urgencia y escasez en la tienda', source: 'evergreen' },
  { theme: 'no capturar emails de tus visitantes', source: 'evergreen' },
  { theme: 'reseñas y prueba social que faltan', source: 'evergreen' },
  { theme: 'packs y bundles para subir el ticket', source: 'evergreen' },
  { theme: 'casos reales (anónimos): patrones que repetimos', source: 'lead_pattern' },
  { theme: 'el calendario comercial que no estás aprovechando', source: 'evergreen' },
  { theme: 'medir qué funciona en tu tienda', source: 'evergreen' },
];

/** UTC Date for slot i (0..11): day = floor(i/3) from tomorrow, hour = SLOT_HOURS[i%3] Madrid. */
function slotForIndex(i: number, tomorrow: Date): { date: string; slotIndex: number; whenUtc: Date } {
  const dayOffset = Math.floor(i / PER_DAY);
  const slotIndex = i % PER_DAY;
  const d = new Date(tomorrow);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  const ymd = d.toISOString().slice(0, 10);
  const hh = String(SLOT_HOURS[slotIndex]).padStart(2, '0');
  const whenUtc = fromZonedTime(`${ymd}T${hh}:00:00`, TZ);
  return { date: ymd, slotIndex, whenUtc };
}

async function main() {
  const dry = process.argv.includes('--dry');
  const force = process.argv.includes('--force');

  if (!dry && !isPostizConfigured()) {
    console.error('Postiz not configured. Deploy Postiz + set POSTIZ_API_URL/KEY, or run with --dry to preview.');
    process.exit(1);
  }

  // Idempotency: don't double-seed.
  if (!dry) {
    const { count } = await supabase.from('content_posts').select('*', { count: 'exact', head: true }).eq('status', 'seeded');
    if ((count ?? 0) > 0 && !force) {
      console.error(`Already ${count} seeded post(s) exist. Use --force to re-seed.`);
      process.exit(1);
    }
  }

  // Real lead pain tags for lead_pattern topics.
  const { data: leads } = await supabase.from('leads').select('pain_tags').gt('pain_score', 0).order('pain_score', { ascending: false }).limit(30);
  const freq = new Map<string, number>();
  for (const l of leads ?? []) for (const t of (l.pain_tags as string[] ?? [])) freq.set(t, (freq.get(t) ?? 0) + 1);
  const painTags = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);

  // Tomorrow at 00:00 UTC as the base day.
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  const integrationId = dry || !isPostizConfigured() ? null : await resolveInstagramIntegrationId();
  let scheduled = 0, drafted = 0, failed = 0;

  for (let i = 0; i < TOTAL; i++) {
    const topic = TOPICS[i];
    const { date, slotIndex, whenUtc } = slotForIndex(i, tomorrow);
    const isDay1 = Math.floor(i / PER_DAY) === 0;
    const mode = isDay1 ? 'draft' : 'schedule';
    const tpl = TEMPLATES[i % TEMPLATES.length];

    try {
      const caption = await generateCaption({
        source: topic.source,
        customTheme: topic.source === 'evergreen' ? topic.theme : undefined,
        painTags: topic.source === 'lead_pattern' ? painTags : undefined,
        rotation: i,
      });
      const img = await buildBrandedImage({ hook: caption.hook, template: tpl });

      console.log(`\n[${i + 1}/${TOTAL}] ${date} ${SLOT_HOURS[slotIndex]}:00 Madrid (${whenUtc.toISOString()}) tpl=${tpl.name} mode=${mode}`);
      console.log(`   hook: ${caption.hook}`);

      if (dry) {
        const out = `${process.cwd()}/seed-${String(i + 1).padStart(2, '0')}-${tpl.name}.png`;
        fs.writeFileSync(out, img);
        console.log(`   image -> ${out} (${img.length}B)  [DRY: not scheduled, not saved]`);
        continue;
      }

      const media = await uploadMedia(img, `sillages-seed-${date}-${slotIndex}.png`, 'image/png');
      const res = await createPost({ integrationId: integrationId!, content: caption.caption, media, when: whenUtc, mode });
      if (mode === 'draft') drafted++; else scheduled++;

      await supabase.from('content_posts').insert({
        post_date: date,
        slot_index: slotIndex,
        kind: 'image',
        caption: caption.caption,
        image_url: media.path,
        source: topic.source,
        postiz_post_id: res.postId,
        status: 'seeded',
        scheduled_for: whenUtc.toISOString(),
      });
    } catch (err) {
      failed++;
      console.error(`   FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n=== SEED DONE === drafted(day1)=${drafted} scheduled=${scheduled} failed=${failed}${dry ? ' [DRY RUN]' : ''}`);
  if (!dry) console.log('Review day-1 drafts in the Postiz UI and approve. Daily cron stays off until all seeds fire.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
