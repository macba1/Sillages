import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';

export default function Login() {
  const { signInWithEmail, signUpWithEmail } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
        navigate('/dashboard');
      } else {
        await signUpWithEmail(email, password, fullName);
        setSignupSuccess(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F1EC] flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <Link to="/" className="text-[#3A2332] font-semibold text-base tracking-tight mb-10">
        sillages
      </Link>

      <div className="w-full max-w-sm">
        {signupSuccess ? (
          <div className="bg-white border border-[#E8DDD6] p-8 text-center">
            <p className="text-[#3A2332] font-semibold text-base mb-2">Check your inbox</p>
            <p className="text-sm text-[#7A6B63] leading-relaxed">
              We sent a confirmation link to <span className="font-medium text-[#3A2332]">{email}</span>.
              Click it to activate your account.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white border border-[#E8DDD6] p-8 flex flex-col gap-5">
            <div className="mb-1">
              <h1 className="text-[#3A2332] font-semibold text-lg tracking-tight">
                {mode === 'signin' ? 'Sign in to Sillages' : 'Create your account'}
              </h1>
              <p className="text-sm text-[#7A6B63] mt-1">
                {mode === 'signin' ? 'Welcome back.' : 'Start your free trial today.'}
              </p>
            </div>

            {mode === 'signup' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#7A6B63] uppercase tracking-widest">
                  Full name
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input"
                  placeholder="Jane Smith"
                />
              </div>
            )}

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

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#7A6B63] uppercase tracking-widest">
                  Password
                </label>
                {mode === 'signin' && (
                  <Link
                    to="/forgot-password"
                    className="text-xs text-[#7A6B63] hover:text-[#3A2332] transition-colors"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
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

            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-100 px-3 py-2.5">
                {error}
              </p>
            )}

            <Button type="submit" loading={loading} className="w-full mt-1">
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>

            <div className="border-t border-[#E8DDD6] pt-4">
              <button
                type="button"
                onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
                className="w-full text-sm text-[#7A6B63] hover:text-[#3A2332] text-center transition-colors"
              >
                {mode === 'signin'
                  ? "Don't have an account? Sign up"
                  : 'Already have an account? Sign in'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
