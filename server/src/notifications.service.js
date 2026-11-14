import { query } from './db.js';
import { emitToUser } from './realtime.js';

// LEFT JOIN because a "follow" notification has no article.
const NOTIFICATION_SELECT = `
  SELECT n.id, n.type, n.read_at, n.created_at,
         actor.username AS actor_username, actor.image AS actor_image,
         a.slug AS article_slug, a.title AS article_title
  FROM notifications n
  JOIN users actor ON actor.id = n.actor_id
  LEFT JOIN articles a ON a.id = n.article_id`;

const toNotification = (row) => ({
  id: row.id,
  type: row.type,
  read: row.read_at !== null,
  createdAt: row.created_at,
  actor: { username: row.actor_username, image: row.actor_image },
  article: row.article_slug ? { slug: row.article_slug, title: row.article_title } : null,
});

// Saves the notification first, then pushes it over the WebSocket. The
// database is the source of truth: if the recipient is offline the push
// reaches nobody, and they simply see it in the list next time they sign in.
export async function notify({ userId, actorId, type, articleId = null }) {
  if (userId === actorId) return; // never notify people about their own actions
  const inserted = await query(
    'INSERT INTO notifications (user_id, actor_id, type, article_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, actorId, type, articleId],
  );
  const { rows } = await query(`${NOTIFICATION_SELECT} WHERE n.id = $1`, [inserted.rows[0].id]);
  emitToUser(userId, 'notification', toNotification(rows[0]));
}

export async function listNotifications(userId) {
  const [list, unread] = await Promise.all([
    query(`${NOTIFICATION_SELECT} WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 30`, [userId]),
    query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]),
  ]);
  return { notifications: list.rows.map(toNotification), unread: unread.rows[0].n };
}

export async function markAllRead(userId) {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
}
