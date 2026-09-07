/**
 * In-memory Shopify GraphQL Admin API double.
 *
 * Implements only the operations `services/catalog/catalogFetch.ts` issues, with
 * real cursor pagination, so the sync code under test drains pages exactly as it
 * would against Shopify. No network, no credentials.
 */

export interface FakeVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  availableForSale: boolean;
  inventoryQuantity: number;
  inventoryItemId: string;
  imageId: string | null;
}

export interface FakeImage {
  id: string;
  url: string;
  altText: string | null;
}

export interface FakeProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  updatedAt: string;
  images: FakeImage[];
  variants: FakeVariant[];
}

export interface FakeCollection {
  id: string;
  title: string;
  handle: string;
  updatedAt: string;
  productIds: string[];
}

const PRODUCT_PAGE = 50;
const NESTED_PAGE = 100;
const COLLECTION_PAGE = 100;
const COLLECTION_PRODUCTS_PAGE = 250;

export class FakeShopifyShop {
  products = new Map<string, FakeProduct>();
  collections = new Map<string, FakeCollection>();
  /** Every GraphQL operation name this shop has served, in order. */
  calls: string[] = [];

  addProduct(product: FakeProduct): void {
    this.products.set(product.id, product);
  }

  addCollection(collection: FakeCollection): void {
    this.collections.set(collection.id, collection);
  }

  removeProduct(id: string): void {
    this.products.delete(id);
    for (const collection of this.collections.values()) {
      collection.productIds = collection.productIds.filter((pid) => pid !== id);
    }
  }

  /** Drop-in replacement for the axios instance the catalog client would build. */
  get transport() {
    return {
      post: async (_url: string, body: { query: string; variables: Record<string, unknown> }) => ({
        data: this.execute(body.query, body.variables ?? {}),
      }),
    } as never;
  }

  private execute(query: string, variables: Record<string, unknown>) {
    const op = operationName(query);
    this.calls.push(op);

    switch (op) {
      case 'CatalogProducts':
        return this.listProducts(variables);
      case 'CatalogProduct':
        return this.oneProduct(variables);
      case 'CatalogProductImages':
        return this.productImagesPage(variables);
      case 'CatalogProductVariants':
        return this.productVariantsPage(variables);
      case 'CatalogCollections':
        return this.listCollections(variables);
      case 'CatalogCollectionProducts':
        return this.collectionProducts(variables);
      default:
        return { errors: [{ message: `FakeShopifyShop: unsupported operation ${op}` }] };
    }
  }

  // ── Operations ────────────────────────────────────────────

  private listProducts(vars: Record<string, unknown>) {
    const sorted = [...this.products.values()].sort(byId);
    const { slice, pageInfo } = paginate(sorted, vars.after as string | null, (vars.first as number) ?? PRODUCT_PAGE);
    return { data: { products: { pageInfo, nodes: slice.map((p) => this.productNode(p)) } } };
  }

  private oneProduct(vars: Record<string, unknown>) {
    const product = this.products.get(vars.id as string);
    return { data: { product: product ? this.productNode(product) : null } };
  }

  private productImagesPage(vars: Record<string, unknown>) {
    const product = this.products.get(vars.id as string);
    if (!product) return { data: { product: null } };
    const { slice, pageInfo } = paginate(product.images, vars.after as string | null, (vars.first as number) ?? NESTED_PAGE);
    return { data: { product: { images: { pageInfo, nodes: slice.map(imageNode) } } } };
  }

  private productVariantsPage(vars: Record<string, unknown>) {
    const product = this.products.get(vars.id as string);
    if (!product) return { data: { product: null } };
    const { slice, pageInfo } = paginate(product.variants, vars.after as string | null, (vars.first as number) ?? NESTED_PAGE);
    return { data: { product: { variants: { pageInfo, nodes: slice.map(variantNode) } } } };
  }

  private listCollections(vars: Record<string, unknown>) {
    const sorted = [...this.collections.values()].sort(byId);
    const { slice, pageInfo } = paginate(sorted, vars.after as string | null, (vars.first as number) ?? COLLECTION_PAGE);
    return {
      data: {
        collections: {
          pageInfo,
          nodes: slice.map((c) => ({
            id: c.id,
            title: c.title,
            handle: c.handle,
            description: null,
            sortOrder: 'MANUAL',
            updatedAt: c.updatedAt,
            image: null,
            productsCount: { count: c.productIds.length },
          })),
        },
      },
    };
  }

