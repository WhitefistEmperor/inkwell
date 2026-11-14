// Small pieces of UI reused across pages.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// Shows the user's picture, or their first letter when they have none.
export function Avatar({ user, size = 36 }) {
  const style = { width: size, height: size, fontSize: size * 0.45 };
  return user.image ? (
    <img className="avatar" style={style} src={user.image} alt="" />
  ) : (
    <span className="avatar avatar-letter" style={style} aria-hidden="true">
      {user.username[0].toUpperCase()}
    </span>
  );
}

export function Byline({ author, date }) {
  return (
    <div className="byline">
      <Link to={`/profile/${author.username}`}><Avatar user={author} /></Link>
      <div>
        <Link to={`/profile/${author.username}`} className="byline-name">{author.username}</Link>
        <time dateTime={date}>{formatDate(date)}</time>
      </div>
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
      className={`pill ${article.favorited ? 'pill-on' : ''}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={article.favorited}
      aria-label={article.favorited ? 'Remove from favorites' : 'Add to favorites'}
    >
      ♥ {withLabel ? (article.favorited ? 'Favorited · ' : 'Favorite · ') : ''}{article.favoritesCount}
    </button>
  );
}

export function FollowButton({ profile, onChange }) {
  const { busy, toggle } = useToggle(
    () => api(`/profiles/${profile.username}/follow`, { method: profile.following ? 'DELETE' : 'POST' }).then((d) => d.profile),
    onChange,
  );
  return (
    <button type="button" className={`pill ${profile.following ? 'pill-on' : ''}`} onClick={toggle} disabled={busy} aria-pressed={profile.following}>
      {profile.following ? '✓ Following' : '+ Follow'} {profile.username}
    </button>
  );
}

// Shows the server's field-level validation messages under a form.
export function FormErrors({ error }) {
  if (!error) return null;
  const details = Object.entries(error.details || {});
  return (
    <div className="form-error" role="alert">
      <strong>{error.message}</strong>
      {details.length > 0 && (
        <ul>{details.map(([field, message]) => <li key={field}>{field}: {message}</li>)}</ul>
      )}
    </div>
  );
}
