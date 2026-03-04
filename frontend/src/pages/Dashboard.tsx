import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Navbar } from '../components/layout/Navbar';
import { BriefCard } from '../components/brief/BriefCard';
import { Spinner } from '../components/ui/Spinner';
import { useBriefs } from '../hooks/useBriefs';
import { useAccount } from '../hooks/useAccount';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { account } = useAccount();
  const { briefs, loading, error, refetch } = useBriefs(account?.id);
  const firstName = account?.full_name?.split(' ')[0];

  const [searchParams] = useSearchParams();
  const justConnected = searchParams.get('connected') === 'true';

  // Poll every 5s while we're waiting for the first brief to generate
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!justConnected || loading || briefs.length > 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => { void refetch(); }, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [justConnected, loading, briefs.length, refetch]);

  const isGenerating = justConnected && !loading && briefs.length === 0;

  return (
    <div className="min-h-screen bg-[#F7F1EC]">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 pt-24 pb-20">

        {/* Greeting */}
        <div className="mb-12">
          <h1 className="text-[#3A2332] text-4xl font-semibold tracking-tight leading-tight">
            {firstName ? `${getGreeting()}, ${firstName}.` : `${getGreeting()}.`}
          </h1>
          <p className="text-[#7A6B63] text-sm mt-2">
            Your store's intelligence, delivered daily.
          </p>
        </div>

        {/* Initial load */}
        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-100 p-5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Generating state — just connected, brief not ready yet */}
        {!loading && !error && isGenerating && (
          <div className="border border-[#E8DDD6] bg-white p-10 flex flex-col items-center gap-4 text-center">
            <Spinner size="lg" />
            <p className="text-[#3A2332] font-medium text-sm">Generating your first brief...</p>
            <p className="text-[#7A6B63] text-sm leading-relaxed max-w-xs">
              We're pulling your store data right now. This usually takes under a minute.
            </p>
          </div>
        )}

        {/* Empty state — no brief and not actively generating */}
        {!loading && !error && briefs.length === 0 && !isGenerating && (
          <div className="border border-[#E8DDD6] bg-white p-10">
            <p className="text-[#3A2332] font-medium text-sm mb-1">No briefs yet</p>
            <p className="text-[#7A6B63] text-sm leading-relaxed">
              Your first brief will arrive tomorrow morning, once your store data is ready.
            </p>
            <p className="text-xs text-[#7A6B63] mt-4">
              Make sure your Shopify store is connected in{' '}
              <a href="/settings" className="underline underline-offset-2 hover:text-[#3A2332] transition-colors">
                Settings
              </a>
              .
            </p>
          </div>
        )}

        {/* Brief list */}
        {!loading && briefs.length > 0 && (
          <>
            <div className="flex flex-col divide-y divide-[#E8DDD6] border border-[#E8DDD6] bg-white">
              {briefs.map((brief) => (
                <BriefCard key={brief.id} brief={brief} />
              ))}
            </div>

            {/* Tony's first-day note — shown only when exactly 1 brief exists */}
            {briefs.length === 1 && (
              <div className="mt-6 border border-[#E8DDD6] bg-[#F7F1EC] px-8 py-7">
                <p className="text-[#3A2332] text-sm leading-relaxed">
                  Your first brief is ready. Tonight I'll pull today's data from your store and
                  have tomorrow's brief waiting for you by 6am. I'll be looking at your orders,
                  what's moving, what's not, and where the opportunity is.
                </p>
                <p className="text-[#7A6B63] text-sm mt-4">— Tony</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
