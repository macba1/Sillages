import axios from 'axios';
import { supabase } from '../lib/supabase.js';
import { shopifyClient } from '../lib/shopify.js';
import { openai } from '../lib/openai.js';

const LOG = '[brandAnalyzer]';

// ── Public interface ────────────────────────────────────────────────────────

export interface BrandProfile {
  brand_voice: string;
  brand_values: string;
  brand_emotion: string;
  content_style: string;
  target_audience: string;
  unique_selling_points: string;
  competitor_differentiation: string;
}

/**
 * Analyzes a store's brand identity by scraping its public storefront,
 * reading its Shopify products/collections, and generating a brand profile
 * using OpenAI. Runs ONCE per store at connection time.
 */
export async function analyzeBrand(accountId: string): Promise<BrandProfile> {
  console.log(`${LOG} Starting brand analysis for account ${accountId}`);

  // Load connection
  const { data: conn } = await supabase
    .from('shopify_connections')
    .select('shop_domain, shop_name, access_token')
    .eq('account_id', accountId)
    .single();

  if (!conn) throw new Error(`${LOG} No connection for account ${accountId}`);

  const client = shopifyClient(conn.shop_domain, conn.access_token);

  // Gather data in parallel
  const [shopInfo, products, collections, storefrontData] = await Promise.all([
    client.getShop(),
    client.getProducts({ limit: 50 }).catch(() => []),
    client.getCollections().catch(() => []),
    scrapeStorefront(conn.shop_domain),
  ]);

  // Build raw data digest for OpenAI
  const rawData = {
    shop: {
      name: shopInfo.name,
      domain: shopInfo.domain,
      myshopify_domain: shopInfo.myshopify_domain,
      currency: shopInfo.currency,
    },
    products: products.slice(0, 30).map((p: Record<string, unknown>) => ({
      title: p.title,
      type: p.product_type,
      tags: p.tags,
      vendor: p.vendor,
      description: stripHtml(String(p.body_html ?? '')).slice(0, 300),
      price_range: getPriceRange(p.variants as Array<{ price: string }> | undefined),
      image_count: (p.images as unknown[])?.length ?? 0,
    })),
    collections: collections.slice(0, 15).map((c: Record<string, unknown>) => ({
      title: c.title,
      description: stripHtml(String(c.body_html ?? '')).slice(0, 200),
    })),
    storefront: storefrontData,
  };

  console.log(`${LOG} Data gathered — ${products.length} products, ${collections.length} collections, storefront: ${storefrontData ? 'scraped' : 'failed'}`);

  // Generate brand profile with OpenAI
  const profile = await generateBrandProfile(rawData, shopInfo.name);

  // Save to DB
  const { error } = await supabase
    .from('brand_profiles')
    .upsert({
      account_id: accountId,
      brand_voice: profile.brand_voice,
      brand_values: profile.brand_values,
      brand_emotion: profile.brand_emotion,
      content_style: profile.content_style,
      target_audience: profile.target_audience,
      unique_selling_points: profile.unique_selling_points,
      competitor_differentiation: profile.competitor_differentiation,
      raw_data: rawData,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id' });

  if (error) {
    console.error(`${LOG} Failed to save brand profile: ${error.message}`);
  } else {
    console.log(`${LOG} Brand profile saved for ${shopInfo.name}`);
  }

  return profile;
}

/**
 * Loads an existing brand profile from DB, or returns null.
 */
export async function loadBrandProfile(accountId: string): Promise<BrandProfile | null> {
  const { data } = await supabase
    .from('brand_profiles')
    .select('brand_voice, brand_values, brand_emotion, content_style, target_audience, unique_selling_points, competitor_differentiation')
    .eq('account_id', accountId)
    .maybeSingle();

  return data as BrandProfile | null;
}

// ── Scraping ────────────────────────────────────────────────────────────────

interface StorefrontData {
  title: string;
  meta_description: string;
  headlines: string[];
  body_text: string;
  social_links: { instagram?: string; facebook?: string; twitter?: string };
  instagram_bio?: string;
}

async function scrapeStorefront(shopDomain: string): Promise<StorefrontData | null> {
  // Try the public domain (may differ from myshopify domain)
  const urls = [
    `https://${shopDomain}`,
    `https://${shopDomain.replace('.myshopify.com', '.com')}`,
  ];

  for (const url of urls) {
    try {
      const resp = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SillagesBot/1.0)' },
        maxRedirects: 3,
      });

      const html = resp.data as string;
      return parseStorefrontHtml(html);
    } catch {
      continue;
    }
  }

  // Try fetching the shop's primary domain via API redirect
  try {
    const resp = await axios.get(`https://${shopDomain}`, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SillagesBot/1.0)' },
      maxRedirects: 5,
    });
    return parseStorefrontHtml(resp.data as string);
  } catch {
    console.log(`${LOG} Could not scrape storefront for ${shopDomain}`);
    return null;
  }
}

