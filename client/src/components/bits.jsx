// Small pieces of UI reused across pages.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

// "14 Nov 2026"
export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// The ink drop used for the logo and for favorites.
export const Drop = () => (
  <svg viewBox="0 0 16 22" aria-hidden="true">
    <path d="M8 1.5C8 1.5 1.5 9.8 1.5 14a6.5 6.5 0 0 0 13 0C14.5 9.8 8 1.5 8 1.5Z" />
  </svg>
);

// Shows the user's picture, or their initial when they have none.
export function Avatar({ user, size = 36 }) {
  const style = { width: size, height: size, fontSize: size * 0.5 };
  return user.image ? (
    <img className="monogram" style={style} src={user.image} alt="" />
  ) : (
    <span className="monogram" style={style} aria-hidden="true">{user.username[0].toUpperCase()}</span>
  );
}

// A line of pencil text on the page, used for "loading", "not found" and empty lists.
export const PageNote = ({ children }) => (
  <div className="row">
    <div className="note" />
    <p className="empty">{children}</p>
  </div>
);

// The margin note beside an article or comment: who wrote it, and when.
export function MarginNote({ author, date }) {
  return (
    <div className="note">
      <strong><Link to={`/profile/${author.username}`}>{author.username}</Link></strong>
      <time dateTime={date}>{formatDate(date)}</time>
    </div>
  );
}

export function TagList({ tags }) {
  if (!tags.length) return null;
  return (
    <ul className="tags">
      {tags.map((tag) => (
        <li key={tag}><Link to={`/?tag=${encodeURIComponent(tag)}`}>#{tag}</Link></li>
      ))}
    </ul>
  );
}

// Shared logic for the two toggle buttons below: send the request, hand the
// server's fresh copy to the parent, and send signed-out visitors to /login.
function useToggle(request, onChange) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  return {
    busy,
    async toggle() {
      if (!user) return navigate('/login');
      setBusy(true);
      try {
        onChange(await request());
      } finally {
        setBusy(false);
      }
    },
  };
}

export function FavoriteButton({ article, onChange, withLabel = false }) {
  const { busy, toggle } = useToggle(
    () => api(`/articles/${article.slug}/favorite`, { method: article.favorited ? 'DELETE' : 'POST' }).then((d) => d.article),
    onChange,
  );
  return (
    <button
      type="button"
      className={`drop ${article.favorited ? 'is-on' : ''}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={article.favorited}
      aria-label={`${article.favorited ? 'Remove from favorites' : 'Add to favorites'}, ${article.favoritesCount} so far`}
    >
      <Drop />
      <span>{article.favoritesCount}</span>
      {withLabel && <span>{article.favorited ? 'Favorited' : 'Favorite'}</span>}
    </button>
  );
}

export function FollowButton({ profile, onChange }) {
  const { busy, toggle } = useToggle(
    () => api(`/profiles/${profile.username}/follow`, { method: profile.following ? 'DELETE' : 'POST' }).then((d) => d.profile),
    onChange,
  );
  return (
    <button type="button" className={`text-button ${profile.following ? 'is-on' : ''}`} onClick={toggle} disabled={busy} aria-pressed={profile.following}>
      {profile.following ? `Following ${profile.username}` : `Follow ${profile.username}`}
    </button>
  );
}

// One line of a form: the label hangs in the margin, the input sits on the page.
export function Field({ label, id, hint, wide = false, children }) {
  return (
    <div className={`row field ${wide ? 'wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div>
        {children}
        {hint && <p className="hint">{hint}</p>}
      </div>
    </div>
  );
}

// Shows the server's validation messages, e.g. "email has already been taken".
export function FormErrors({ error }) {
  if (!error) return null;
  const lines = error.lines?.length ? error.lines : [error.message];
  return (
    <div className="row">
      <div className="note" />
      <div className="form-error" role="alert">
        <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
    </div>
  );
}
