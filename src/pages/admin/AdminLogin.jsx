// src/pages/admin/AdminLogin.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../../services/supabaseClient';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate('/admin/dashboard', { replace: true });
    });
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (signInError) {
      setError(
        signInError.code === 'email_not_confirmed'
          ? 'Confirm your email first — check your inbox for the confirmation link Supabase sent.'
          : 'Wrong email or password.'
      );
      return;
    }
    navigate('/admin/dashboard', { replace: true });
  };

  return (
    <div className="page-in max-w-sm mx-auto px-4 py-16">
      <p className="text-[22px] font-bold tracking-tight mb-1" style={{ color: 'var(--label-1)' }}>
        FoodGuard Admin
      </p>
      <p className="text-[13px] mb-6" style={{ color: 'var(--label-3)' }}>
        Sign in to edit or add products.
      </p>

      {!isSupabaseConfigured && (
        <p className="text-[13px] mb-4 p-3 rounded-[12px]" style={{ background: 'var(--fill)', color: 'var(--v-poor)' }}>
          Supabase isn't configured, so there's nothing to sign in to.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <label className="block text-[13px] font-semibold mb-1.5" style={{ color: 'var(--label-2)' }}>Email</label>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="admin-field w-full px-3.5 py-2.5 rounded-[12px] text-[15px] mb-3"
          required
        />
        <label className="block text-[13px] font-semibold mb-1.5" style={{ color: 'var(--label-2)' }}>Password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="admin-field w-full px-3.5 py-2.5 rounded-[12px] text-[15px] mb-4"
          required
        />
        {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}
        <button
          type="submit"
          disabled={loading || !isSupabaseConfigured}
          className="tap-scale w-full py-3 rounded-[12px] text-[15px] font-semibold text-white"
          style={{ background: 'var(--tint)', opacity: loading ? 0.6 : 1 }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