  private collectionProducts(vars: Record<string, unknown>) {
    const collection = this.collections.get(vars.id as string);
    if (!collection) return { data: { collection: null } };
    const { slice, pageInfo } = paginate(
      collection.productIds,
      vars.after as string | null,
      (vars.first as number) ?? COLLECTION_PRODUCTS_PAGE,
    );
    return { data: { collection: { products: { pageInfo, nodes: slice.map((id) => ({ id })) } } } };
  }

  private productNode(product: FakeProduct) {
    const imagePage = paginate(product.images, null, NESTED_PAGE);
    const variantPage = paginate(product.variants, null, NESTED_PAGE);
    return {
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      productType: 'Fragrance',
      vendor: 'Sillages Dev',
      tags: ['dev'],
      description: `${product.title} description`,
      onlineStoreUrl: `https://dev-store.example/products/${product.handle}`,
      totalInventory: product.variants.reduce((sum, v) => sum + v.inventoryQuantity, 0),
      updatedAt: product.updatedAt,
      featuredMedia: { preview: { image: { url: product.images[0]?.url ?? null } } },
      images: { pageInfo: imagePage.pageInfo, nodes: imagePage.slice.map(imageNode) },
      variants: { pageInfo: variantPage.pageInfo, nodes: variantPage.slice.map(variantNode) },
    };
  }
}

function imageNode(image: FakeImage) {
  return { id: image.id, url: image.url, altText: image.altText, width: 1200, height: 1200 };
}

function variantNode(variant: FakeVariant) {
  return {
    id: variant.id,
    title: variant.title,
    sku: variant.sku,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    availableForSale: variant.availableForSale,
    inventoryQuantity: variant.inventoryQuantity,
    inventoryPolicy: 'DENY',
    inventoryItem: { id: variant.inventoryItemId },
    selectedOptions: [{ name: 'Size', value: variant.title }],
    image: variant.imageId ? { id: variant.imageId } : null,
  };
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id, 'en');
}

/** Cursor is simply the index of the last item returned. */
function paginate<T>(items: T[], after: string | null, first: number) {
  const start = after ? Number(after.replace('cursor:', '')) + 1 : 0;
  const end = Math.min(start + first, items.length);
  const slice = items.slice(start, end);
  return {
    slice,
    pageInfo: {
      hasNextPage: end < items.length,
      endCursor: end > start ? `cursor:${end - 1}` : null,
    },
  };
}

function operationName(query: string): string {
  const match = query.match(/(?:query|mutation)\s+(\w+)/);
  return match ? match[1] : 'unknown';
}

// ── Fixture builders ────────────────────────────────────────

export function makeProduct(index: number, options: { variants?: number; images?: number; title?: string } = {}): FakeProduct {
  const variantCount = options.variants ?? 2;
  const imageCount = options.images ?? 2;
  // Zero-padded so lexicographic order matches numeric order.
  const id = `gid://shopify/Product/${String(index).padStart(6, '0')}`;

  const images: FakeImage[] = Array.from({ length: imageCount }, (_, i) => ({
    id: `gid://shopify/ProductImage/${String(index).padStart(6, '0')}-${i}`,
    url: `https://cdn.example/dev/${index}-${i}.jpg`,
    altText: null,
  }));

  const variants: FakeVariant[] = Array.from({ length: variantCount }, (_, i) => ({
    id: `gid://shopify/ProductVariant/${String(index).padStart(6, '0')}-${i}`,
    title: `Size ${i + 1}`,
    sku: `DEV-${index}-${i}`,
    price: `${(20 + i).toFixed(2)}`,
    compareAtPrice: null,
    availableForSale: true,
    inventoryQuantity: 10 + i,
    inventoryItemId: `gid://shopify/InventoryItem/${String(index).padStart(6, '0')}-${i}`,
    imageId: images[0]?.id ?? null,
  }));

  return {
    id,
    title: options.title ?? `Dev product ${index}`,
    handle: `dev-product-${index}`,
    status: 'ACTIVE',
    updatedAt: '2026-09-01T10:00:00Z',
    images,
    variants,
  };
}

/** A development store with `count` products, big enough to force pagination. */
export function makeDevStore(count: number): FakeShopifyShop {
  const shop = new FakeShopifyShop();
  for (let i = 1; i <= count; i += 1) {
    shop.addProduct(makeProduct(i));
  }
  return shop;
}
