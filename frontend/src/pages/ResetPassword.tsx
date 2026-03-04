import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      navigate('/dashboard');
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
        <form onSubmit={handleSubmit} className="bg-white border border-[#E8DDD6] p-8 flex flex-col gap-5">
          <div className="mb-1">
            <h1 className="text-[#3A2332] font-semibold text-lg tracking-tight">
              Choose a new password
            </h1>
            <p className="text-sm text-[#7A6B63] mt-1">Must be at least 8 characters.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[#7A6B63] uppercase tracking-widest">
              New password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[#7A6B63] uppercase tracking-widest">
              Confirm password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 px-3 py-2.5">
              {error}
            </p>
          )}

          <Button type="submit" loading={loading} className="w-full mt-1">
            Update password
          </Button>
        </form>
      </div>
    </div>
  );
}