function parseStorefrontHtml(html: string): StorefrontData {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? '';

  // Extract meta description
  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const meta_description = metaMatch?.[1]?.trim() ?? '';

  // Extract headlines (h1, h2, h3)
  const headlineRegex = /<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi;
  const headlines: string[] = [];
  let m;
  while ((m = headlineRegex.exec(html)) !== null && headlines.length < 10) {
    const text = stripHtml(m[1]).trim();
    if (text.length > 3 && text.length < 200) headlines.push(text);
  }

  // Extract body text (first 2000 chars of visible text)
  const body_text = stripHtml(html)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

  // Find social links
  const social_links: StorefrontData['social_links'] = {};
  const igMatch = html.match(/href=["'](https?:\/\/(www\.)?instagram\.com\/[^"']+)["']/i);
  if (igMatch) social_links.instagram = igMatch[1];
  const fbMatch = html.match(/href=["'](https?:\/\/(www\.)?facebook\.com\/[^"']+)["']/i);
  if (fbMatch) social_links.facebook = fbMatch[1];
  const twMatch = html.match(/href=["'](https?:\/\/(www\.)?twitter\.com\/[^"']+)["']/i);
  if (twMatch) social_links.twitter = twMatch[1];

  return { title, meta_description, headlines, body_text, social_links };
}

// ── OpenAI brand profile generation ─────────────────────────────────────────

async function generateBrandProfile(rawData: Record<string, unknown>, storeName: string): Promise<BrandProfile> {
  console.log(`${LOG} Generating brand profile with OpenAI...`);

  const systemPrompt = `You are a brand strategist who can instantly understand a brand's identity from its website, products, and content. You analyze stores to create a BRAND PROFILE that captures their unique voice, values, and personality.

Your analysis must be SPECIFIC to THIS store — never generic. Read every product name, description, price, tag, and storefront text to understand:
- What kind of store is this? (bakery, fashion, tech, beauty, etc.)
- What's their price range? (luxury, premium, mid-range, affordable)
- What's their vibe? (artisanal, modern, minimalist, fun, elegant, rustic, etc.)
- Who are their customers? (age, lifestyle, values, location)
- What makes them DIFFERENT from competitors?

Be extremely specific. Don't say "quality products" — say what KIND of quality (handmade, organic, locally sourced, etc.).
Don't say "diverse audience" — describe the SPECIFIC person who buys from this store.

Return ONLY valid JSON. No preamble.`;

  const userPrompt = `Analyze this store and create a brand profile.

STORE: ${storeName}

RAW DATA:
${JSON.stringify(rawData, null, 2)}

Return this JSON:
{
  "brand_voice": "<How this brand talks. Specific adjectives, examples of phrases they'd use, what they'd NEVER say. 2-3 sentences.>",
  "brand_values": "<What this brand stands for. Specific values derived from their products, descriptions, and content. Not generic — tied to THEIR actual products.>",
  "brand_emotion": "<What emotion does this brand want customers to feel? Be specific: not just 'happy' but 'the warmth of something made just for you, like your grandmother's kitchen but elevated'>",
  "content_style": "<How their content should look and read. Photo style, text length, emoji usage, hashtag style, tone of captions. Based on what they currently do.>",
  "target_audience": "<WHO buys from this store. Age range, location, lifestyle, what they value, why they choose THIS store over alternatives. Be specific.>",
  "unique_selling_points": "<3-5 specific things that make THIS store unique. Based on their actual products, not generic claims.>",
  "competitor_differentiation": "<What this store is NOT. How they differ from the obvious alternatives in their category. Name 2-3 specific competitors or competitor types (e.g., 'industrial bakeries like Panaria', 'supermarket gluten-free brands like Schär') and explain HOW this store is better for its target audience. Include what the competitors do that THIS store would NEVER do.>"
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error(`${LOG} OpenAI returned empty content`);

  const profile = JSON.parse(content) as BrandProfile;
  const tokens = completion.usage?.total_tokens ?? 0;
  console.log(`${LOG} Brand profile generated — ${tokens} tokens`);

  return profile;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPriceRange(variants: Array<{ price: string }> | undefined): string {
  if (!variants || variants.length === 0) return 'unknown';
  const prices = variants.map(v => parseFloat(v.price)).filter(p => !isNaN(p));
  if (prices.length === 0) return 'unknown';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `${min.toFixed(2)}` : `${min.toFixed(2)}-${max.toFixed(2)}`;
}
