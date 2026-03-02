import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import type { IntelligenceBrief } from '../../types';

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('en-US', opts).format(n);
}

interface Props {
  brief: IntelligenceBrief;
}

export function BriefCard({ brief }: Props) {
  const isReady = brief.status === 'ready' || brief.status === 'sent';
  const d = brief.section_yesterday;

  return (
    <Link to={`/briefs/${brief.id}`} className="group block px-6 py-5 hover:bg-[#F7F1EC] transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">

          {/* Badge + date row */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] border border-[#D8B07A]/30 px-2 py-0.5">
              Intelligence Brief
            </span>
            {brief.status === 'generating' && (
              <span className="text-xs text-[#7A6B63]">Generating…</span>
            )}
          </div>

          {/* Headline date */}
          <p className="text-[#3A2332] font-semibold text-base tracking-tight mb-2">
            {format(parseISO(brief.brief_date), 'EEEE, MMMM d')}
          </p>

          {isReady && d ? (
            <>
              {/* 2-line preview */}
              <p className="text-sm text-[#7A6B63] leading-relaxed mb-4 line-clamp-2">
                {d.summary}
              </p>

              {/* Quick stats */}
              <div className="flex items-center gap-6 flex-wrap">
                <div>
                  <span className="text-xs text-[#7A6B63] block mb-0.5">Revenue</span>
                  <span className="text-sm font-semibold text-[#3A2332] tabular-nums">
                    {fmt(d.revenue, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7A6B63] block mb-0.5">Orders</span>
                  <span className="text-sm font-semibold text-[#3A2332] tabular-nums">
                    {fmt(d.orders)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7A6B63] block mb-0.5">Conversion</span>
                  <span className="text-sm font-semibold text-[#3A2332] tabular-nums">
                    {(d.conversion_rate * 100).toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* CTA */}
              <p className="text-xs font-medium text-[#D8B07A] mt-4 group-hover:underline underline-offset-2">
                Read brief →
              </p>
            </>
          ) : (
            <p className="text-sm text-[#7A6B63]">Brief not yet available</p>
          )}
        </div>

        <ArrowRight
          size={15}
          className="flex-shrink-0 mt-1 text-[#E8DDD6] group-hover:text-[#D8B07A] transition-colors"
        />
      </div>
    </Link>
  );
}
