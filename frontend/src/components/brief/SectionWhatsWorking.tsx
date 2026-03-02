import type { SectionWhatsWorking as SectionWhatsWorkingType } from '../../types';

interface Props {
  data: SectionWhatsWorkingType;
}

export function SectionWhatsWorking({ data }: Props) {
  return (
    <section>
      <h2 className="section-label">What's Working</h2>
      <div className="flex flex-col divide-y divide-[#E8DDD6] border border-[#E8DDD6] bg-white">
        {data.items.map((item, i) => (
          <div key={i} className="px-6 py-5 flex items-start gap-4">
            {/* Green indicator bar */}
            <div className="flex-shrink-0 w-0.5 self-stretch bg-emerald-400 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-3 flex-wrap mb-1.5">
                <span className="font-semibold text-[#3A2332] text-sm tracking-tight">{item.title}</span>
                <span className="text-emerald-600 text-xs font-semibold tabular-nums uppercase tracking-wide">
                  {item.metric}
                </span>
              </div>
              <p className="text-sm text-[#7A6B63] leading-relaxed">{item.insight}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
