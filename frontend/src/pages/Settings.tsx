import { useNavigate } from 'react-router-dom';
import { Navbar } from '../components/layout/Navbar';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { useShopifyConnection } from '../hooks/useShopify';
import { CheckCircle, Store } from 'lucide-react';

export default function Settings() {
  const { connection, loading, disconnect } = useShopifyConnection();
  const navigate = useNavigate();

  async function handleDisconnect() {
    if (!confirm('Disconnect your Shopify store? This will stop brief generation.')) return;
    await disconnect();
    navigate('/onboarding');
  }

  return (
    <div className="min-h-screen bg-[#F7F1EC]">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 pt-24 pb-16">

        <div className="mb-10 pb-10 border-b border-[#E8DDD6]">
          <h1 className="text-[#3A2332] text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-[#7A6B63] text-sm mt-1">Manage your store connection and preferences.</p>
        </div>

        {/* Shopify Connection — prominent card */}
        <section className="mb-6">
          <h2 className="section-label">Shopify Connection</h2>

          {loading ? (
            <div className="border border-[#E8DDD6] bg-white px-6 py-8 flex justify-center">
              <Spinner size="sm" />
            </div>
          ) : connection ? (
            /* Connected state */
            <div className="border border-[#E8DDD6] bg-white">
              <div className="px-6 py-5 border-b border-[#E8DDD6] flex items-center gap-3">
                <CheckCircle size={16} className="text-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[#3A2332] font-semibold text-sm tracking-tight">
                    {connection.shop_name ?? connection.shop_domain}
                  </p>
                  <p className="text-[#7A6B63] text-xs mt-0.5">{connection.shop_domain}</p>
                </div>
                <span className="text-xs font-semibold uppercase tracking-widest text-emerald-600 border border-emerald-200 bg-emerald-50 px-2 py-0.5">
                  Active
                </span>
              </div>
              <div className="px-6 py-4 flex items-center justify-between">
                <p className="text-xs text-[#7A6B63]">
                  Briefs are generated nightly from your store's data.
                </p>
                <Button variant="danger" size="sm" onClick={handleDisconnect}>
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            /* Not connected state — prominent connect card */
            <div className="border border-[#E8DDD6] bg-white">
              <div className="px-6 py-6 border-b border-[#E8DDD6]">
                <div className="flex items-center gap-3 mb-3">
                  <Store size={16} className="text-[#7A6B63]" />
                  <p className="text-[#3A2332] font-semibold text-sm tracking-tight">
                    No store connected
                  </p>
                </div>
                <p className="text-[#7A6B63] text-sm leading-relaxed">
                  Connect your Shopify store to start receiving daily intelligence briefs.
                </p>
              </div>
              <div className="px-6 py-4">
                <Button onClick={() => navigate('/onboarding')} className="w-full">
                  Connect Shopify store
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Brief Preferences */}
        <section>
          <h2 className="section-label">Brief Preferences</h2>
          <div className="border border-[#E8DDD6] bg-white px-6 py-5">
            <p className="text-sm text-[#7A6B63]">
              Delivery time, format options, and channel preferences — coming soon.
            </p>
          </div>
        </section>

      </main>
    </div>
  );
}
