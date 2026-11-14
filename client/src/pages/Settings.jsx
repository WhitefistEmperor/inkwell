import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { FormErrors } from '../components/bits.jsx';

export default function Settings() {
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  // The API uses null for "no bio / no picture"; form inputs need a string.
  const [form, setForm] = useState({ image: user.image ?? '', username: user.username, bio: user.bio ?? '', email: user.email, password: '' });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (e) => {
    setSaved(false);
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // An empty password box means "keep my current password".
    const { password, ...rest } = form;
    try {
      await updateUser(password ? form : rest);
      setForm((f) => ({ ...f, password: '' }));
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap narrow">
      <h1 className="page-title">Your settings</h1>
      <form className="form" onSubmit={submit}>
        <FormErrors error={error} />
        {saved && <p className="form-success" role="status">Settings saved.</p>}
        <label>
          Profile picture URL
          <input name="image" type="url" value={form.image} onChange={update} placeholder="https://…" />
        </label>
        <label>
          Username
          <input name="username" value={form.username} onChange={update} required />
        </label>
        <label>
          Short bio
          <textarea name="bio" rows={4} value={form.bio} onChange={update} maxLength={500} />
        </label>
        <label>
          Email
          <input name="email" type="email" value={form.email} onChange={update} required />
        </label>
        <label>
          New password
          <input name="password" type="password" value={form.password} onChange={update} autoComplete="new-password" minLength={8} placeholder="Leave empty to keep the current one" />
        </label>
        <button className="button" disabled={busy}>Save settings</button>
      </form>
      <hr />
      <button
        type="button"
        className="pill pill-danger"
        onClick={() => {
          logout();
          navigate('/');
        }}
      >
        Sign out
      </button>
    </div>
  );
}
