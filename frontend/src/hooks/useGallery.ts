import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import type {
  CatalogStatus,
  Collection,
  GalleryConfig,
  GalleryPreview,
  GalleryVersion,
} from '../types/gallery';

/**
 * Everything the admin needs about the gallery, in one place.
 *
 * Errors are surfaced as readable sentences rather than swallowed: a merchant
 * has to be able to act on them without contacting support.
 */

function messageFor(err: unknown, fallback: string): string {
  const response = (err as { response?: { status?: number; data?: { error?: string } } }).response;
  if (response?.data?.error) return response.data.error;
  if (response?.status === 409) return 'A sync is already running. Give it a moment.';
  if (response?.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (response?.status === 502) return 'Shopify did not answer. Try again in a few minutes.';
  return fallback;
}

/** Whether the storefront has actually rendered the gallery since publishing. */
export interface StorefrontStatus {
  seen: boolean;
  lastSeenAt: string | null;
}

export interface GalleryState {
  loading: boolean;
  error: string | null;
  config: GalleryConfig | null;
  versions: GalleryVersion[];
  storefront: StorefrontStatus | null;
  collections: Collection[];
  catalog: CatalogStatus | null;
  preview: GalleryPreview | null;
  busy: boolean;
  reload: () => Promise<void>;
  save: (patch: Partial<GalleryConfig>) => Promise<boolean>;
  publish: () => Promise<boolean>;
  disable: () => Promise<boolean>;
  revert: (version: number) => Promise<boolean>;
  sync: () => Promise<boolean>;
  clearError: () => void;
}

export function useGallery(): GalleryState {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<GalleryConfig | null>(null);
  const [versions, setVersions] = useState<GalleryVersion[]>([]);
  const [storefront, setStorefront] = useState<StorefrontStatus | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [catalog, setCatalog] = useState<CatalogStatus | null>(null);
  const [preview, setPreview] = useState<GalleryPreview | null>(null);

  const reload = useCallback(async () => {
    try {
      const [galleryRes, collectionsRes, catalogRes, previewRes] = await Promise.all([
        api.get<{ gallery: GalleryConfig; versions: GalleryVersion[]; storefront: StorefrontStatus | null }>(
          '/api/gallery',
        ),
        api.get<{ collections: Collection[] }>('/api/catalog/collections'),
        api.get<CatalogStatus>('/api/catalog/status'),
        api.get<GalleryPreview>('/api/gallery/preview'),
      ]);
      setConfig(galleryRes.data.gallery);
      setVersions(galleryRes.data.versions);
      setStorefront(galleryRes.data.storefront ?? null);
      setCollections(collectionsRes.data.collections);
      setCatalog(catalogRes.data);
      setPreview(previewRes.data);
      setError(null);
    } catch (err) {
      setError(messageFor(err, 'We could not load your gallery. Reload the page to try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<unknown>, fallback: string) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await reload();
        return true;
      } catch (err) {
        setError(messageFor(err, fallback));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const save = useCallback(
    (patch: Partial<GalleryConfig>) =>
      run(() => api.put('/api/gallery', patch), 'We could not save that change.'),
    [run],
  );

  const publish = useCallback(
    () => run(() => api.post('/api/gallery/publish'), 'We could not publish your gallery.'),
    [run],
  );

  const disable = useCallback(
    () => run(() => api.post('/api/gallery/disable'), 'We could not turn the gallery off.'),
    [run],
  );

  const revert = useCallback(
    (version: number) =>
      run(() => api.post('/api/gallery/revert', { version }), 'We could not restore that version.'),
    [run],
  );

  const sync = useCallback(
    () => run(() => api.post('/api/catalog/sync'), 'The sync could not finish.'),
    [run],
  );

  return {
    loading,
    error,
    config,
    versions,
    storefront,
    collections,
    catalog,
    preview,
    busy,
    reload,
    save,
    publish,
    disable,
    revert,
    sync,
    clearError: () => setError(null),
  };
}

/** The four onboarding steps, and how far a merchant has got. */
export interface OnboardingProgress {
  catalogueReady: boolean;
  collectionChosen: boolean;
  stylePreviewed: boolean;
  published: boolean;
  currentStep: 1 | 2 | 3 | 4;
  complete: boolean;
}

export function onboardingProgress(
  catalog: CatalogStatus | null,
  config: GalleryConfig | null,
  preview: GalleryPreview | null,
): OnboardingProgress {
  const catalogueReady = Boolean(catalog?.connected && catalog.productCount > 0);
  // "All products" is a deliberate choice too, so a saved gallery counts.
  const collectionChosen = catalogueReady && Boolean(config);
  const stylePreviewed = collectionChosen && Boolean(preview && preview.posts.length > 0);
  const published = config?.status === 'published';

  const currentStep = !catalogueReady ? 1 : !stylePreviewed ? 2 : !published ? 3 : 4;

  return {
    catalogueReady,
    collectionChosen,
    stylePreviewed,
    published,
    currentStep: currentStep as 1 | 2 | 3 | 4,
    complete: published,
  };
}
