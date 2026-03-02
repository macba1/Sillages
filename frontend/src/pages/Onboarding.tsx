import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const connected = searchParams.get('connected') === 'true';
  const shopName = searchParams.get('shop');

  const [shop, setShop] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connected) {
      const t = setTimeout(() => navigate('/dashboard'), 3000);
      return () => clearTimeout(t);
    }
  }, [connected, navigate]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let domain = shop.trim().toLowerCase();
    if (!domain.endsWith('.myshopify.com')) {
      domain = `${domain}.myshopify.com`;
    }

    setLoading(true);
    try {
      window.location.href = `${import.meta.env.VITE_API_URL}/shopify/auth?shop=${encodeURIComponent(domain)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  }

  if (connected) {
    return (
      <div className="min-h-screen bg-[#F7F1EC] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-12 h-12 border border-emerald-200 bg-emerald-50 flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={22} className="text-emerald-500" />
          </div>
          <h1 className="text-[#3A2332] font-semibold text-xl tracking-tight mb-2">
            {shopName ? `${shopName} connected` : 'Store connected'}
          </h1>
          <p className="text-[#7A6B63] text-sm">
            Taking you to your dashboard…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F1EC] flex flex-col items-center justify-center px-4">
      <span className="text-[#3A2332] font-semibold text-base tracking-tight mb-10">sillages</span>

      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-[#3A2332] font-semibold text-xl tracking-tight mb-1">
            Connect your store
          </h1>
          <p className="text-[#7A6B63] text-sm">
            You'll be redirected to Shopify to approve read-only access.
          </p>
        </div>

        {/* Shopify connect card */}
        <div className="border border-[#E8DDD6] bg-white mb-4">
          <div className="px-6 py-5 border-b border-[#E8DDD6]">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-4">
              Your Shopify domain
            </p>
            <form onSubmit={handleConnect} className="flex flex-col gap-4">
              <div className="flex items-center border border-[#E8DDD6] overflow-hidden focus-within:border-[#D8B07A] focus-within:ring-2 focus-within:ring-[#D8B07A]/20 transition-all">
                <input
                  type="text"
                  required
                  value={shop}
                  onChange={(e) => setShop(e.target.value)}
                  className="flex-1 px-3 py-2.5 text-sm bg-white text-[#3A2332] outline-none placeholder-[#7A6B63]/50"
                  placeholder="your-store"
                />
                <span className="px-3 py-2.5 text-sm text-[#7A6B63] bg-[#F7F1EC] border-l border-[#E8DDD6] whitespace-nowrap">
                  .myshopify.com
                </span>
              </div>

              {error && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-100 px-3 py-2.5">
                  {error}
                </p>
              )}

              <Button type="submit" loading={loading} className="w-full">
                Connect store
              </Button>
            </form>
          </div>
          <div className="px-6 py-3">
            <p className="text-xs text-[#7A6B63]">
              Read-only access. We never modify your store data.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
