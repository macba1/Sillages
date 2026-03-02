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
  const { briefs, loading, error } = useBriefs(account?.id);
  const firstName = account?.full_name?.split(' ')[0];

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

        {/* Loading */}
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

        {/* Empty state */}
        {!loading && !error && briefs.length === 0 && (
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
          <div className="flex flex-col divide-y divide-[#E8DDD6] border border-[#E8DDD6] bg-white">
            {briefs.map((brief) => (
              <BriefCard key={brief.id} brief={brief} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
