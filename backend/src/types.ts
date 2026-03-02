// ── Database row types (mirror supabase/schema.sql) ─────────────────────────

export interface Account {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
  trial_ends_at: string | null;
  subscription_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserIntelligenceConfig {
  id: string;
  account_id: string;
  timezone: string;
  send_hour: number;
  send_enabled: boolean;
  focus_areas: string[];
  brief_tone: 'direct' | 'analytical' | 'motivational';
  store_context: string | null;
  competitor_context: string | null;
  include_market_signal: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShopifyConnection {
  id: string;
  account_id: string;
  shop_domain: string;
  shop_name: string | null;
  shop_email: string | null;
  shop_currency: string;
  shop_timezone: string | null;
  access_token: string;
  scopes: string;
  token_expires_at: string | null;
  last_synced_at: string | null;
  sync_status: 'pending' | 'active' | 'error' | 'disconnected';
  sync_error: string | null;
  webhook_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopProduct {
  product_id: string;
  title: string;
  quantity_sold: number;
  revenue: number;
  variant_breakdown?: { variant_id: string; title: string; quantity: number }[];
}

export interface ShopifyDailySnapshot {
  id: string;
  account_id: string;
  snapshot_date: string; // YYYY-MM-DD
  total_revenue: number;
  net_revenue: number;
  total_orders: number;
  average_order_value: number;
  sessions: number;
  conversion_rate: number;
  returning_customer_rate: number;
  new_customers: number;
  returning_customers: number;
  total_customers: number;
  top_products: TopProduct[];
  total_refunds: number;
  cancelled_orders: number;
  ad_spend: number | null;
  roas: number | null;
  raw_shopify_payload: Record<string, unknown> | null;
  created_at: string;
}

// ── Brief section types ──────────────────────────────────────────────────────

export interface SectionYesterday {
  revenue: number;
  orders: number;
  aov: number;
  sessions: number;
  conversion_rate: number;
  new_customers: number;
  top_product: string;
  summary: string;
}

export interface WorkingItem {
  title: string;
  metric: string;
  insight: string;
}

export interface SectionWhatsWorking {
  items: WorkingItem[];
}

export interface SectionWhatsNotWorking {
  items: WorkingItem[];
}

export interface SectionSignal {
  headline: string;
  market_context: string;
  store_implication: string;
}

export interface SectionGap {
  gap: string;
  opportunity: string;
  estimated_upside: string;
}

export interface SectionActivation {
  what: string;
  why: string;
  how: string[];
  expected_impact: string;
}

export interface IntelligenceBrief {
  id: string;
  account_id: string;
  snapshot_id: string | null;
  brief_date: string;
  status: 'pending' | 'generating' | 'ready' | 'failed' | 'sent';
  generated_at: string | null;
  sent_at: string | null;
  generation_error: string | null;
  section_yesterday: SectionYesterday | null;
  section_whats_working: SectionWhatsWorking | null;
  section_whats_not_working: SectionWhatsNotWorking | null;
  section_signal: SectionSignal | null;
  section_gap: SectionGap | null;
  section_activation: SectionActivation | null;
  model_used: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  email_message_id: string | null;
  created_at: string;
  updated_at: string;
}
