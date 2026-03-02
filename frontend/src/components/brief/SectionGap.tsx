import type { SectionGap as SectionGapType } from '../../types';

interface Props {
  data: SectionGapType;
}

export function SectionGap({ data }: Props) {
  return (
    <section>
      <h2 className="section-label">The Gap</h2>
      {/* Accent left border on the whole card */}
      <div className="border border-[#E8DDD6] border-l-4 border-l-[#D8B07A] bg-white">
        <div className="px-6 py-5 border-b border-[#E8DDD6]">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] block mb-2">
            Gap
          </span>
          <p className="text-[#3A2332] text-sm leading-relaxed">{data.gap}</p>
        </div>
        <div className="px-6 py-5 border-b border-[#E8DDD6]">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] block mb-2">
            Opportunity
          </span>
          <p className="text-[#3A2332] text-sm leading-relaxed">{data.opportunity}</p>
        </div>
        <div className="px-6 py-4 flex items-center gap-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63]">
            Estimated upside
          </span>
          <span className="text-[#3A2332] font-semibold text-sm">{data.estimated_upside}</span>
        </div>
      </div>
    </section>
  );
}
