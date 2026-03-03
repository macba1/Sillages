import type { SectionYesterday as SectionYesterdayType } from '../../types';

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('en-US', opts).format(n);
}

function WowBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return null;
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium mt-1 block ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? '↑' : '↓'}{Math.abs(pct).toFixed(1)}% vs last week
    </span>
  );
}

function StatCell({ label, value, wow }: { label: string; value: string; wow?: number | null }) {
  return (
    <div className="px-6 py-5 bg-white">
      <span className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] block mb-2">
        {label}
      </span>
      <span className="text-2xl font-semibold text-[#3A2332] tabular-nums tracking-tight">
        {value}
      </span>
      <WowBadge pct={wow} />
    </div>
  );
}

interface Props {
  data: SectionYesterdayType;
}

export function SectionYesterday({ data }: Props) {
  return (
    <section>
      <h2 className="section-label">Yesterday</h2>

      {/* Summary */}
      <p className="text-[#3A2332] text-base leading-relaxed font-medium mb-4">
        {data.summary}
      </p>

      {/* Stat grid */}
      <div className="border border-[#E8DDD6] grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#E8DDD6] mb-4">
        <StatCell
          label="Revenue"
          value={fmt(data.revenue, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
          wow={data.wow?.revenue_pct}
        />
        <StatCell label="Orders" value={fmt(data.orders)} wow={data.wow?.orders_pct} />
        <StatCell
          label="Conversion"
          value={`${(data.conversion_rate * 100).toFixed(2)}%`}
          wow={data.wow?.conversion_pct}
        />
        <StatCell label="New customers" value={fmt(data.new_customers)} wow={data.wow?.new_customers_pct} />
      </div>

      {/* Secondary stats row */}
      <div className="border border-[#E8DDD6] grid grid-cols-2 gap-px bg-[#E8DDD6]">
        <StatCell
          label="AOV"
          value={fmt(data.aov, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
          wow={data.wow?.aov_pct}
        />
        <StatCell label="Sessions" value={fmt(data.sessions)} />
      </div>

      {data.top_product && (
        <div className="mt-3 border border-[#E8DDD6] bg-white px-6 py-4 flex items-center gap-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] whitespace-nowrap">
            Top product
          </span>
          <span className="text-sm font-medium text-[#3A2332]">{data.top_product}</span>
        </div>
      )}
    </section>
  );
}
