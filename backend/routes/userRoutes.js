const express = require('express');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getUserProfile, updateUserProfile, searchUser, deleteUser } = require('../controllers/userController');
const router = express.Router();

router.use(protect); // All routes below require authentication

router.get('/profile', getUserProfile);
router.put('/profile', upload.single('profilePicture'), updateUserProfile);
router.delete('/profile', deleteUser);
router.get('/search', searchUser);

module.exports = router;
