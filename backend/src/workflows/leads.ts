/**
 * Dynamic Leads Workflow — automated growth pipeline.
 *
 * SubAgent A: Import/discover new leads (manual CSV + public /products.json)
 * SubAgent B: Pain scoring via public Shopify endpoints (no headless browser)
 * SubAgent C: GPT-4o personalized outreach generation for top leads
 *
 * Feature flag: USE_DYNAMIC_LEADS=true
 * Cron: 0 6 * * * (06:00 UTC daily)
 */

import axios from 'axios';
import { supabase } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';
import { env } from '../config/env.js';

const LOG = '[workflow:leads]';

// ── Tavily Search Discovery ────────────────────────────────────────────────
// Tavily API — AI-optimized search
// Free tier: 1,000 searches/month → 10 queries/day × 30 days = 300 searches
// We run 10 queries/day (2 per category) = ~300/month, well within free tier.
// include_domains: ['myshopify.com'] focuses results on Shopify stores.

const DISCOVERY_QUERIES: { query: string; category: string }[] = [
  { query: 'site:myshopify.com food artisan bakery', category: 'food' },
  { query: 'site:myshopify.com organic gourmet specialty food', category: 'food' },
  { query: 'site:myshopify.com beauty skincare handmade', category: 'beauty' },
  { query: 'site:myshopify.com natural cosmetics beauty', category: 'beauty' },
  { query: 'site:myshopify.com fashion accessories boutique', category: 'fashion' },
  { query: 'site:myshopify.com handmade jewelry clothing', category: 'fashion' },
  { query: 'site:myshopify.com wellness supplements health', category: 'wellness' },
  { query: 'site:myshopify.com yoga fitness wellness', category: 'wellness' },
  { query: 'site:myshopify.com home decor gifts artisan', category: 'home' },
  { query: 'site:myshopify.com candles ceramics handmade gifts', category: 'home' },
];

// TODO: SerpAPI alternative ($50/mo) for Google results instead of Bing
// When budget allows, switch to:
//   import { serpApiSearch } from '../lib/serpapi.js';
//   Results are higher quality for Shopify store discovery.

// ── Types ──────────────────────────────────────────────────────────────────

interface LeadRow {
  id: string;
  shop_domain: string;
  shop_name: string | null;
  category: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  pain_score: number;
  pain_tags: string[];
  outreach_message: string | null;
  status: string;
  source: string | null;
}

interface PainAnalysis {
  score: number;
  tags: string[];
  productCount: number;
  hasEmailCapture: boolean;
  hasBundles: boolean;
  avgPrice: number;
  currency: string;
  storeDescription: string;
}

