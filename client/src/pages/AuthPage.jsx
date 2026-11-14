// One component for both /login and /register; `mode` decides which.
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Field, FormErrors } from '../components/bits.jsx';

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
    <form onSubmit={submit}>
      <div className="row page-title">
        <div className="note" />
        <div>
          <h1>{isRegister ? 'Create your account' : 'Sign in'}</h1>
          <p>
            {isRegister
              ? <>Already have one? <Link to="/login">Sign in</Link></>
              : <>New here? <Link to="/register">Create an account</Link></>}
          </p>
        </div>
      </div>

      <FormErrors error={error} />
      {isRegister && (
        <Field label="Username" id="username" hint="Letters, numbers, dashes and underscores.">
          <input id="username" name="username" value={form.username} onChange={update} autoComplete="username" required />
        </Field>
      )}
      <Field label="Email" id="email">
        <input id="email" name="email" type="email" value={form.email} onChange={update} autoComplete="email" required />
      </Field>
      <Field label="Password" id="password" hint={isRegister ? 'At least 8 characters.' : undefined}>
        <input
          id="password"
          name="password"
          type="password"
          value={form.password}
          onChange={update}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          minLength={isRegister ? 8 : undefined}
          required
        />
      </Field>

      <div className="row form-end">
        <div className="note" />
        <div><button className="button" disabled={busy}>{isRegister ? 'Create account' : 'Sign in'}</button></div>
      </div>
    </form>
  );
}
