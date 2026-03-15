// ── Agent communication schema ──────────────────────────────────────────────
// Data flows: Shopify → [Analyst] → AnalystOutput → [GrowthHacker] → GrowthHackerOutput

import type { CustomerIntelligence } from '../services/customerIntelligence.js';

// ── Analyst Output ──────────────────────────────────────────────────────────

export interface AnalystOutput {
  period: {
    date: string;
    revenue: number;
    orders: number;
    avg_order: number;
    currency: string;
  };
  top_products: Array<{
    name: string;
    units: number;
    revenue: number;
  }>;

  // ── 1. Conversion Analysis ─────────────────────────────────────────────
  conversion: {
    abandoned_carts: number;
    cart_abandonment_rate: number; // 0-1
    products_viewed_not_purchased: Array<{ name: string; views_or_carts: number }>;
    avg_order_value: number;
    checkout_completion_rate: number; // 0-1
  };

  // ── 2. Merchandising Analysis ──────────────────────────────────────────
  merchandising: {
    high_value_products: Array<{ name: string; revenue_per_unit: number; units: number }>;
    volume_products: Array<{ name: string; units: number; revenue: number }>;
    position_mismatch: Array<{ name: string; issue: string }>;
    dead_products: Array<{ name: string; days_without_sale: number }>;
    collection_performance: Array<{ name: string; products: number; has_description: boolean }>;
  };

  // ── 3. Retention Analysis ──────────────────────────────────────────────
  retention: {
    repeat_rate: number; // 0-1
    new_customer_count: number;
    overdue_customers: Array<{
      name: string;
      email: string;
      last_purchase: string;
      days_since: number;
      usual_cycle_days: number;
      total_spent: number;
    }>;
    vip_customers: Array<{ name: string; email: string; purchases: number; total_spent: number }>;
    customer_segments: {
      vip: number;     // 4+ purchases
      regular: number; // 2-3 purchases
      one_time: number; // 1 purchase
    };
  };

  // ── 4. SEO Analysis ───────────────────────────────────────────────────
  seo: {
    missing_meta: Array<{ name: string; handle: string }>;
    missing_alt: Array<{ name: string; handle: string; image_url: string }>;
    short_descriptions: Array<{ name: string; handle: string; current_length: number }>;
    missing_collection_desc: Array<{ name: string; handle: string }>;
  };

  // ── 5. Acquisition Analysis ───────────────────────────────────────────
  acquisition: {
    new_customer_trend: 'growing' | 'stable' | 'declining' | 'insufficient_data';
    first_purchase_products: Array<{ name: string; count: number }>;
    entry_price_point: number; // avg first-order value
  };

  // ── Patterns & Opportunities ──────────────────────────────────────────
  weekly_patterns: Array<{
    day_of_week: string;
    avg_revenue: number;
    avg_orders: number;
    best_product: string;
  }>;
  calendar_opportunities: Array<{
    event: string;
    date: string;
    days_until: number;
    relevance: string;
  }>;
  trends: {
    revenue_vs_last_week: number; // percentage change
    orders_vs_last_week: number;
    growing_products: string[];
    declining_products: string[];
  };

  // ── Actions History (for the loop) ────────────────────────────────────
  actions_history: Array<{
    action_id: string;
    type: string;
    title: string;
    status: string;
    executed_at: string | null;
    measured_impact: {
      times_used?: number;
      revenue_generated?: number;
      sales_change?: string;
      note?: string;
    } | null;
  }>;

  signals: string[]; // key observations in bullet points

  // ── Customer Intelligence (from Shopify API, not LLM-generated) ─────
  customer_intelligence?: CustomerIntelligence;
}

// ── Growth Actions ──────────────────────────────────────────────────────────

export interface GrowthAction {
  type: 'instagram_post' | 'discount_code' | 'email_campaign' | 'product_highlight' | 'seo_fix' | 'whatsapp_message' | 'cart_recovery' | 'welcome_email' | 'reactivation_email';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  time_estimate: string; // "5 min", "15 min"
  content: {
    copy?: string;
    image_product_id?: string;
    image_url?: string;
    discount_code?: string;
    discount_percentage?: number;
    discount_product?: string;
    discount_value?: string;
    discount_type?: 'percentage' | 'fixed_amount';
    email_subject?: string;
    email_body?: string;
    email_recipients?: string[];
    seo_field?: string; // 'meta_description', 'alt_text', 'collection_description'
    seo_product_handle?: string;
    seo_new_value?: string;
    meta_description?: string;
    alt_text?: string;
    template?: string; // 'story_product', 'post_square', 'email_promo'
    product?: string;
    visual_concept?: string;
    hashtags?: string;
    // cart_recovery fields
    customer_email?: string;
    customer_name?: string;
    products?: Array<{ title: string; quantity: number; price: number }>;
    checkout_url?: string;
    // welcome_email fields
    product_purchased?: string;
    // reactivation_email fields
    recipients?: Array<{ email: string; name: string; last_product: string; days_since: number }>;
  };
  plan_required: 'growth' | 'pro';
}

// ── Growth Hacker Output ────────────────────────────────────────────────────

export interface GrowthHackerOutput {
  brief_narrative: {
    greeting: string;
    yesterday_summary: string;
    whats_working: string;
    whats_not_working: string;
    signal: string;
    upcoming: string;
    gap: string;
  };
  actions: GrowthAction[];
}

// ── Quality Auditor Output ──────────────────────────────────────────────────

export interface QualityAuditOutput {
  brief_narrative: GrowthHackerOutput['brief_narrative'];
  actions: GrowthAction[];
  audit_passed: boolean;
  audit_notes: string[];
}
