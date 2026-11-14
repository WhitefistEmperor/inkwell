// Create a new article (/editor) or edit an existing one (/editor/:slug).
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, FormErrors } from '../components/bits.jsx';

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
        setForm({ title: article.title, description: article.description, body: article.body, tags: article.tagList.join(', ') });
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
        body: { article: { title: form.title, description: form.description, body: form.body, tagList: tags } },
      });
      navigate(`/article/${article.slug}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="row page-title">
        <div className="note" />
        <h1>{slug ? 'Edit article' : 'New article'}</h1>
      </div>

      <FormErrors error={error} />
      <Field label="Title" id="title" wide>
        <input id="title" name="title" className="title-input" value={form.title} onChange={update} required />
      </Field>
      <Field label="Summary" id="description" wide hint="One or two sentences. Shown under the title in lists.">
        <input id="description" name="description" value={form.description} onChange={update} required />
      </Field>
      <Field label="Article" id="body" wide hint="Markdown works: **bold**, # headings, `code`, lists and links.">
        <textarea id="body" name="body" className="ruled-paper" rows={14} value={form.body} onChange={update} required />
      </Field>
      <Field label="Tags" id="tags" wide hint="Separate with commas, for example: react, postgres">
        <input id="tags" name="tags" value={form.tags} onChange={update} />
      </Field>

      <div className="row form-end">
        <div className="note" />
        <div><button className="button" disabled={busy}>{slug ? 'Save changes' : 'Publish'}</button></div>
      </div>
    </form>
  );
}
