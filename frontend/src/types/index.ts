// ── Auth ─────────────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  subscription_status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
  trial_ends_at: string | null;
  language: 'en' | 'es';
}

// ── Brief sections ────────────────────────────────────────────────────────────

export interface SectionYesterdayWow {
  revenue_pct: number | null;
  orders_pct: number | null;
  aov_pct: number | null;
  conversion_pct: number | null;
  new_customers_pct: number | null;
}

export interface SectionYesterday {
  revenue: number;
  orders: number;
  aov: number;
  sessions: number;
  conversion_rate: number;
  new_customers: number;
  top_product: string;
  summary: string;
  wow: SectionYesterdayWow | null;
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

// ── Intelligence Brief ────────────────────────────────────────────────────────

export interface IntelligenceBrief {
  id: string;
  account_id: string;
  brief_date: string; // YYYY-MM-DD
  status: 'pending' | 'generating' | 'ready' | 'failed' | 'sent';
  generated_at: string | null;
  sent_at: string | null;
  section_yesterday: SectionYesterday | null;
  section_whats_working: SectionWhatsWorking | null;
  section_whats_not_working: SectionWhatsNotWorking | null;
  section_signal: SectionSignal | null;
  section_gap: SectionGap | null;
  section_activation: SectionActivation | null;
  created_at: string;
}

// ── Shopify ───────────────────────────────────────────────────────────────────

export interface ShopifyConnection {
  shop_domain: string;
  shop_name: string | null;
  shop_currency: string;
  sync_status: 'pending' | 'active' | 'error' | 'disconnected';
  last_synced_at: string | null;
}
