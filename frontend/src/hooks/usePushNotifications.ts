import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

type PushState = 'unsupported' | 'prompt' | 'subscribed' | 'denied' | 'loading';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('loading');
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }

    // Fetch VAPID key and check current permission
    (async () => {
      try {
        const { data } = await api.get('/api/push/vapid-key');
        const key = data.publicKey;
        if (!key) { setState('unsupported'); return; }
        setVapidKey(key);

        const perm = Notification.permission;
        if (perm === 'denied') { setState('denied'); return; }

        // Check if already subscribed
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? 'subscribed' : 'prompt');
      } catch {
        setState('unsupported');
      }
    })();
  }, []);

  const subscribe = useCallback(async () => {
    if (!vapidKey) return false;
    setState('loading');

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('denied');
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
      });

      const json = sub.toJSON();
      await api.post('/api/push/subscribe', {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      });

      setState('subscribed');
      return true;
    } catch (err) {
      console.error('[push] Subscribe failed:', err);
      setState('prompt');
      return false;
    }
  }, [vapidKey]);

  const unsubscribe = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();

      await api.delete('/api/push/unsubscribe');
      setState('prompt');
      return true;
    } catch (err) {
      console.error('[push] Unsubscribe failed:', err);
      return false;
    }
  }, []);

  return { state, subscribe, unsubscribe };
}
