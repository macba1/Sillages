import { useEffect, useState } from 'react';
import api from '../lib/api';
import { supabase } from '../lib/supabase';
import type { ShopifyConnection } from '../types';

export function useShopifyConnection() {
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      console.log('[useShopifyConnection] session at fetch time — userId:', data.session?.user?.id ?? 'NO SESSION');
    });
    api
      .get<{ connection: ShopifyConnection | null }>('/api/shopify/connection')
      .then(({ data }) => {
        console.log('[useShopifyConnection] response:', data.connection);
        setConnection(data.connection);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function disconnect() {
    await api.delete('/api/shopify/disconnect');
    setConnection(null);
  }

  return { connection, loading, error, disconnect };
}
