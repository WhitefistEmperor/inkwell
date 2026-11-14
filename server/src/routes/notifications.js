import { Router } from 'express';
import { listNotifications, markAllRead } from '../notifications.service.js';
import { requireAuth } from '../middleware.js';

const router = Router();
router.use(requireAuth); // every route here needs a signed-in user

router.get('/', async (req, res) => {
  res.json(await listNotifications(req.userId));
});

router.post('/read', async (req, res) => {
  await markAllRead(req.userId);
  res.status(204).end();
});

export default router;
