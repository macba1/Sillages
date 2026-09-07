import type { CatalogClient, GraphQLPageInfo } from '../../lib/shopifyCatalog.js';
import type { CatalogCollection, CatalogImage, CatalogProduct, CatalogVariant } from './catalogTypes.js';

/**
 * Paginated readers over the Shopify GraphQL Admin API.
 *
 * Every connection is drained to `hasNextPage === false`: products, the images
 * and variants nested inside each product, collections, and the products inside
 * each collection. Nothing here stops at the first page.
 */

const PRODUCT_PAGE = 50;      // products per page (each carries nested connections)
const NESTED_PAGE = 100;      // images/variants per product page
const COLLECTION_PAGE = 100;
const COLLECTION_PRODUCTS_PAGE = 250;

const PRODUCT_FIELDS = `
  id
  title
  handle
  status
  productType
  vendor
  tags
  description
  onlineStoreUrl
  totalInventory
  updatedAt
  featuredMedia { preview { image { url } } }
  images(first: ${NESTED_PAGE}) {
    pageInfo { hasNextPage endCursor }
    nodes { id url altText width height }
  }
  variants(first: ${NESTED_PAGE}) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      sku
      price
      compareAtPrice
      availableForSale
      inventoryQuantity
      inventoryPolicy
      inventoryItem { id }
      selectedOptions { name value }
      image { id }
    }
  }
`;

const PRODUCTS_QUERY = `
  query CatalogProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes { ${PRODUCT_FIELDS} }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = `
  query CatalogProduct($id: ID!) {
    product(id: $id) { ${PRODUCT_FIELDS} }
  }
`;

const PRODUCT_IMAGES_PAGE_QUERY = `
  query CatalogProductImages($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      images(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id url altText width height }
      }
    }
  }
