import { supabase } from '../../lib/supabase.js';
import type { ShopContext } from '../catalog/catalogStore.js';
import {
  type GalleryConfig,
  type GallerySettings,
  type GalleryStatus,
  type PublicImage,
  type PublicPost,
  type PublicStory,
  type PublicVariant,
  numericShopifyId,
} from './galleryTypes.js';

/**
 * Reads and writes gallery configuration, and the catalogue rows the storefront
 * payload is composed from.
 *
 * Every query is filtered by `connection_id`, which is how one shop is kept from
 * ever seeing another shop's gallery or products.
 */

export interface GalleryStore {
  getByConnection(connectionId: string): Promise<GalleryConfig | null>;
  getPublishedByShopDomain(shopDomain: string): Promise<{ config: GalleryConfig; connectionId: string } | null>;
  upsertSettings(ctx: ShopContext, settings: GallerySettings): Promise<GalleryConfig>;
  setStatus(configId: string, status: GalleryStatus, version?: number): Promise<GalleryConfig | null>;
  saveVersion(config: GalleryConfig): Promise<void>;
  listVersions(configId: string): Promise<{ version: number; snapshot: GallerySettings; publishedAt: string }[]>;
  getVersion(configId: string, version: number): Promise<GallerySettings | null>;
  /** Live posts for a gallery, newest catalogue data first. */
  loadPosts(connectionId: string, collectionId: string | null, limit: number): Promise<PublicPost[]>;
  loadStories(connectionId: string, limit: number): Promise<PublicStory[]>;
}

interface ConfigRow {
  id: string;
  account_id: string;
  connection_id: string;
  collection_id: string | null;
  style: string;
  show_stories: boolean;
  show_quick_buy: boolean;
  posts_limit: number;
  heading: string | null;
  status: string;
  version: number;
  published_at: string | null;
  disabled_at: string | null;
}

function toConfig(row: ConfigRow): GalleryConfig {
  return {
    id: row.id,
    accountId: row.account_id,
    connectionId: row.connection_id,
    collectionId: row.collection_id,
    style: row.style as GalleryConfig['style'],
    showStories: row.show_stories,
    showQuickBuy: row.show_quick_buy,
    postsLimit: row.posts_limit,
    heading: row.heading,
    status: row.status as GalleryStatus,
    version: row.version,
    publishedAt: row.published_at,
    disabledAt: row.disabled_at,
  };
}

function toSettings(config: GalleryConfig): GallerySettings {
  return {
    collectionId: config.collectionId,
    style: config.style,
    showStories: config.showStories,
    showQuickBuy: config.showQuickBuy,
    postsLimit: config.postsLimit,
    heading: config.heading,
  };
}

