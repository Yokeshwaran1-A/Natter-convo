const User = require('../models/User');
const Message = require('../models/Message');

// @desc    Get friend list with last message and unread count
// @route   GET /api/friends
const getFriends = async (req, res) => {
  const user = await User.findById(req.user._id).populate('addedFriends', '-password');
  const friends = user.addedFriends || [];

  // Enhance each friend with last message and unread count
  const friendsWithDetails = await Promise.all(
    friends.map(async (friend) => {
      const lastMessage = await Message.findOne({
        $or: [
          { senderId: req.user._id, receiverId: friend._id },
          { senderId: friend._id, receiverId: req.user._id }
        ],
        groupId: null
      })
        .sort({ createdAt: -1 })
        .limit(1);

      const unreadCount = await Message.countDocuments({
        senderId: friend._id,
        receiverId: req.user._id,
        groupId: null,
        seen: false
      });

      return {
        _id: friend._id,
        username: friend.username,
        email: friend.email,
        profilePicture: friend.profilePicture,
        lastMessage: lastMessage ? {
          message: lastMessage.message,
          image: lastMessage.image,
          audio: lastMessage.audio,
          video: lastMessage.video,
          createdAt: lastMessage.createdAt,
          fromMe: lastMessage.senderId.toString() === req.user._id.toString()
        } : null,
        unreadCount
      };
    })
  );

  res.json(friendsWithDetails);
};

// @desc    Add a friend by userId
// @route   POST /api/friends/add
const addFriend = async (req, res) => {
  const { friendId } = req.body;
  if (!friendId) {
    return res.status(400).json({ message: 'Friend ID is required' });
  }

  if (friendId === req.user._id.toString()) {
    return res.status(400).json({ message: 'You cannot add yourself' });
  }

  const friend = await User.findById(friendId);
  if (!friend) {
    return res.status(404).json({ message: 'User not found' });
  }

  const currentUser = await User.findById(req.user._id);

  const alreadyAdded = (currentUser.addedFriends || []).some(
    (id) => id.toString() === friend._id.toString()
  );
  if (alreadyAdded) {
    return res.status(400).json({ message: 'Already friends' });
  }

  currentUser.addedFriends = currentUser.addedFriends || [];
  currentUser.addedFriends.push(friend._id);

  if (!currentUser.friends.includes(friend._id)) {
    currentUser.friends.push(friend._id);
  }
  if (!friend.friends.includes(currentUser._id)) {
    friend.friends.push(currentUser._id);
  }

  await currentUser.save();
  await friend.save();

  const io = req.app.get('io');
  if (io) {
    const friendPayloadForCurrentUser = {
      _id: friend._id,
      username: friend.username,
      email: friend.email,
      profilePicture: friend.profilePicture,
      lastMessage: null,
      unreadCount: 0
    };
    io.to(req.user._id.toString()).emit('friend_added', friendPayloadForCurrentUser);
  }

  res.json({
    message: 'Friend added successfully',
    friend: {
      _id: friend._id,
      username: friend.username,
      profilePicture: friend.profilePicture,
      email: friend.email,
      lastMessage: null,
      unreadCount: 0
    }
  });
};

// @desc    Remove a friend
// @route   DELETE /api/friends/:friendId
const removeFriend = async (req, res) => {
  const { friendId } = req.params;
  
  if (!friendId) {
    return res.status(400).json({ message: 'Friend ID is required' });
  }

  try {
    const currentUser = await User.findById(req.user._id);
    const friend = await User.findById(friendId);
    
    if (!friend) {
      return res.status(404).json({ message: 'User not found' });
    }

    const addedByCurrentUser = (currentUser.addedFriends || []).some(
      (id) => id.toString() === friendId
    );
    const currentUserIdString = req.user._id.toString();
    const friendAddedCurrentUser = (friend.addedFriends || []).some(
      (id) => id.toString() === currentUserIdString
    );
    const areConnected =
      (currentUser.friends || []).some((id) => id.toString() === friendId) ||
      (friend.friends || []).some((id) => id.toString() === currentUserIdString);

    if (!addedByCurrentUser && !friendAddedCurrentUser && !areConnected) {
      return res.status(400).json({ message: 'You are not friends with this user' });
    }

    currentUser.addedFriends = (currentUser.addedFriends || []).filter(
      (f) => f.toString() !== friendId
    );
    currentUser.friends = (currentUser.friends || []).filter(
      (f) => f.toString() !== friendId
    );
    friend.addedFriends = (friend.addedFriends || []).filter(
      (f) => f.toString() !== req.user._id.toString()
    );
    friend.friends = (friend.friends || []).filter(
      (f) => f.toString() !== req.user._id.toString()
    );

    await currentUser.save();
    await friend.save();

    const io = req.app.get('io');
    if (io) {
      io.to(req.user._id.toString()).emit('friend_removed', { friendId: friendId.toString() });
      io.to(friendId.toString()).emit('friend_removed', { friendId: req.user._id.toString() });
    }

    res.json({ message: 'Friend removed successfully' });
  } catch (err) {
    console.error('Error removing friend:', err);
    res.status(500).json({ message: 'Error removing friend' });
  }
};

module.exports = { getFriends, addFriend, removeFriend };
