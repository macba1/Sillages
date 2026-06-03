/**
 * Dynamic Content Engine — daily Instagram content (cron, flag USE_DYNAMIC_CONTENT).
 *
 * Per day, idempotent (1 post/day):
 *   1. Pick a source (rotating): real anonymized lead patterns vs evergreen.
 *   2. Generate caption + hook (GPT-4o).
 *   3. Render a branded 1080×1350 image ($0, sharp).
 *   4. Publish via Postiz (schedule for the evening slot) — gated on Postiz config.
 *   5. Log to content_posts.
 *   6. Generate DM drafts for top leads (drafts only, never auto-sent).
 *
 * Reel queue (content_queue) takes priority over image days when present.
 */

import { supabase } from '../lib/supabase.js';
import { generateCaption } from '../services/contentCaption.js';
import { buildBrandedImage } from '../services/contentImage.js';
import { generateDmDraftsForTopLeads } from '../services/dmDraftGenerator.js';
import { isPostizConfigured, uploadMedia, resolveInstagramIntegrationId, createPost } from '../lib/postiz.js';

const LOG = '[workflow:content]';

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

/** Next occurrence of 16:00 UTC (~18:00 Europe/Madrid in summer). */
function nextEveningSlot(now: Date): Date {
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 16, 0, 0));
  if (slot.getTime() <= now.getTime()) slot.setUTCDate(slot.getUTCDate() + 1);
  return slot;
}

export interface ContentEngineResult {
  skipped?: string;
  postId?: string | null;
  status?: string;
  source?: string;
  caption?: string;
  hook?: string;
  dmDrafts?: number;
  dryRun?: boolean;
  imageBytes?: number;
}

export async function runContentEngineWorkflow(opts: { dryRun?: boolean } = {}): Promise<ContentEngineResult> {
  const dryRun = opts.dryRun ?? false;
  const start = Date.now();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  console.log(`${LOG} Start ${today} dryRun=${dryRun}`);

  // ── Idempotency: 1 post/day ──
  if (!dryRun) {
    const { data: existing } = await supabase.from('content_posts').select('id, status').eq('post_date', today).maybeSingle();
    if (existing) {
      console.log(`${LOG} content_posts already exists for ${today} (status=${existing.status}) — skipping`);
      return { skipped: 'already_posted_today', status: existing.status };
    }
  }

  // ── Source rotation: even day = lead pattern, odd = evergreen ──
  const rotation = dayOfYear(now);
  let source: 'lead_pattern' | 'evergreen' = rotation % 2 === 0 ? 'lead_pattern' : 'evergreen';
  let painTags: string[] = [];
  if (source === 'lead_pattern') {
    const { data: leads } = await supabase.from('leads').select('pain_tags').gt('pain_score', 0).order('pain_score', { ascending: false }).limit(30);
    const freq = new Map<string, number>();
    for (const l of leads ?? []) for (const t of (l.pain_tags as string[] ?? [])) freq.set(t, (freq.get(t) ?? 0) + 1);
    painTags = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
    if (painTags.length === 0) source = 'evergreen'; // no lead data → fall back
  }

  // ── Caption + image ──
  const caption = await generateCaption({ source, painTags, rotation });
  const image = await buildBrandedImage({ hook: caption.hook, seed: rotation });
  console.log(`${LOG} caption(${source}) hook="${caption.hook}" image=${image.length}B`);

  // ── Dry-run: stop before publishing ──
  if (dryRun) {
    const dmDrafts = await generateDmDraftsForTopLeads({ limit: 3, persist: false });
    return { dryRun: true, source, hook: caption.hook, caption: caption.caption, imageBytes: image.length, dmDrafts: dmDrafts.length };
  }

  // ── Publish via Postiz (gated) ──
  let postizPostId: string | null = null;
  let imageUrl: string | null = null;
  let status: 'scheduled' | 'draft' | 'failed' = 'draft';
  let error: string | null = null;

  if (isPostizConfigured()) {
    try {
      const media = await uploadMedia(image, `sillages-${today}.png`, 'image/png');
      imageUrl = media.path;
      const integrationId = await resolveInstagramIntegrationId();
      const res = await createPost({ integrationId, content: caption.caption, media, when: nextEveningSlot(now), mode: 'schedule' });
      postizPostId = res.postId;
      status = 'scheduled';
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
      console.error(`${LOG} Postiz publish failed: ${error}`);
    }
  } else {
    error = 'postiz_not_configured';
    console.warn(`${LOG} Postiz not configured — saving caption/image as draft only (no publish)`);
  }

  const { data: row } = await supabase.from('content_posts').insert({
    post_date: today,
    kind: 'image',
    caption: caption.caption,
    image_url: imageUrl,
    source,
    postiz_post_id: postizPostId,
    status,
    scheduled_for: status === 'scheduled' ? nextEveningSlot(now).toISOString() : null,
    error,
  }).select('id').single();

  // ── DM drafts (never auto-sent) ──
  const dmDrafts = await generateDmDraftsForTopLeads({ limit: 5, persist: true });

  // ── Log run ──
  try {
    await supabase.from('workflow_runs').insert({
      workflow: 'content',
      started_at: new Date(start).toISOString(),
      duration_ms: Date.now() - start,
      merchants_total: 1,
      merchants_succeeded: status === 'failed' ? 0 : 1,
      merchants_failed: status === 'failed' ? 1 : 0,
      results: { source, status, postizPostId, dmDrafts: dmDrafts.length, error },
    });
  } catch { /* non-fatal */ }

  console.log(`${LOG} Done status=${status} post=${row?.id ?? '-'} dmDrafts=${dmDrafts.length} (${Date.now() - start}ms)`);
  return { postId: postizPostId, status, source, hook: caption.hook, caption: caption.caption, dmDrafts: dmDrafts.length };
}
