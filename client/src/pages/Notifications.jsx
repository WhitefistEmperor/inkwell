import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useNotifications } from '../realtime.jsx';
import { Avatar, formatDate } from '../components/bits.jsx';

const VERB = { follow: 'started following you', favorite: 'favorited', comment: 'commented on' };

export default function Notifications() {
  const { items, unread, markAllRead } = useNotifications();

  // Opening the page counts as reading them. Depending on `unread` means a
  // notification that arrives live while the page is open is marked read too.
  useEffect(() => {
    if (unread > 0) {
      const timer = setTimeout(markAllRead, 1200); // leave the "new" highlight visible briefly
      return () => clearTimeout(timer);
    }
  }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wrap medium">
      <h1 className="page-title">Notifications</h1>
      {items.length === 0 && <p className="muted center">Nothing yet. Follows, favorites and comments will show up here live.</p>}
      <ul className="notifications">
        {items.map((n) => (
          <li key={n.id} className={n.read ? '' : 'unread'}>
            <Avatar user={n.actor} size={32} />
            <p>
              <Link to={`/profile/${n.actor.username}`}><strong>{n.actor.username}</strong></Link> {VERB[n.type]}
              {n.article && <> <Link to={`/article/${n.article.slug}`}>{n.article.title}</Link></>}
            </p>
            <time dateTime={n.createdAt}>{formatDate(n.createdAt)}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
