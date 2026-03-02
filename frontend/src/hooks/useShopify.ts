import { useEffect, useState } from 'react';
import api from '../lib/api';
import type { ShopifyConnection } from '../types';

export function useShopifyConnection() {
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ connection: ShopifyConnection | null }>('/shopify/connection')
      .then(({ data }) => setConnection(data.connection))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function disconnect() {
    await api.delete('/shopify/disconnect');
    setConnection(null);
  }

  return { connection, loading, error, disconnect };
}
