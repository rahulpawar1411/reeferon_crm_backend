// ====================================================================
// Customer Admin Notes Routes (Super Admin → customer updates)
// GET    /api/customer-notes           — list notes (customer: own, read-only)
// GET    /api/customer-notes/threads   — super_admin thread list
// POST   /api/customer-notes           — super_admin create / broadcast only
// DELETE /api/customer-notes/:id       — super_admin delete
// ====================================================================

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/customerAdminNotesController');

router.get('/threads', ctrl.listThreads);
router.get('/', ctrl.listNotes);
router.post('/', ctrl.createNote);
router.delete('/:id', ctrl.deleteNote);

module.exports = router;
