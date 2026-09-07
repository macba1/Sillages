import { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import { GalleryShell } from '../../components/layout/GalleryShell';

interface SyncCounts {
  productsSeen: number;
  productsUpserted: number;
  productsDeleted: number;
  variantsUpserted: number;
  collectionsSeen: number;
}

interface CatalogStatus {
  connected: boolean;
  shopDomain?: string;
  productCount: number;
  collectionCount: number;
  lastSync: {
    trigger: string;
    status: 'running' | 'completed' | 'failed';
    startedAt: string;
    finishedAt: string | null;
    counts: SyncCounts;
    error: string | null;
  } | null;
}

interface Collection {
  id: string;
  shopifyId: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  productsCount: number | null;
}

/**
 * Sprint 1 — the live catalogue.
 *
 * Shows what has actually been imported from Shopify and offers a manual
 * re-sync for diagnosis. Choosing a collection to turn into a gallery is
 * Sprint 3; this screen only proves the catalogue is real and current.
 */
export default function Collections() {
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [statusRes, collectionsRes] = await Promise.all([
        api.get<CatalogStatus>('/api/catalog/status'),
        api.get<{ collections: Collection[] }>('/api/catalog/collections'),
      ]);
      setStatus(statusRes.data);
      setCollections(collectionsRes.data.collections);
      setError(null);
    } catch {
      setError('Could not load your catalogue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      await api.post('/api/catalog/sync');
      await load();
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setError(
        status === 409
          ? 'A sync is already running. Give it a moment.'
          : 'The sync could not finish. Try again in a few minutes.',
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <GalleryShell>
      <div style={{ maxWidth: 860, padding: '48px 40px' }}>
        <p style={eyebrow}>Sillages · Social gallery</p>
        <h1 style={heading}>Collections</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: '#5C4B38', marginBottom: 24 }}>
          Your Shopify catalogue, kept in sync automatically. Nothing to upload and nothing to tag.
        </p>

        {loading && <p style={{ color: '#5C4B38', fontSize: 14 }}>Loading your catalogue…</p>}
        {error && <p style={{ color: '#8A2E2E', fontSize: 14, marginBottom: 16 }}>{error}</p>}

        {!loading && status && !status.connected && (
          <p style={{ color: '#5C4B38', fontSize: 14 }}>
            No Shopify store is connected yet. Connect one to import your catalogue.
          </p>
        )}

        {!loading && status?.connected && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <Stat label="Products" value={String(status.productCount)} />
              <Stat label="Collections" value={String(status.collectionCount)} />
              <Stat label="Last sync" value={describeSync(status.lastSync)} />
            </div>

            <button onClick={() => void handleSync()} disabled={syncing} style={syncButton(syncing)}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <p style={{ fontSize: 12, color: '#8A7A66', marginTop: 8, marginBottom: 28 }}>
              Changes in Shopify normally arrive on their own within a couple of minutes. Use this only to check.
            </p>

            {status.lastSync?.status === 'failed' && status.lastSync.error && (
              <p style={{ color: '#8A2E2E', fontSize: 13, marginBottom: 20 }}>
                Last sync failed: {status.lastSync.error}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {collections.length === 0 && (
                <p style={{ color: '#5C4B38', fontSize: 14 }}>No collections imported yet.</p>
              )}
              {collections.map((collection) => (
                <div key={collection.id} style={row}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#2A1F14' }}>{collection.title}</span>
                  <span style={{ fontSize: 13, color: '#5C4B38' }}>
                    {collection.productsCount ?? 0} products
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </GalleryShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid rgba(42,31,20,0.12)',
        borderRadius: 12,
        padding: '12px 16px',
        background: '#FFFDFA',
        minWidth: 130,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8A7A66' }}>
        {label}
      </div>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 18, fontWeight: 700, color: '#2A1F14' }}>
        {value}
      </div>
    </div>
  );
}

function describeSync(lastSync: CatalogStatus['lastSync']): string {
  if (!lastSync) return 'Never';
  if (lastSync.status === 'running') return 'In progress';
  if (lastSync.status === 'failed') return 'Failed';
  const when = lastSync.finishedAt ?? lastSync.startedAt;
  return new Date(when).toLocaleString();
}

const eyebrow: React.CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 10,
  letterSpacing: '0.28em',
  textTransform: 'uppercase',
  color: '#A89880',
  marginBottom: 10,
};

const heading: React.CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 30,
  fontWeight: 700,
  color: '#2A1F14',
  marginBottom: 12,
};

const row: React.CSSProperties = {
  border: '1px solid rgba(42,31,20,0.12)',
  borderRadius: 12,
  padding: '14px 18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  background: '#FFFDFA',
};

function syncButton(disabled: boolean): React.CSSProperties {
  return {
    padding: '10px 18px',
    borderRadius: 10,
    border: 'none',
    background: disabled ? 'rgba(201,150,74,0.4)' : '#C9964A',
    color: '#2A1F14',
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 600,
    fontSize: 14,
    cursor: disabled ? 'default' : 'pointer',
  };
}
