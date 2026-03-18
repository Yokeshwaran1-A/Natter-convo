const express = require('express');
const { protect } = require('../middleware/auth');
const { getFriends, addFriend, removeFriend } = require('../controllers/friendController');
const router = express.Router();

router.use(protect);

router.get('/', getFriends);
router.post('/add', addFriend);
router.delete('/:friendId', removeFriend);

module.exports = router;