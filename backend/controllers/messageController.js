const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');

const buildConversationPreview = async (userId, friendId) => {
  const lastMessage = await Message.findOne({
    $or: [
      { senderId: userId, receiverId: friendId },
      { senderId: friendId, receiverId: userId }
    ],
    groupId: null
  })
    .sort({ createdAt: -1 })
    .populate('senderId', 'username profilePicture')
    .populate('receiverId', 'username profilePicture');

  return {
    friendId: friendId.toString(),
    lastMessage: lastMessage || null,
    lastMessageTime: lastMessage?.createdAt || null
  };
};

// @desc    Get paginated messages between current user and a friend
// @route   GET /api/messages/:friendId
const getMessages = async (req, res) => {
  const { friendId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const skip = (page - 1) * limit;

  const messages = await Message.find({
    $or: [
      { senderId: req.user._id, receiverId: friendId },
      { senderId: friendId, receiverId: req.user._id }
    ],
    groupId: null
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .populate('senderId', 'username profilePicture')
    .populate('receiverId', 'username profilePicture');

  const total = await Message.countDocuments({
    $or: [
      { senderId: req.user._id, receiverId: friendId },
      { senderId: friendId, receiverId: req.user._id }
    ],
    groupId: null
  });

  res.json({
    messages: messages.reverse(), // send in chronological order
    page: parseInt(page),
    totalPages: Math.ceil(total / limit),
    total
  });
};

// @desc    Mark messages as seen
// @route   PUT /api/messages/seen/:friendId
const markAsSeen = async (req, res) => {
  const { friendId } = req.params;
  await Message.updateMany(
    { senderId: friendId, receiverId: req.user._id, groupId: null, seen: false },
    { seen: true }
  );
  res.json({ message: 'Messages marked as seen' });
};

// @desc    Upload a file (returns file path)
// @route   POST /api/messages/upload
const uploadImage = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl });
};

// @desc    Delete all messages between current user and a friend
// @route   DELETE /api/messages/:friendId
const deleteMessages = async (req, res) => {
  const { friendId } = req.params;
  
  try {
    await Message.deleteMany({
      $or: [
        { senderId: req.user._id, receiverId: friendId },
        { senderId: friendId, receiverId: req.user._id }
      ],
      groupId: null
    });
    res.json({ message: 'Chat cleared successfully' });
  } catch (err) {
    console.error('Error deleting messages:', err);
    res.status(500).json({ message: 'Error deleting messages' });
  }
};

// @desc    Delete a single message
// @route   DELETE /api/messages/item/:messageId
const deleteSingleMessage = async (req, res) => {
  const { messageId } = req.params;

  try {
    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const currentUserId = req.user._id.toString();

    if (message.groupId) {
      const group = await Group.findById(message.groupId).select('members admins');
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }
      const isMember = group.members.some((id) => id.toString() === currentUserId);
      if (!isMember) {
        return res.status(403).json({ message: 'You are not allowed to delete this message' });
      }
    } else {
      const participantIds = [
        message.senderId.toString(),
        message.receiverId.toString()
      ];

      if (!participantIds.includes(currentUserId)) {
        return res.status(403).json({ message: 'You are not allowed to delete this message' });
      }
    }

    await Message.findByIdAndDelete(messageId);

    let payload = { messageId };

    if (message.groupId) {
      const io = req.app.get('io');
      if (io) {
        io.to(message.groupId.toString()).emit('group_message_deleted', payload);
      }
      return res.json({
        message: 'Message deleted successfully',
        messageId
      });
    }

    const otherUserId =
      message.senderId.toString() === currentUserId
        ? message.receiverId.toString()
        : message.senderId.toString();

    const [currentUserPreview, otherUserPreview] = await Promise.all([
      buildConversationPreview(req.user._id, otherUserId),
      buildConversationPreview(otherUserId, req.user._id)
    ]);

    const io = req.app.get('io');
    if (io) {
      payload = {
        messageId,
        participants: [currentUserId, otherUserId],
        previews: [currentUserPreview, otherUserPreview]
      };

      io.to(currentUserId).emit('message_deleted', payload);
      io.to(otherUserId).emit('message_deleted', payload);
    }

    return res.json({
      message: 'Message deleted successfully',
      messageId,
      previews: [currentUserPreview, otherUserPreview]
    });
  } catch (err) {
    console.error('Error deleting message:', err);
    return res.status(500).json({ message: 'Error deleting message' });
  }
};

module.exports = { getMessages, markAsSeen, uploadImage, deleteMessages, deleteSingleMessage };
