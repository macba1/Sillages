import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { Account } from '../types';

export function useAccount() {
  const { user } = useAuth();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setAccount(null);
      setLoading(false);
      return;
    }

    supabase
      .from('accounts')
      .select('*')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        setAccount(data as Account | null);
        setLoading(false);
      });
  }, [user]);

  return { account, loading };
}
