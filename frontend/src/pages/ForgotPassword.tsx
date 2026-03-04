import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://sillages.app/reset-password',
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F1EC] flex flex-col items-center justify-center px-4">
      <Link to="/" className="text-[#3A2332] font-semibold text-base tracking-tight mb-10">
        sillages
      </Link>

      <div className="w-full max-w-sm">
        {sent ? (
          <div className="bg-white border border-[#E8DDD6] p-8 text-center">
            <p className="text-[#3A2332] font-semibold text-base mb-2">Check your inbox</p>
            <p className="text-sm text-[#7A6B63] leading-relaxed">
              If <span className="font-medium text-[#3A2332]">{email}</span> is registered, you'll
              receive a reset link shortly.
            </p>
            <Link
              to="/login"
              className="block mt-6 text-sm text-[#7A6B63] hover:text-[#3A2332] transition-colors"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white border border-[#E8DDD6] p-8 flex flex-col gap-5">
            <div className="mb-1">
              <h1 className="text-[#3A2332] font-semibold text-lg tracking-tight">
                Reset your password
              </h1>
              <p className="text-sm text-[#7A6B63] mt-1">
                Enter your email and we'll send you a reset link.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#7A6B63] uppercase tracking-widest">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="jane@store.com"
              />
            </div>

            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-100 px-3 py-2.5">
                {error}
              </p>
            )}

            <Button type="submit" loading={loading} className="w-full mt-1">
              Send reset link
            </Button>

            <div className="border-t border-[#E8DDD6] pt-4">
              <Link
                to="/login"
                className="block w-full text-sm text-[#7A6B63] hover:text-[#3A2332] text-center transition-colors"
              >
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
