import { Clock } from 'lucide-react';
import type { SectionActivation as SectionActivationType } from '../../types';

interface Props {
  data: SectionActivationType;
}

export function SectionActivation({ data }: Props) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63]">Today's Activation</h2>
        <div className="flex items-center gap-1.5 text-[#7A6B63] text-xs font-medium">
          <Clock size={12} />
          <span>~30 min</span>
        </div>
      </div>

      <div className="border border-[#E8DDD6] overflow-hidden">

        {/* WHAT */}
        <div className="px-6 py-5 bg-white border-b border-[#E8DDD6]">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] block mb-2">
            What
          </span>
          <p className="text-[#3A2332] font-semibold text-base leading-snug tracking-tight">
            {data.what}
          </p>
        </div>

        {/* WHY */}
        <div className="px-6 py-5 bg-[#F7F1EC] border-b border-[#E8DDD6]">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] block mb-2">
            Why
          </span>
          <p className="text-[#3A2332] text-sm leading-relaxed">{data.why}</p>
        </div>

        {/* HOW */}
        <div className="px-6 py-5 bg-white border-b border-[#E8DDD6]">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] block mb-4">
            How
          </span>
          <ol className="flex flex-col gap-3">
            {data.how.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-5 h-5 border border-[#D8B07A] text-[#3A2332] text-xs font-semibold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm text-[#7A6B63] leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* EXPECTED IMPACT */}
        <div className="px-6 py-5 bg-[#1A1A2E]">
          <span className="text-xs font-semibold uppercase tracking-widest text-white/30 block mb-2">
            Expected Impact
          </span>
          <p className="text-[#D8B07A] font-semibold text-sm leading-relaxed">
            {data.expected_impact}
          </p>
        </div>

      </div>
    </section>
  );
}
