// Create a new article (/editor) or edit an existing one (/editor/:slug).
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { FormErrors } from '../components/bits.jsx';

const EMPTY = { title: '', description: '', body: '', tags: '' };

export default function Editor() {
  const { slug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Editing: load the current content into the form.
  useEffect(() => {
    if (!slug) return setForm(EMPTY);
    api(`/articles/${slug}`)
      .then(({ article }) => {
        if (article.author.username !== user.username) return navigate('/'); // not yours
        setForm({ title: article.title, description: article.description, body: article.body, tags: article.tags.join(', ') });
      })
      .catch(() => navigate('/'));
  }, [slug, user.username, navigate]);

  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // "React, node js" -> ["react", "node-js"]
    const tags = form.tags.split(',').map((t) => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean);
    try {
      const { article } = await api(slug ? `/articles/${slug}` : '/articles', {
        method: slug ? 'PUT' : 'POST',
        body: { title: form.title, description: form.description, body: form.body, tags },
      });
      navigate(`/article/${article.slug}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="wrap medium">
      <h1 className="page-title">{slug ? 'Edit article' : 'New article'}</h1>
      <form className="form" onSubmit={submit}>
        <FormErrors error={error} />
        <label>
          Title
          <input name="title" value={form.title} onChange={update} required />
        </label>
        <label>
          What is it about?
          <input name="description" value={form.description} onChange={update} required />
        </label>
        <label>
          Article (Markdown supported)
          <textarea name="body" rows={14} value={form.body} onChange={update} required />
        </label>
        <label>
          Tags (comma separated)
          <input name="tags" value={form.tags} onChange={update} placeholder="react, postgres" />
        </label>
        <button className="button" disabled={busy}>{slug ? 'Save changes' : 'Publish'}</button>
      </form>
    </div>
  );
}
