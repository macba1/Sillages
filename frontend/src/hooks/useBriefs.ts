import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { IntelligenceBrief } from '../types';

export function useBriefs(accountId: string | undefined) {
  const [briefs, setBriefs] = useState<IntelligenceBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBriefs = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('intelligence_briefs')
      .select('*')
      .eq('account_id', accountId)
      .in('status', ['ready', 'sent'])
      .order('brief_date', { ascending: false })
      .limit(30);

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setBriefs((data as IntelligenceBrief[]) ?? []);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    fetchBriefs();
  }, [fetchBriefs]);

  return { briefs, loading, error, refetch: fetchBriefs };
}

export function useBrief(briefId: string | undefined) {
  const [brief, setBrief] = useState<IntelligenceBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!briefId) return;

    supabase
      .from('intelligence_briefs')
      .select('*')
      .eq('id', briefId)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(fetchError.message);
        else setBrief(data as IntelligenceBrief);
        setLoading(false);
      });
  }, [briefId]);

  return { brief, loading, error };
}