export const supabaseGalleryStore: GalleryStore = {
  async getByConnection(connectionId: string): Promise<GalleryConfig | null> {
    const { data, error } = await supabase
      .from('gallery_configs')
      .select('*')
      .eq('connection_id', connectionId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return toConfig(data as ConfigRow);
  },

  async getPublishedByShopDomain(shopDomain: string) {
    const { data: connection } = await supabase
      .from('shopify_connections')
      .select('id')
      .eq('shop_domain', shopDomain)
      .maybeSingle();

    if (!connection) return null;

    const { data, error } = await supabase
      .from('gallery_configs')
      .select('*')
      .eq('connection_id', connection.id as string)
      .eq('status', 'published')
      .maybeSingle();

    if (error || !data) return null;
    return { config: toConfig(data as ConfigRow), connectionId: connection.id as string };
  },

  async upsertSettings(ctx: ShopContext, settings: GallerySettings): Promise<GalleryConfig> {
    const existing = await this.getByConnection(ctx.connectionId);

    const payload = {
      account_id: ctx.accountId,
      connection_id: ctx.connectionId,
      collection_id: settings.collectionId,
      style: settings.style,
      show_stories: settings.showStories,
      show_quick_buy: settings.showQuickBuy,
      posts_limit: settings.postsLimit,
      heading: settings.heading,
    };

    const query = existing
      ? supabase.from('gallery_configs').update(payload).eq('id', existing.id)
      : supabase.from('gallery_configs').insert(payload);

    const { data, error } = await query.select('*').single();
    if (error) throw new Error(`saving the gallery failed: ${error.message}`);
    return toConfig(data as ConfigRow);
  },

  async setStatus(configId: string, status: GalleryStatus, version?: number): Promise<GalleryConfig | null> {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status };
    if (status === 'published') {
      patch.published_at = now;
      patch.disabled_at = null;
      if (version !== undefined) patch.version = version;
    }
    if (status === 'disabled') patch.disabled_at = now;

    const { data, error } = await supabase
      .from('gallery_configs')
      .update(patch)
      .eq('id', configId)
      .select('*')
      .maybeSingle();

    if (error || !data) return null;
    return toConfig(data as ConfigRow);
  },

  async saveVersion(config: GalleryConfig): Promise<void> {
    const { error } = await supabase.from('gallery_config_versions').upsert(
      {
        gallery_config_id: config.id,
        connection_id: config.connectionId,
        version: config.version,
        snapshot: toSettings(config),
        published_at: new Date().toISOString(),
      },
      { onConflict: 'gallery_config_id,version' },
    );
    if (error) throw new Error(`saving the gallery version failed: ${error.message}`);
  },

  async listVersions(configId: string) {
    const { data, error } = await supabase
      .from('gallery_config_versions')
      .select('version, snapshot, published_at')
      .eq('gallery_config_id', configId)
      .order('version', { ascending: false })
      .limit(20);

    if (error || !data) return [];
    return data.map((row) => ({
      version: row.version as number,
      snapshot: row.snapshot as GallerySettings,
      publishedAt: row.published_at as string,
    }));
  },

  async getVersion(configId: string, version: number): Promise<GallerySettings | null> {
    const { data, error } = await supabase
      .from('gallery_config_versions')
      .select('snapshot')
      .eq('gallery_config_id', configId)
      .eq('version', version)
      .maybeSingle();

    if (error || !data) return null;
    return data.snapshot as GallerySettings;
  },

  async loadPosts(connectionId: string, collectionId: string | null, limit: number): Promise<PublicPost[]> {
    // Restricting to one collection means resolving its membership first.
    let productIds: string[] | null = null;
    if (collectionId) {
      const { data: links } = await supabase
        .from('catalog_collection_products')
        .select('product_id, position')
        .eq('collection_id', collectionId)
        .order('position', { ascending: true })
        .limit(limit);
      productIds = (links ?? []).map((row) => row.product_id as string);
      if (productIds.length === 0) return [];
    }

    let query = supabase
      .from('catalog_products')
      .select('id, shopify_id, handle, title, featured_image_url, status')
      .eq('connection_id', connectionId)
      .is('deleted_at', null)
      .limit(limit);

    if (productIds) query = query.in('id', productIds);

    const { data: products, error } = await query;
    if (error || !products || products.length === 0) return [];

    const ids = products.map((p) => p.id as string);

    const [{ data: variants }, { data: images }] = await Promise.all([
      supabase
        .from('catalog_variants')
        .select('product_id, shopify_id, title, price, compare_at_price, available_for_sale, position, selected_options')
        .in('product_id', ids)
        .is('deleted_at', null)
        .order('position', { ascending: true }),
      supabase
        .from('catalog_product_images')
        .select('product_id, url, alt_text, width, height, position')
        .in('product_id', ids)
        .is('deleted_at', null)
        .order('position', { ascending: true }),
    ]);

    const variantsByProduct = groupBy(variants ?? [], (row) => row.product_id as string);
    const imagesByProduct = groupBy(images ?? [], (row) => row.product_id as string);

    // Preserve collection order when one was given.
    const ordered = productIds
      ? productIds.map((id) => products.find((p) => p.id === id)).filter(Boolean)
      : products;

    return (ordered as typeof products).map((product) =>
      composePost(product, variantsByProduct.get(product.id as string) ?? [], imagesByProduct.get(product.id as string) ?? []),
    );
  },

  async loadStories(connectionId: string, limit: number): Promise<PublicStory[]> {
    const { data, error } = await supabase
      .from('catalog_collections')
      .select('shopify_id, title, handle, image_url')
      .eq('connection_id', connectionId)
      .is('deleted_at', null)
      .order('title', { ascending: true })
      .limit(limit);

    if (error || !data) return [];

    return data
      .map((row) => {
        const id = numericShopifyId(row.shopify_id as string);
        if (id === null) return null;
        return {
          id,
          title: row.title as string,
          handle: row.handle as string,
          url: `/collections/${row.handle as string}`,
          imageUrl: (row.image_url as string | null) ?? null,
        };
      })
      .filter((story): story is PublicStory => story !== null);
  },
};

// ── Composition helpers (pure, shared with the tests) ───────────────────────

type Row = Record<string, unknown>;

function groupBy<T extends Row>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export function composePost(product: Row, variantRows: Row[], imageRows: Row[]): PublicPost {
  const variants: PublicVariant[] = variantRows
    .map((row) => {
      const id = numericShopifyId(row.shopify_id as string);
      if (id === null) return null;
      return {
        id,
        title: (row.title as string) ?? '',
        price: formatMoney(row.price),
        compareAtPrice: row.compare_at_price === null || row.compare_at_price === undefined
          ? null
          : formatMoney(row.compare_at_price),
        available: Boolean(row.available_for_sale),
        options: Array.isArray(row.selected_options) ? (row.selected_options as PublicVariant['options']) : [],
      };
    })
    .filter((variant): variant is PublicVariant => variant !== null);

  const images: PublicImage[] = imageRows.map((row) => ({
    url: row.url as string,
    altText: (row.alt_text as string | null) ?? null,
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
  }));

  const prices = variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n));
  const featured = (product.featured_image_url as string | null) ?? null;

  return {
    id: numericShopifyId(product.shopify_id as string) ?? 0,
    handle: product.handle as string,
    title: product.title as string,
    url: `/products/${product.handle as string}`,
    image: images[0] ?? (featured ? { url: featured, altText: null, width: null, height: null } : null),
    images,
    priceMin: prices.length ? Math.min(...prices).toFixed(2) : null,
    priceMax: prices.length ? Math.max(...prices).toFixed(2) : null,
    available: variants.some((v) => v.available),
    variants,
  };
}

function formatMoney(value: unknown): string {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}