export interface LeadsWorkflowResult {
  imported: number;
  analyzed: number;
  drafted: number;
  errors: number;
  totalDuration_ms: number;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function runLeadsWorkflow(): Promise<LeadsWorkflowResult> {
  const start = Date.now();
  console.log(`${LOG} Starting leads workflow`);

  let imported = 0;
  let analyzed = 0;
  let drafted = 0;
  let errors = 0;

  // ── SubAgent A: discover new leads via Bing Search ──────────────────────
  if ((env.TAVILY_API_KEY || process.env.TAVILY_API_KEY)) {
    console.log(`${LOG} SubAgent A: Tavily discovery enabled — running ${DISCOVERY_QUERIES.length} queries`);
    const discovered = await discoverLeadsViaTavily();
    imported += discovered;
    console.log(`${LOG} SubAgent A: ${discovered} new leads discovered via Tavily`);
  } else {
    console.log(`${LOG} SubAgent A: Tavily discovery disabled (no TAVILY_API_KEY) — manual import only`);
  }

  // Load all new leads that need analysis (both discovered + manually imported)
  const { data: newLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .eq('pain_score', 0)
    .order('created_at', { ascending: true })
    .limit(50);

  const toAnalyze = newLeads?.length ?? 0;
  imported = Math.max(imported, toAnalyze); // include any manual imports
  console.log(`${LOG} SubAgent A: ${toAnalyze} leads pending analysis`);

  // ── SubAgent B: pain scoring (parallel, 5 at a time) ─────────────────────
  if (newLeads && newLeads.length > 0) {
    const BATCH_SIZE = 5;
    for (let i = 0; i < newLeads.length; i += BATCH_SIZE) {
      const batch = newLeads.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(lead => analyzeLead(lead as LeadRow).catch(err => {
          console.warn(`${LOG} Analysis failed for ${lead.shop_domain}: ${(err as Error).message}`);
          errors++;
          return null;
        })),
      );

      for (const result of results) {
        if (!result) continue;
        analyzed++;
      }
    }
  }

  console.log(`${LOG} SubAgent B: ${analyzed} leads analyzed, ${errors} errors`);

  // ── SubAgent C: outreach generation for top leads ────────────────────────
  const { data: topLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .gt('pain_score', 0)
    .is('outreach_message', null)
    .order('pain_score', { ascending: false })
    .limit(10);

  if (topLeads && topLeads.length > 0) {
    const outreachResults = await Promise.all(
      topLeads.map(lead => generateOutreach(lead as LeadRow).catch(err => {
        console.warn(`${LOG} Outreach gen failed for ${lead.shop_domain}: ${(err as Error).message}`);
        return null;
      })),
    );
    drafted = outreachResults.filter(Boolean).length;
  }

  console.log(`${LOG} SubAgent C: ${drafted} outreach messages drafted`);

  const totalDuration = Date.now() - start;

  // Log to workflow_runs
  try {
    await supabase.from('workflow_runs').insert({
      workflow: 'leads',
      started_at: new Date(start).toISOString(),
      duration_ms: totalDuration,
      merchants_total: imported,
      merchants_succeeded: analyzed,
      merchants_failed: errors,
      results: { imported, analyzed, drafted, errors },
    });
  } catch { /* table may not exist */ }

  console.log(`${LOG} Complete: found:${imported} analyzed:${analyzed} drafted:${drafted} errors:${errors} (${totalDuration}ms)`);

  return { imported, analyzed, drafted, errors, totalDuration_ms: totalDuration };
}

// ── SubAgent B: Analyze a single lead ──────────────────────────────────────

async function analyzeLead(lead: LeadRow): Promise<PainAnalysis> {
  const domain = lead.shop_domain;
  const analysis = await scrapePublicShopify(domain);

  // Update lead in DB
  await supabase
    .from('leads')
    .update({
      pain_score: analysis.score,
      pain_tags: analysis.tags,
      shop_name: analysis.storeDescription || lead.shop_name,
    })
    .eq('id', lead.id);

  console.log(`${LOG} [${domain}] pain_score=${analysis.score} tags=[${analysis.tags.join(',')}] products=${analysis.productCount}`);

  return analysis;
}

async function scrapePublicShopify(domain: string): Promise<PainAnalysis> {
  const tags: string[] = [];
  let score = 0;
  let productCount = 0;
  let hasEmailCapture = false;
  let hasBundles = false;
  let avgPrice = 0;
  let currency = 'USD';
  let storeDescription = '';

  // ── 1. Fetch /products.json (public, no auth needed) ──────────────────
  try {
    const productsUrl = domain.includes('myshopify.com')
      ? `https://${domain}/products.json?limit=50`
      : `https://${domain}/products.json?limit=50`;

    const { data } = await axios.get(productsUrl, { timeout: 10000, headers: { 'User-Agent': 'Sillages/1.0' } });
    const products = data.products as Array<{
      title: string; body_html: string; vendor: string; product_type: string;
      variants: Array<{ price: string; compare_at_price: string | null }>;
      tags: string[];
    }>;

    productCount = products.length;
    if (productCount === 0) {
      tags.push('no_products');
      return { score: 10, tags, productCount, hasEmailCapture, hasBundles, avgPrice, currency, storeDescription };
    }

    // Store description from first product vendor
    storeDescription = products[0]?.vendor ?? '';

    // Avg price
    const prices = products.flatMap(p => p.variants.map(v => parseFloat(v.price))).filter(p => p > 0);
    avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

    // ── Pain signals from product data ──

    // No compare_at_price on any variant → no urgency/discounts
    const hasCompareAt = products.some(p => p.variants.some(v => v.compare_at_price && parseFloat(v.compare_at_price) > 0));
    if (!hasCompareAt) {
      tags.push('no_urgency_pricing');
      score += 15;
    }

    // No bundles (check titles/tags for "bundle", "pack", "set", "kit")
    const bundleKeywords = /bundle|pack|set|kit|combo|lot/i;
    hasBundles = products.some(p => bundleKeywords.test(p.title) || p.tags.some(t => bundleKeywords.test(t)));
    if (!hasBundles) {
      tags.push('no_bundles');
      score += 10;
    }

    // Few products (< 10 indicates small store, high pain)
    if (productCount < 10) {
      tags.push('small_catalog');
      score += 5;
    }

    // No product descriptions
    const noDescription = products.filter(p => !p.body_html || p.body_html.length < 50).length;
    if (noDescription > productCount * 0.5) {
      tags.push('weak_descriptions');
      score += 10;
    }

    // No tags on products (poor SEO/organization)
    const noTags = products.filter(p => p.tags.length === 0).length;
    if (noTags > productCount * 0.5) {
      tags.push('no_product_tags');
      score += 5;
    }

    // High avg price (> $50) → higher recovery value per cart
    if (avgPrice > 50) {
      tags.push('high_aov');
      score += 10;
    }

  } catch (err) {
    // /products.json blocked or domain unreachable
    tags.push('products_unavailable');
    score += 5;
  }

  // ── 2. Fetch homepage meta tags (lightweight, no headless) ────────────
  try {
    const { data: html } = await axios.get(`https://${domain}`, {
      timeout: 8000,
      headers: { 'User-Agent': 'Sillages/1.0' },
      maxRedirects: 3,
      responseType: 'text',
    });

    const htmlStr = typeof html === 'string' ? html.slice(0, 50000) : ''; // cap at 50KB

    // Check for email capture (newsletter, popup, Klaviyo, Mailchimp)
    const emailCapturePatterns = /klaviyo|mailchimp|omnisend|newsletter|email-signup|popup.*email|subscribe.*email/i;
    hasEmailCapture = emailCapturePatterns.test(htmlStr);
    if (!hasEmailCapture) {
      tags.push('no_email_capture');
      score += 20;
    }

    // Check for meta description
    const metaDesc = htmlStr.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    if (!metaDesc || metaDesc[1].length < 30) {
      tags.push('weak_meta_description');
      score += 5;
    } else {
      storeDescription = storeDescription || metaDesc[1];
    }

    // Check for analytics (no analytics = less sophisticated)
    const hasAnalytics = /google-analytics|gtag|fbq|segment\.com|hotjar/i.test(htmlStr);
    if (!hasAnalytics) {
      tags.push('no_analytics');
      score += 5;
    }

    // Check for review app (no reviews = missed social proof)
    const hasReviews = /judge\.me|loox|yotpo|stamped|reviews\.shopify/i.test(htmlStr);
    if (!hasReviews) {
      tags.push('no_reviews');
      score += 10;
    }

  } catch {
    tags.push('homepage_unavailable');
  }

  // Cap at 100
  score = Math.min(score, 100);

  return { score, tags, productCount, hasEmailCapture, hasBundles, avgPrice, currency, storeDescription };
}

// ── SubAgent C: Generate personalized outreach ────────────────────────────

async function generateOutreach(lead: LeadRow): Promise<string> {
  const painTags = lead.pain_tags ?? [];
  const painDescription = painTags.map(tag => {
    const descriptions: Record<string, string> = {
      no_email_capture: 'no email capture or newsletter signup on your site',
      no_urgency_pricing: 'no compare-at pricing or urgency mechanics',
      no_bundles: 'no product bundles or packs to increase order value',
      weak_descriptions: 'many products with short or missing descriptions',
      no_reviews: 'no review app for social proof',
      no_analytics: 'limited analytics tracking',
      no_product_tags: 'products without tags (hurts discoverability)',
      high_aov: 'high average order value (great recovery potential)',
      small_catalog: 'focused catalog (every sale counts)',
    };
    return descriptions[tag] ?? tag;
  }).filter(Boolean);

  const topPains = painDescription.slice(0, 3).join(', ');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.7,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: `You write short, personalized outreach messages for a Shopify app called Sillages.
Sillages sends store owners a daily AI brief about their store — revenue, top products, customer patterns, and one action to take today. It also recovers abandoned carts with personalized emails.

Rules:
- Max 4 sentences
- Reference the SPECIFIC pain you detected (not generic)
- Don't be salesy. Be helpful and specific.
- End with a low-pressure CTA (check it out, might be useful)
- Sign as "Tony from Sillages"
- No emojis in the outreach
- If the store has high AOV, mention cart recovery specifically
- If they have no email capture, mention the welcome email feature`,
      },
      {
        role: 'user',
        content: `Store: ${lead.shop_name ?? lead.shop_domain}
Domain: ${lead.shop_domain}
Category: ${lead.category ?? 'unknown'}
Pain score: ${lead.pain_score}/100
Detected issues: ${topPains || 'general small store pain'}
Product count: ${lead.pain_tags?.includes('small_catalog') ? 'small' : 'normal'}

Write a personalized outreach message for this store owner.`,
      },
    ],
  });

  const message = completion.choices[0]?.message?.content?.trim() ?? '';

  if (message) {
    await supabase
      .from('leads')
      .update({ outreach_message: message, status: 'draft' })
      .eq('id', lead.id);

    console.log(`${LOG} [${lead.shop_domain}] Outreach drafted (score=${lead.pain_score})`);
  }

  return message;
}

