// ── Agent communication schema ──────────────────────────────────────────────
// Data flows: Shopify → [Analyst] → AnalystOutput → [GrowthHacker] → GrowthHackerOutput

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
  customer_patterns: {
    total_buyers: number;
    repeat_buyers: number;
    new_buyers: number;
    returning_rate: number;
    inactive_customers: Array<{
      name: string;
      email: string;
      last_purchase: string;
      days_since: number;
    }>;
  };
  weekly_patterns: Array<{
    day_of_week: string;
    avg_revenue: number;
    avg_orders: number;
    best_product: string;
  }>;
  trends: {
    revenue_vs_last_week: number; // percentage change
    orders_vs_last_week: number;
    growing_products: string[];
    declining_products: string[];
  };
  seo_audit: {
    products_without_description: Array<{ name: string; handle: string }>;
    products_without_meta_description: Array<{ name: string; handle: string }>;
    products_without_image_alt: Array<{ name: string; handle: string; image_url: string }>;
    collections_without_description: Array<{ name: string; handle: string }>;
    short_descriptions: Array<{ name: string; handle: string; current_length: number }>;
  };
  upcoming: {
    best_day_this_week: {
      day: string;
      expected_revenue: number;
      recommended_product: string;
    };
    customers_due_for_repurchase: Array<{
      name: string;
      email: string;
      usual_cycle_days: number;
      days_since_last: number;
    }>;
  };
  signals: string[]; // key observations in bullet points
}

// ── Growth Actions ──────────────────────────────────────────────────────────

export interface GrowthAction {
  type: 'instagram_post' | 'discount_code' | 'email_campaign' | 'product_highlight' | 'seo_fix' | 'whatsapp_message';
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
    email_subject?: string;
    email_body?: string;
    email_recipients?: string[];
    seo_field?: string; // 'meta_description', 'alt_text', 'collection_description'
    seo_product_handle?: string;
    seo_new_value?: string;
    template?: string; // 'story_product', 'post_square', 'email_promo'
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
