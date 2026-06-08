import React, { useState } from 'react';
import { Activity, Mail, Lock, ShieldAlert, LogIn, UserPlus } from 'lucide-react';
import { supabase } from './lib/supabaseClient.ts';

export default function Auth() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError('Authentication is not configured.');
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // On success, the parent App's onAuthStateChange listener takes over.
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setMessage('Check your email to confirm your account, then sign in.');
          setMode('signin');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell min-h-screen flex items-center justify-center p-4 font-sans text-ink">
      <div className="surface relative z-10 max-w-md w-full rounded-3xl p-8 sm:p-9">
        <div className="flex items-center gap-3 mb-7">
          <div className="w-11 h-11 rounded-xl bg-pine flex items-center justify-center text-canvas shadow-[0_10px_24px_-12px_rgba(15,76,69,0.8)]">
            <Activity size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-display font-semibold tracking-tight text-ink leading-none">HealthAgent AI</h1>
            <p className="text-[10px] text-sage mt-1 font-semibold uppercase tracking-[0.22em]">Secure Sign In</p>
          </div>
        </div>

        <h2 className="text-3xl font-display font-semibold text-ink mb-1.5 leading-tight">
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </h2>
        <p className="text-ink/55 mb-6 text-sm">
          {mode === 'signin'
            ? 'Sign in to access your consultations.'
            : 'Sign up to securely store your medical history.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-[10px] text-ink/45 font-bold uppercase tracking-[0.14em] mb-1.5">Email</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Mail className="h-4 w-4 text-sage" />
              </div>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="field block pl-10 pr-3 py-2.5 text-sm"
                placeholder="you@example.com"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-[10px] text-ink/45 font-bold uppercase tracking-[0.14em] mb-1.5">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-sage" />
              </div>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="field block pl-10 pr-3 py-2.5 text-sm"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 text-sm text-clay bg-clay/8 rounded-xl border border-clay/20 flex items-start">
              <ShieldAlert className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {message && (
            <div className="p-3 text-sm text-pine bg-mist rounded-xl border border-pine/15">
              {message}
            </div>
          )}

          <button
            disabled={loading}
            type="submit"
            className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-canvas bg-pine hover:bg-pine-deep focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-pine/40 focus:ring-offset-[#fffdf8] transition-all disabled:opacity-70 disabled:cursor-not-allowed uppercase tracking-[0.12em] shadow-[0_16px_30px_-16px_rgba(15,76,69,0.9)]"
          >
            {mode === 'signin' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <p className="text-sm text-ink/55 mt-6 text-center">
          {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null); }}
            className="text-pine font-semibold hover:underline"
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
