// One component for both /login and /register; `mode` decides which.
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { FormErrors } from '../components/bits.jsx';

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />; // already signed in

  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register(form);
      else await login({ email: form.email, password: form.password });
      navigate('/');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="wrap narrow">
      <h1 className="page-title">{isRegister ? 'Create your account' : 'Welcome back'}</h1>
      <p className="center">
        {isRegister ? <Link to="/login">Already have an account?</Link> : <Link to="/register">Need an account?</Link>}
      </p>
      <form className="form" onSubmit={submit}>
        <FormErrors error={error} />
        {isRegister && (
          <label>
            Username
            <input name="username" value={form.username} onChange={update} autoComplete="username" required />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" value={form.email} onChange={update} autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={update}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={isRegister ? 8 : undefined}
            required
          />
        </label>
        <button className="button" disabled={busy}>{isRegister ? 'Sign up' : 'Sign in'}</button>
      </form>
    </div>
  );
}
