/**
 * Normalised catalogue shapes.
 *
 * Everything the gallery needs is expressed here, decoupled from the exact
 * Shopify GraphQL response so a future API version bump touches only the
 * fetch layer.
 */

export interface CatalogImage {
  shopifyId: string;
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  position: number;
}

export interface CatalogVariant {
  shopifyId: string;
  /** Needed to map `inventory_levels/update` webhooks back to a variant. */
  inventoryItemId: string | null;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  currencyCode: string | null;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  inventoryPolicy: string | null;
  position: number;
  selectedOptions: { name: string; value: string }[];
  imageShopifyId: string | null;
}

export interface CatalogProduct {
  shopifyId: string;
  title: string;
  handle: string;
  status: string;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  description: string | null;
  onlineStoreUrl: string | null;
  featuredImageUrl: string | null;
  totalInventory: number | null;
  shopifyUpdatedAt: string | null;
  images: CatalogImage[];
  variants: CatalogVariant[];
}

export interface CatalogCollection {
  shopifyId: string;
  title: string;
  handle: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: string | null;
  productsCount: number | null;
  shopifyUpdatedAt: string | null;
}

export type SyncTrigger = 'install' | 'manual' | 'reconciliation' | 'webhook';

export type SyncStatus = 'running' | 'completed' | 'failed';

export interface SyncCounts {
  productsSeen: number;
  productsUpserted: number;
  productsDeleted: number;
  variantsUpserted: number;
  imagesUpserted: number;
  collectionsSeen: number;
  collectionsUpserted: number;
  collectionsDeleted: number;
  collectionLinksUpserted: number;
}

export function emptyCounts(): SyncCounts {
  return {
    productsSeen: 0,
    productsUpserted: 0,
    productsDeleted: 0,
    variantsUpserted: 0,
    imagesUpserted: 0,
    collectionsSeen: 0,
    collectionsUpserted: 0,
    collectionsDeleted: 0,
    collectionLinksUpserted: 0,
  };
}
