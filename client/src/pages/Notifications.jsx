import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useNotifications } from '../realtime.jsx';
import { MarginNote, PageNote } from '../components/bits.jsx';

const VERB = { follow: 'started following you', favorite: 'favorited', comment: 'commented on' };

export default function Notifications() {
  const { items, unread, markAllRead } = useNotifications();

  // Opening the page counts as reading them. Unread ones are drawn in wet ink
  // (see styles.css); the short delay lets you see which were new before they dry.
  // Depending on `unread` means one that arrives while the page is open is read too.
  useEffect(() => {
    if (unread > 0) {
      const timer = setTimeout(markAllRead, 2500);
      return () => clearTimeout(timer);
    }
  }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="row page-title ruled">
        <div className="note" />
        <h1>Notifications</h1>
      </div>
      {items.length === 0 && <PageNote>Nothing yet. When someone follows you, or favorites or comments on your article, it shows up here straight away.</PageNote>}
      {items.map((n) => (
        <div key={n.id} className={`row notice ruled ${n.read ? '' : 'is-unread'}`}>
          <MarginNote author={n.actor} date={n.createdAt} />
          <p>
            {n.actor.username} {VERB[n.type]}
            {n.article && <> <Link to={`/article/${n.article.slug}`}>{n.article.title}</Link></>}
          </p>
        </div>
      ))}
    </>
  );
}
