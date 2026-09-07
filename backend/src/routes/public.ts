import { Router } from 'express';
import galleryRoutes from './publicGallery.js';
import previewRoutes from './publicPreview.js';

/**
 * Everything served without authentication, under one prefix.
 *
 * Keeping a single mount point for `/api/public` means the route manifest —
 * and therefore the "what is exposed in this mode?" test — stays a list of
 * distinct prefixes.
 */
const router = Router();

router.use(galleryRoutes);
router.use(previewRoutes);

export default router;
