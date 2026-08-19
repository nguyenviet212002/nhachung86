import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import * as areaService from './service.js';

export const router = Router();

const normalLimit = rateLimit({ windowMs: 60_000, max: 60 });

router.use(normalLimit, requireAuth);

router.get('/', async (req, res, next) => {
  try {
    res.json(await areaService.tree({ actor: req.actor }));
  } catch (err) {
    next(err);
  }
});
