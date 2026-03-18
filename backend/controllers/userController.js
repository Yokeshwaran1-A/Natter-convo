const User = require('../models/User');
const Message = require('../models/Message');
const Group = require('../models/Group');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Get current user profile
// @route   GET /api/users/profile
const getUserProfile = async (req, res) => {
  res.json(req.user);
};

// @desc    Update user profile (e.g., profile picture)
// @route   PUT /api/users/profile
const updateUserProfile = async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  user.username = req.body.username || user.username;
  user.email = req.body.email || user.email;
  user.profilePicture = req.file
    ? `/uploads/${req.file.filename}`
    : (req.body.profilePicture || user.profilePicture);

  if (req.body.password) {
    user.password = req.body.password;
  }

  const updatedUser = await user.save();
  const profilePayload = {
    _id: updatedUser._id,
    username: updatedUser.username,
    email: updatedUser.email,
    profilePicture: updatedUser.profilePicture
  };

  const io = req.app.get('io');
  if (io) {
    io.to(updatedUser._id.toString()).emit('profile_updated', profilePayload);
    updatedUser.friends.forEach((friendId) => {
      io.to(friendId.toString()).emit('profile_updated', profilePayload);
    });
  }

  return res.json({
    ...profilePayload,
    token: req.headers.authorization.split(' ')[1]
  });
};

// @desc    Search user by username or email (for adding friend)
// @route   GET /api/users/search?q=...
const searchUser = async (req, res) => {
  const rawQuery = (req.query.q || '').trim();
  const scope = (req.query.scope || '').toLowerCase();
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : (rawQuery ? 15 : 20);
  const currentUser = await User.findById(req.user._id).select('addedFriends');
  const excludedIds = scope === 'all'
    ? [req.user._id]
    : [req.user._id, ...(currentUser?.addedFriends || [])];

  const queryFilter = rawQuery
    ? {
        $or: [
          { username: { $regex: `^${escapeRegex(rawQuery)}`, $options: 'i' } },
          { email: { $regex: `^${escapeRegex(rawQuery)}`, $options: 'i' } }
        ]
      }
    : {};

  const users = await User.find({
    _id: { $nin: excludedIds },
    ...queryFilter
  })
    .select('-password')
    .limit(limit);

  const normalizedQuery = rawQuery.toLowerCase();
  const rankedUsers = users.sort((a, b) => {
    if (!normalizedQuery) {
      return a.username.localeCompare(b.username);
    }

    const getScore = (user) => {
      const username = user.username.toLowerCase();
      const email = user.email.toLowerCase();

      if (username === normalizedQuery) return 0;
      if (username.startsWith(normalizedQuery)) return 1;
      if (email.startsWith(normalizedQuery)) return 2;
      if (username.includes(normalizedQuery)) return 3;
      if (email.includes(normalizedQuery)) return 4;
      return 5;
    };

    return getScore(a) - getScore(b) || a.username.localeCompare(b.username);
  });

  res.json(rankedUsers);
};

// @desc    Delete user account
// @route   DELETE /api/users/profile
const deleteUser = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Delete all messages sent or received by the user
    await Message.deleteMany({
      $or: [{ senderId: userId }, { receiverId: userId }]
    });

    // Remove user from groups and delete empty groups
    const groups = await Group.find({ members: userId });
    for (const group of groups) {
      group.members = group.members.filter((id) => id.toString() !== userId.toString());
      group.admins = group.admins.filter((id) => id.toString() !== userId.toString());
      if (group.members.length === 0) {
        await Message.deleteMany({ groupId: group._id });
        await group.deleteOne();
      } else {
        if (group.admins.length === 0) {
          group.admins = [group.members[0]];
        }
        await group.save();
      }
    }
    
    // Remove user from all friends' lists
    const user = await User.findById(userId);
    if (user && user.friends) {
      for (const friendId of user.friends) {
        await User.findByIdAndUpdate(friendId, {
          $pull: { friends: userId, addedFriends: userId }
        });
      }
    }
    
    // Delete the user
    await User.findByIdAndDelete(userId);
    
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error deleting account' });
  }
};

module.exports = { getUserProfile, updateUserProfile, searchUser, deleteUser };
