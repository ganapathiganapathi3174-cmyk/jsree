import { Router } from 'express';
import * as topupController from '../controllers/topupController.js';
import { authenticateToken, requireActiveUser } from '../middleware/auth.js';
import { uploadTopupProof, handleUploadError } from '../middleware/upload.js';
import { deduplicateProofUpload } from '../middleware/deduplicate.js';

const router = Router();

router.get('/', authenticateToken, requireActiveUser, topupController.getTopups);
router.get('/:topupId', authenticateToken, requireActiveUser, topupController.getTopupDetails);
router.post('/:topupId/proof', authenticateToken, requireActiveUser, uploadTopupProof, handleUploadError, deduplicateProofUpload(), topupController.submitProof);
router.post('/direct', authenticateToken, requireActiveUser, uploadTopupProof, handleUploadError, deduplicateProofUpload(), topupController.directTopup);
router.post('/claim', authenticateToken, requireActiveUser, topupController.claimTopup);

export default router;