// ── Manual import: insert leads from domain list ──────────────────────────

export async function importLeads(
  domains: string[],
  category: string,
  source: string = 'manual',
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (const rawDomain of domains) {
    const domain = rawDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) continue;

    // Normalize to myshopify.com if it's just a name
    const shopDomain = domain.includes('.') ? domain : `${domain}.myshopify.com`;

    const { error } = await supabase
      .from('leads')
      .insert({
        shop_domain: shopDomain,
        category,
        source,
        status: 'new',
        pain_score: 0,
      });

    if (error) {
      if (error.code === '23505') { // duplicate
        skipped++;
      } else {
        console.warn(`${LOG} Import error for ${shopDomain}: ${error.message}`);
        skipped++;
      }
    } else {
      imported++;
    }
  }

  console.log(`${LOG} Import: ${imported} new, ${skipped} skipped`);
  return { imported, skipped };
}

// ── SubAgent A: Tavily Search Discovery ───────────────────────────────────

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Discover new Shopify stores via Tavily Search API.
 * Runs 10 queries (2 per category), extracts myshopify.com domains,
 * deduplicates against existing leads, inserts new ones.
 * Free tier: 1,000 searches/month → 10 queries/day = 300/month.
 */
async function discoverLeadsViaTavily(): Promise<number> {
  const apiKey = (env.TAVILY_API_KEY || process.env.TAVILY_API_KEY);
  if (!apiKey) return 0;

  let totalDiscovered = 0;

  for (const { query, category } of DISCOVERY_QUERIES) {
    try {
      const { data } = await axios.post('https://api.tavily.com/search', {
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 10,
        include_domains: ['myshopify.com'],
      }, { timeout: 15000 });

      const results = (data.results ?? []) as TavilyResult[];

      for (const result of results) {
        const domain = extractShopifyDomain(result.url);
        if (!domain) continue;

        const shopName = extractStoreName(result.title, domain);

        const { error } = await supabase
          .from('leads')
          .insert({
            shop_domain: domain,
            shop_name: shopName,
            category,
            source: 'tavily_discovery',
            status: 'new',
            pain_score: 0,
          });

        if (!error) {
          totalDiscovered++;
        }
        // 23505 = duplicate — silently skip
      }

      console.log(`${LOG} Tavily: "${query.slice(0, 40)}..." → ${results.length} results, category=${category}`);

      // Small delay between queries
      await new Promise(resolve => setTimeout(resolve, 300));

    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : null;
      if (status === 401 || status === 403) {
        console.error(`${LOG} Tavily API key invalid — stopping discovery`);
        break;
      }
      if (status === 429) {
        console.warn(`${LOG} Tavily rate limit hit — stopping for today`);
        break;
      }
      console.warn(`${LOG} Tavily query failed: ${(err as Error).message}`);
    }
  }

  return totalDiscovered;
}

