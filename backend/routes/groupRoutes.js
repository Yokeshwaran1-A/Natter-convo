const express = require('express');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  getGroups,
  createGroup,
  updateGroup,
  addMembers,
  removeMember,
  leaveGroup,
  deleteGroup,
  getGroupMessages,
  markGroupSeen
} = require('../controllers/groupController');

const router = express.Router();

router.use(protect);

router.get('/', getGroups);
router.post('/', upload.single('avatar'), createGroup);
router.put('/:groupId', upload.single('avatar'), updateGroup);
router.post('/:groupId/members', addMembers);
router.delete('/:groupId/members/:memberId', removeMember);
router.post('/:groupId/leave', leaveGroup);
router.delete('/:groupId', deleteGroup);
router.get('/:groupId/messages', getGroupMessages);
router.put('/:groupId/seen', markGroupSeen);

module.exports = router;
