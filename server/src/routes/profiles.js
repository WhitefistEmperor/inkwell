import { Router } from 'express';
import { query } from '../db.js';
import { HttpError, notFoundError, optionalAuth, requireAuth } from '../middleware.js';
import { notify } from '../notifications.service.js';

const router = Router();

// viewerId may be null (signed out); then "following" is simply false.
async function loadProfile(username, viewerId) {
  const { rows } = await query(
    `SELECT u.id, u.username, u.bio, u.image,
            EXISTS (SELECT 1 FROM follows f
                    WHERE f.followee_id = u.id AND f.follower_id = $2::int) AS following
     FROM users u WHERE lower(u.username) = lower($1)`,
    [username, viewerId],
  );
  if (!rows[0]) throw notFoundError('profile');
  return rows[0];
}

const publicProfile = ({ username, bio, image, following }) => ({ username, bio, image, following });

router.get('/:username', optionalAuth, async (req, res) => {
  res.json({ profile: publicProfile(await loadProfile(req.params.username, req.userId)) });
});

router.post('/:username/follow', requireAuth, async (req, res) => {
  const target = await loadProfile(req.params.username, req.userId);
  if (target.id === req.userId) throw new HttpError(422, { profile: ['cannot follow yourself'] });
  // ON CONFLICT DO NOTHING makes the endpoint idempotent: following twice is harmless.
  const result = await query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.userId, target.id]);
  // rowCount is 1 only for a brand-new follow, so repeating the request does not notify again.
  if (result.rowCount === 1) await notify({ userId: target.id, actorId: req.userId, type: 'follow' });
  res.json({ profile: publicProfile({ ...target, following: true }) });
});

router.delete('/:username/follow', requireAuth, async (req, res) => {
  const target = await loadProfile(req.params.username, req.userId);
  await query('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [req.userId, target.id]);
  res.json({ profile: publicProfile({ ...target, following: false }) });
});

export default router;
