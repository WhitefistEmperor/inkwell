import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Field, FormErrors } from '../components/bits.jsx';

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
    <form onSubmit={submit}>
      <div className="row page-title">
        <div className="note" />
        <h1>Settings</h1>
      </div>

      <FormErrors error={error} />
      <Field label="Username" id="username">
        <input id="username" name="username" value={form.username} onChange={update} required />
      </Field>
      <Field label="Email" id="email">
        <input id="email" name="email" type="email" value={form.email} onChange={update} required />
      </Field>
      <Field label="About you" id="bio" hint="Shown on your profile.">
        <textarea id="bio" name="bio" rows={3} value={form.bio} onChange={update} maxLength={500} />
      </Field>
      <Field label="Picture" id="image" hint="The web address of an image. Leave empty to show your initial.">
        <input id="image" name="image" type="url" value={form.image} onChange={update} />
      </Field>
      <Field label="New password" id="password" hint="Leave empty to keep your current password.">
        <input id="password" name="password" type="password" value={form.password} onChange={update} autoComplete="new-password" minLength={8} />
      </Field>

      <div className="row form-end">
        <div className="note" />
        <div className="actions">
          <button className="button" disabled={busy}>Save settings</button>
          {saved && <span className="form-ok" role="status">Saved</span>}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              logout();
              navigate('/');
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </form>
  );
}