`;

const PRODUCT_VARIANTS_PAGE_QUERY = `
  query CatalogProductVariants($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      variants(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id title sku price compareAtPrice availableForSale
          inventoryQuantity inventoryPolicy
          inventoryItem { id }
          selectedOptions { name value }
          image { id }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = `
  query CatalogCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle description sortOrder updatedAt
        image { url }
        productsCount { count }
      }
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `
  query CatalogCollectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  }
`;

// ── Raw GraphQL shapes ──────────────────────────────────────────────────────

interface RawImage { id: string; url: string; altText: string | null; width: number | null; height: number | null }
interface RawVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  inventoryPolicy: string | null;
  inventoryItem: { id: string } | null;
  selectedOptions: { name: string; value: string }[];
  image: { id: string } | null;
}
interface RawProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  productType: string | null;
  vendor: string | null;
  tags: string[] | null;
  description: string | null;
  onlineStoreUrl: string | null;
  totalInventory: number | null;
  updatedAt: string | null;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  images: { pageInfo: GraphQLPageInfo; nodes: RawImage[] };
  variants: { pageInfo: GraphQLPageInfo; nodes: RawVariant[] };
}
interface RawCollection {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  sortOrder: string | null;
  updatedAt: string | null;
  image: { url: string } | null;
  productsCount: { count: number } | null;
}

// ── Mappers ─────────────────────────────────────────────────────────────────

function toImage(raw: RawImage, position: number): CatalogImage {
  return {
    shopifyId: raw.id,
    url: raw.url,
    altText: raw.altText ?? null,
    width: raw.width ?? null,
    height: raw.height ?? null,
    position,
  };
}

function toVariant(raw: RawVariant, position: number): CatalogVariant {
  return {
    shopifyId: raw.id,
    inventoryItemId: raw.inventoryItem?.id ?? null,
    title: raw.title,
    sku: raw.sku ?? null,
    price: raw.price,
    compareAtPrice: raw.compareAtPrice ?? null,
    currencyCode: null,
    availableForSale: raw.availableForSale,
    inventoryQuantity: raw.inventoryQuantity ?? null,
    inventoryPolicy: raw.inventoryPolicy ?? null,
    position,
    selectedOptions: raw.selectedOptions ?? [],
    imageShopifyId: raw.image?.id ?? null,
  };
}

async function toProduct(client: CatalogClient, raw: RawProduct): Promise<CatalogProduct> {
  const images = [...raw.images.nodes];
  const variants = [...raw.variants.nodes];

  // A product with more nested rows than one page still has to arrive complete.
  let imagePage = raw.images.pageInfo;
  while (imagePage.hasNextPage) {
    const data = await client.request<{ product: { images: { pageInfo: GraphQLPageInfo; nodes: RawImage[] } } | null }>(
      PRODUCT_IMAGES_PAGE_QUERY,
      { id: raw.id, first: NESTED_PAGE, after: imagePage.endCursor },
    );
    if (!data.product) break;
    images.push(...data.product.images.nodes);
    imagePage = data.product.images.pageInfo;
  }

  let variantPage = raw.variants.pageInfo;
  while (variantPage.hasNextPage) {
    const data = await client.request<{ product: { variants: { pageInfo: GraphQLPageInfo; nodes: RawVariant[] } } | null }>(
      PRODUCT_VARIANTS_PAGE_QUERY,
      { id: raw.id, first: NESTED_PAGE, after: variantPage.endCursor },
    );
    if (!data.product) break;
    variants.push(...data.product.variants.nodes);
    variantPage = data.product.variants.pageInfo;
  }

  return {
    shopifyId: raw.id,
    title: raw.title,
    handle: raw.handle,
    status: raw.status,
    productType: raw.productType ?? null,
    vendor: raw.vendor ?? null,
    tags: raw.tags ?? [],
    description: raw.description ?? null,
    onlineStoreUrl: raw.onlineStoreUrl ?? null,
    featuredImageUrl: raw.featuredMedia?.preview?.image?.url ?? images[0]?.url ?? null,
    totalInventory: raw.totalInventory ?? null,
    shopifyUpdatedAt: raw.updatedAt ?? null,
    images: images.map(toImage),
    variants: variants.map(toVariant),
  };
}

function toCollection(raw: RawCollection): CatalogCollection {
  return {
    shopifyId: raw.id,
    title: raw.title,
    handle: raw.handle,
    description: raw.description ?? null,
    imageUrl: raw.image?.url ?? null,
    sortOrder: raw.sortOrder ?? null,
    productsCount: raw.productsCount?.count ?? null,
    shopifyUpdatedAt: raw.updatedAt ?? null,
  };
}

// ── Public readers ──────────────────────────────────────────────────────────

/** Yields every product in the shop, page by page, with nested pages drained. */
export async function* iterateProducts(client: CatalogClient): AsyncGenerator<CatalogProduct> {
  let after: string | null = null;

  for (;;) {
    const data: { products: { pageInfo: GraphQLPageInfo; nodes: RawProduct[] } } = await client.request(
      PRODUCTS_QUERY,
      { first: PRODUCT_PAGE, after },
    );

    for (const raw of data.products.nodes) {
      yield await toProduct(client, raw);
    }

    if (!data.products.pageInfo.hasNextPage) return;
    after = data.products.pageInfo.endCursor;
    if (!after) return;
  }
}

/** Fetches one product by Shopify GID. Returns null when it no longer exists. */
export async function fetchProduct(client: CatalogClient, shopifyId: string): Promise<CatalogProduct | null> {
  const data = await client.request<{ product: RawProduct | null }>(PRODUCT_BY_ID_QUERY, { id: shopifyId });
  return data.product ? toProduct(client, data.product) : null;
}

/** Yields every collection in the shop. */
export async function* iterateCollections(client: CatalogClient): AsyncGenerator<CatalogCollection> {
  let after: string | null = null;

  for (;;) {
    const data: { collections: { pageInfo: GraphQLPageInfo; nodes: RawCollection[] } } = await client.request(
      COLLECTIONS_QUERY,
      { first: COLLECTION_PAGE, after },
    );

    for (const raw of data.collections.nodes) {
      yield toCollection(raw);
    }

    if (!data.collections.pageInfo.hasNextPage) return;
    after = data.collections.pageInfo.endCursor;
    if (!after) return;
  }
}

/** Every product GID that belongs to a collection, across all pages. */
export async function fetchCollectionProductIds(client: CatalogClient, collectionId: string): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;

  for (;;) {
    const data: { collection: { products: { pageInfo: GraphQLPageInfo; nodes: { id: string }[] } } | null } =
      await client.request(COLLECTION_PRODUCTS_QUERY, {
        id: collectionId,
        first: COLLECTION_PRODUCTS_PAGE,
        after,
      });

    if (!data.collection) return ids;
    ids.push(...data.collection.products.nodes.map((n) => n.id));

    if (!data.collection.products.pageInfo.hasNextPage) return ids;
    after = data.collection.products.pageInfo.endCursor;
    if (!after) return ids;
  }
}