/**
 * Extract myshopify.com domain from any URL.
 * Handles: https://store-name.myshopify.com/anything
 *          https://custom-domain.com (with myshopify.com in redirect)
 */
function extractShopifyDomain(url: string): string | null {
  // Direct myshopify.com URL
  const myshopifyMatch = url.match(/([a-z0-9][a-z0-9-]*\.myshopify\.com)/i);
  if (myshopifyMatch) {
    return myshopifyMatch[1].toLowerCase();
  }

  // Custom domain — we'll store it as-is and resolve later
  // Only accept if the URL looks like a Shopify store
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = parsed.hostname.toLowerCase();
    // Skip common non-store domains
    if (host.includes('shopify.com') && !host.includes('myshopify.com')) return null;
    if (host.includes('google.') || host.includes('bing.') || host.includes('youtube.')) return null;
    if (host.includes('facebook.') || host.includes('instagram.') || host.includes('tiktok.')) return null;
    if (host.includes('reddit.') || host.includes('twitter.') || host.includes('linkedin.')) return null;
    if (host.includes('amazon.') || host.includes('etsy.') || host.includes('ebay.')) return null;
    if (host.includes('wikipedia.') || host.includes('pinterest.')) return null;

    // Accept custom domains from Bing results — they may be Shopify stores
    return host;
  } catch {
    return null;
  }
}

/**
 * Extract a clean store name from Bing result title.
 * "Artisan Bakery – Fresh Bread & Pastries" → "Artisan Bakery"
 */
function extractStoreName(title: string, _domain: string): string {
  // Remove common suffixes
  let name = title
    .replace(/\s*[-–—|·]\s*.*(shopify|store|shop|online|home|official).*$/i, '')
    .replace(/\s*[-–—|·]\s*$/i, '')
    .trim();

  // If title is just a URL or too long, use first part
  if (name.length > 50) {
    name = name.split(/[-–—|·]/)[0].trim();
  }

  return name || title.slice(0, 50);
}
