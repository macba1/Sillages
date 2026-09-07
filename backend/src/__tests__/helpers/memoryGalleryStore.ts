import type { ShopContext } from '../../services/catalog/catalogStore.js';
import type { GalleryStore } from '../../services/gallery/galleryStore.js';
import type {
  GalleryConfig,
  GallerySettings,
  GalleryStatus,
  PublicPost,
  PublicStory,
} from '../../services/gallery/galleryTypes.js';

/**
 * In-memory `GalleryStore` with a small catalogue attached, mirroring the SQL
 * semantics: one gallery per connection, one published gallery at a time, and
 * every read filtered by connection so shops stay isolated.
 */

interface SeedCollection {
  id: string;
  shopifyId: string;
  title: string;
  handle: string;
  productIds: string[];
}

interface SeedProduct {
  id: string;
  shopifyId: string;
  handle: string;
  title: string;
  imageUrl: string;
  variantId: string;
  status: string;
}

export class MemoryGalleryStore implements GalleryStore {
  private configs: GalleryConfig[] = [];
  private versions: { configId: string; version: number; snapshot: GallerySettings; publishedAt: string }[] = [];
  private shops = new Map<string, ShopContext>();
  private products = new Map<string, SeedProduct[]>();
  private collections = new Map<string, SeedCollection[]>();
  private seq = 0;

  seedShop(ctx: ShopContext, options: { products: number; collections: number }): void {
    this.shops.set(ctx.shopDomain, ctx);

    // Handles and image URLs are derived from the shop's own domain, the way a
    // real Shopify handle is. Deriving them from our internal connection id
    // would make the "no internal identifiers leak" assertion vacuous.
    const slug = ctx.shopDomain.split('.')[0];

    const products: SeedProduct[] = Array.from({ length: options.products }, (_, i) => ({
      id: `${ctx.connectionId}-p${i}`,
      shopifyId: `gid://shopify/Product/${1000 + i}`,
      handle: `${slug}-product-${i}`,
      title: `${slug} product ${i}`,
      imageUrl: `https://cdn.example/${slug}/${i}.jpg`,
      variantId: `gid://shopify/ProductVariant/${2000 + i}`,
      status: 'ACTIVE',
    }));
    this.products.set(ctx.connectionId, products);

    const collections: SeedCollection[] = Array.from({ length: options.collections }, (_, i) => ({
      id: `${ctx.connectionId}-c${i}`,
      shopifyId: `gid://shopify/Collection/${3000 + i}`,
      title: `Collection ${i}`,
      handle: `collection-${i}`,
      // The first collection holds a strict subset, so a collection-scoped
      // gallery is visibly smaller than the full catalogue.
      productIds: products.slice(0, Math.max(1, Math.floor(products.length / 2))).map((p) => p.id),
    }));
    this.collections.set(ctx.connectionId, collections);
  }

  /** Mirrors a product being unpublished or archived in Shopify. */
  setProductStatus(connectionId: string, index: number, status: string): void {
    const product = (this.products.get(connectionId) ?? [])[index];
    if (product) product.status = status;
  }

  collectionsFor(connectionId: string): SeedCollection[] {
    return this.collections.get(connectionId) ?? [];
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async getByConnection(connectionId: string): Promise<GalleryConfig | null> {
    return this.configs.find((c) => c.connectionId === connectionId) ?? null;
  }

  async getPublishedByShopDomain(shopDomain: string) {
    const ctx = this.shops.get(shopDomain);
    if (!ctx) return null;
    const config = this.configs.find((c) => c.connectionId === ctx.connectionId && c.status === 'published');
    return config ? { config, connectionId: ctx.connectionId } : null;
  }

  async upsertSettings(ctx: ShopContext, settings: GallerySettings): Promise<GalleryConfig> {
    const existing = this.configs.find((c) => c.connectionId === ctx.connectionId);
    if (existing) {
      Object.assign(existing, settings);
      return existing;
    }
    const created: GalleryConfig = {
      id: this.nextId('gallery'),
      accountId: ctx.accountId,
      connectionId: ctx.connectionId,
      status: 'draft',
      version: 0,
      publishedAt: null,
      disabledAt: null,
      ...settings,
    };
    this.configs.push(created);
    return created;
  }

  async setStatus(configId: string, status: GalleryStatus, version?: number): Promise<GalleryConfig | null> {
    const config = this.configs.find((c) => c.id === configId);
    if (!config) return null;
    config.status = status;
    if (status === 'published') {
      config.publishedAt = new Date().toISOString();
      config.disabledAt = null;
      if (version !== undefined) config.version = version;
    }
    if (status === 'disabled') config.disabledAt = new Date().toISOString();
    return config;
  }

  async saveVersion(config: GalleryConfig): Promise<void> {
    const snapshot: GallerySettings = {
      collectionId: config.collectionId,
      style: config.style,
      showStories: config.showStories,
      showQuickBuy: config.showQuickBuy,
      postsLimit: config.postsLimit,
      heading: config.heading,
    };
    const existing = this.versions.find((v) => v.configId === config.id && v.version === config.version);
    if (existing) existing.snapshot = snapshot;
    else this.versions.push({ configId: config.id, version: config.version, snapshot, publishedAt: new Date().toISOString() });
  }

  async listVersions(configId: string) {
    return this.versions
      .filter((v) => v.configId === configId)
      .sort((a, b) => b.version - a.version)
      .map((v) => ({ version: v.version, snapshot: v.snapshot, publishedAt: v.publishedAt }));
  }

  async getVersion(configId: string, version: number): Promise<GallerySettings | null> {
    return this.versions.find((v) => v.configId === configId && v.version === version)?.snapshot ?? null;
  }

  async loadPosts(connectionId: string, collectionId: string | null, limit: number): Promise<PublicPost[]> {
    // Mirrors the SQL: only products a shopper can actually buy.
    let products = (this.products.get(connectionId) ?? []).filter((p) => p.status === 'ACTIVE');
    if (collectionId) {
      const collection = (this.collections.get(connectionId) ?? []).find((c) => c.id === collectionId);
      if (!collection) return [];
      products = products.filter((p) => collection.productIds.includes(p.id));
    }

    return products.slice(0, limit).map((product, index) => ({
      id: 1000 + index,
      handle: product.handle,
      title: product.title,
      url: `/products/${product.handle}`,
      image: { url: product.imageUrl, altText: null, width: 1200, height: 1200 },
      images: [{ url: product.imageUrl, altText: null, width: 1200, height: 1200 }],
      priceMin: '20.00',
      priceMax: '24.00',
      available: true,
      variants: [
        { id: 2000 + index, title: 'Default', price: '20.00', compareAtPrice: null, available: true, options: [] },
      ],
    }));
  }

  async loadStories(connectionId: string, limit: number): Promise<PublicStory[]> {
    return (this.collections.get(connectionId) ?? []).slice(0, limit).map((collection, index) => ({
      id: 3000 + index,
      title: collection.title,
      handle: collection.handle,
      url: `/collections/${collection.handle}`,
      imageUrl: null,
    }));
  }
}
