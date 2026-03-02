import { useParams, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { Navbar } from '../components/layout/Navbar';
import { Spinner } from '../components/ui/Spinner';
import { SectionYesterday } from '../components/brief/SectionYesterday';
import { SectionWhatsWorking } from '../components/brief/SectionWhatsWorking';
import { SectionWhatsNotWorking } from '../components/brief/SectionWhatsNotWorking';
import { SectionSignal } from '../components/brief/SectionSignal';
import { SectionGap } from '../components/brief/SectionGap';
import { SectionActivation } from '../components/brief/SectionActivation';
import { useBrief } from '../hooks/useBriefs';

export default function BriefDetail() {
  const { id } = useParams<{ id: string }>();
  const { brief, loading, error } = useBrief(id);

  return (
    <div className="min-h-screen bg-[#F7F1EC]">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 pt-20 pb-24">

        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-[#7A6B63] hover:text-[#3A2332] text-xs font-medium uppercase tracking-widest transition-colors mb-10"
        >
          <ArrowLeft size={12} />
          All briefs
        </Link>

        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 p-5 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && brief && (
          <>
            <header className="mb-10 pb-10 border-b border-[#E8DDD6]">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] mb-3">
                Intelligence Brief
              </p>
              <h1 className="text-[#3A2332] text-3xl font-semibold tracking-tight">
                {format(parseISO(brief.brief_date), 'EEEE, MMMM d')}
              </h1>
              <p className="text-[#7A6B63] text-sm mt-2">
                {format(parseISO(brief.brief_date), 'yyyy')}
              </p>
            </header>

            <div className="flex flex-col gap-10">
              {brief.section_yesterday && (
                <SectionYesterday data={brief.section_yesterday} />
              )}
              {brief.section_whats_working && (
                <SectionWhatsWorking data={brief.section_whats_working} />
              )}
              {brief.section_whats_not_working && (
                <SectionWhatsNotWorking data={brief.section_whats_not_working} />
              )}
              {brief.section_signal && (
                <SectionSignal data={brief.section_signal} />
              )}
              {brief.section_gap && (
                <SectionGap data={brief.section_gap} />
              )}
              {brief.section_activation && (
                <SectionActivation data={brief.section_activation} />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
