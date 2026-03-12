import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

export interface PendingAction {
  id: string;
  account_id: string;
  brief_id: string | null;
  type: string;
  title: string;
  description: string;
  content: Record<string, unknown>;
  status: 'pending' | 'approved' | 'completed' | 'rejected' | 'failed';
  created_at: string;
  approved_at: string | null;
  executed_at: string | null;
  result: Record<string, unknown> | null;
}

interface ActionsResponse {
  actions: PendingAction[];
  plan: 'starter' | 'growth' | 'pro';
}

interface StatsResponse {
  pending: number;
  approved: number;
  completed: number;
  rejected: number;
}

export function useActions(accountId: string | undefined) {
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [history, setHistory] = useState<PendingAction[]>([]);
  const [plan, setPlan] = useState<string>('starter');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActions = useCallback(async () => {
    if (!accountId) return;
    try {
      setLoading(true);
      setError(null);
      const [pendingRes, historyRes] = await Promise.all([
        api.get<ActionsResponse>('/api/actions?status=pending'),
        api.get<ActionsResponse>('/api/actions?status=completed'),
      ]);
      setActions(pendingRes.data.actions);
      setPlan(pendingRes.data.plan);

      // Also fetch rejected for history
      const rejectedRes = await api.get<ActionsResponse>('/api/actions?status=rejected');
      const allHistory = [...historyRes.data.actions, ...rejectedRes.data.actions]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10);
      setHistory(allHistory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load actions');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const approve = async (actionId: string) => {
    const res = await api.put(`/api/actions/${actionId}/approve`);
    await fetchActions();
    return res.data;
  };

  const reject = async (actionId: string) => {
    await api.put(`/api/actions/${actionId}/reject`);
    await fetchActions();
  };

  const editAction = async (actionId: string, content: Record<string, unknown>) => {
    await api.put(`/api/actions/${actionId}`, { content });
    await fetchActions();
  };

  return { actions, history, plan, loading, error, approve, reject, editAction, refetch: fetchActions };
}

export function useActionStats(accountId: string | undefined) {
  const [stats, setStats] = useState<StatsResponse>({ pending: 0, approved: 0, completed: 0, rejected: 0 });

  useEffect(() => {
    if (!accountId) return;
    api.get<StatsResponse>('/api/actions/stats')
      .then(res => setStats(res.data))
      .catch(() => {});
  }, [accountId]);

  return stats;
}
