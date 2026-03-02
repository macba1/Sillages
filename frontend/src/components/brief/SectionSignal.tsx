import type { SectionSignal as SectionSignalType } from '../../types';

interface Props {
  data: SectionSignalType;
}

export function SectionSignal({ data }: Props) {
  return (
    <section>
      <h2 className="section-label">The Signal</h2>
      <div className="bg-[#1A1A2E] border border-[#1A1A2E]">
        {/* Gold headline */}
        <div className="px-7 pt-7 pb-5 border-b border-white/10">
          <p className="text-[#D8B07A] font-semibold text-lg leading-snug tracking-tight">
            {data.headline}
          </p>
        </div>

        {/* Market context */}
        <div className="px-7 py-5 border-b border-white/10">
          <span className="text-xs font-semibold uppercase tracking-widest text-white/30 block mb-3">
            Market context
          </span>
          <p className="text-white/70 text-sm leading-relaxed">{data.market_context}</p>
        </div>

        {/* Store implication */}
        <div className="px-7 py-5 pb-7">
          <span className="text-xs font-semibold uppercase tracking-widest text-white/30 block mb-3">
            For your store
          </span>
          <p className="text-white text-sm leading-relaxed">{data.store_implication}</p>
        </div>
      </div>
    </section>
  );
}
