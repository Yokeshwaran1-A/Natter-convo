const express = require('express');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getMessages, markAsSeen, uploadImage, deleteMessages, deleteSingleMessage } = require('../controllers/messageController');
const router = express.Router();

router.use(protect);

router.delete('/item/:messageId', deleteSingleMessage);
router.get('/:friendId', getMessages);
router.put('/seen/:friendId', markAsSeen);
router.delete('/:friendId', deleteMessages);
router.post('/upload', upload.single('image'), uploadImage);

module.exports = router;
