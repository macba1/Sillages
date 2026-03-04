import axios from 'axios';
import { supabase } from './supabase';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
});

// Attach Supabase JWT to every request
api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const userId = data.session?.user?.id;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.url?.includes('/shopify/connection')) {
    console.log('[api] /shopify/connection request — userId:', userId ?? 'NO SESSION', '| token:', token ? `${token.slice(0, 20)}...` : 'MISSING');
  }
  return config;
});

export default api;
