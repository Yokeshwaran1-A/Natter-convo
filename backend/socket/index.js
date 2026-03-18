const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Group = require('../models/Group');

// Store online users: userId -> socketId
const onlineUsers = new Map();

module.exports = (server) => {
  const io = socketIo(server, {
    cors: {
      origin: '*', // In production, set to your frontend URL
      methods: ['GET', 'POST']
    }
  });

  // Middleware to authenticate socket connection
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return next(new Error('User not found'));
      }
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user._id.toString();
    onlineUsers.set(userId, socket.id);
    console.log(`User ${socket.user.username} connected`);

    Group.find({ members: userId }).select('_id').then((groups) => {
      groups.forEach((group) => {
        socket.join(group._id.toString());
      });
    }).catch((err) => {
      console.error('Error joining group rooms:', err);
    });

    // Notify friends that this user is online
    socket.user.friends.forEach(friendId => {
      const friendSocketId = onlineUsers.get(friendId.toString());
      if (friendSocketId) {
        io.to(friendSocketId).emit('user_online', userId);
      }
    });

    // Join a room with the user's own ID for private messaging
    socket.join(userId);

    // Handle send_message
    socket.on('send_message', async (data) => {
      const { receiverId, message, image, audio, video, clientTempId } = data;
      if (!receiverId || (!message && !image && !audio && !video)) return;

      // Save message to DB
      const newMessage = new Message({
        senderId: userId,
        receiverId,
        groupId: null,
        message: message || '',
        image: image || '',
        audio: audio || '',
        video: video || '',
        seen: false
      });
      await newMessage.save();

      // Populate both ends so the frontend always gets a consistent shape
      await newMessage.populate('senderId', 'username profilePicture');
      await newMessage.populate('receiverId', 'username profilePicture');

      const messagePayload = {
        ...newMessage.toObject(),
        clientTempId: clientTempId || null
      };

      // Emit to receiver if online
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', messagePayload);
      }
      // Also emit back to sender's other tabs/clients
      socket.to(userId).emit('receive_message', messagePayload);
      // Emit to sender's current socket as confirmation (optional)
      socket.emit('message_sent', messagePayload);
    });

    socket.on('send_group_message', async (data) => {
      const { groupId, message, image, audio, video, clientTempId } = data;
      if (!groupId || (!message && !image && !audio && !video)) return;

      const group = await Group.findById(groupId).select('members');
      if (!group) return;
      const isMember = group.members.some((id) => id.toString() === userId);
      if (!isMember) return;

      const newMessage = new Message({
        senderId: userId,
        receiverId: userId,
        groupId,
        message: message || '',
        image: image || '',
        audio: audio || '',
        video: video || '',
        seen: false,
        seenBy: [userId]
      });
      await newMessage.save();

      await newMessage.populate('senderId', 'username profilePicture');

      const messagePayload = {
        ...newMessage.toObject(),
        clientTempId: clientTempId || null
      };

      io.to(groupId.toString()).emit('group_message', messagePayload);
    });

    // Handle typing
    socket.on('typing', (data) => {
      const { receiverId, isTyping } = data;
      if (receiverId) {
        io.to(receiverId).emit('typing', { senderId: userId, isTyping });
      }
    });

    socket.on('join_group', (groupId) => {
      if (groupId) {
        socket.join(groupId.toString());
      }
    });

    socket.on('leave_group', (groupId) => {
      if (groupId) {
        socket.leave(groupId.toString());
      }
    });

    // Group call signaling (mesh)
    socket.on('group_call_start', ({ groupId, callType }) => {
      if (!groupId) return;
      io.to(groupId.toString()).emit('group_call_start', {
        groupId,
        callType,
        callerId: userId
      });
    });

    socket.on('group_call_join', ({ groupId }) => {
      if (!groupId) return;
      io.to(groupId.toString()).emit('group_call_join', {
        groupId,
        participantId: userId
      });
    });

    socket.on('group_call_offer', ({ receiverId, groupId, offer }) => {
      if (!receiverId || !offer || !groupId) return;
      io.to(receiverId.toString()).emit('group_call_offer', {
        senderId: userId,
        groupId,
        offer
      });
    });

    socket.on('group_call_answer', ({ receiverId, groupId, answer }) => {
      if (!receiverId || !answer || !groupId) return;
      io.to(receiverId.toString()).emit('group_call_answer', {
        senderId: userId,
        groupId,
        answer
      });
    });

    socket.on('group_call_ice', ({ receiverId, groupId, candidate }) => {
      if (!receiverId || !candidate || !groupId) return;
      io.to(receiverId.toString()).emit('group_call_ice', {
        senderId: userId,
        groupId,
        candidate
      });
    });

    socket.on('group_call_end', ({ groupId }) => {
      if (!groupId) return;
      io.to(groupId.toString()).emit('group_call_end', {
        groupId,
        participantId: userId
      });
    });

    // Call signaling (1:1)
    socket.on('call_request', ({ receiverId, callType, offer }) => {
      if (!receiverId || !offer) return;
      io.to(receiverId.toString()).emit('call_request', {
        senderId: userId,
        callType,
        offer
      });
    });

    socket.on('call_answer', ({ receiverId, answer }) => {
      if (!receiverId || !answer) return;
      io.to(receiverId.toString()).emit('call_answer', {
        senderId: userId,
        answer
      });
    });

    socket.on('call_reject', ({ receiverId, reason }) => {
      if (!receiverId) return;
      io.to(receiverId.toString()).emit('call_reject', {
        senderId: userId,
        reason: reason || 'rejected'
      });
    });

    socket.on('call_end', ({ receiverId }) => {
      if (!receiverId) return;
      io.to(receiverId.toString()).emit('call_end', {
        senderId: userId
      });
    });

    socket.on('call_ice', ({ receiverId, candidate }) => {
      if (!receiverId || !candidate) return;
      io.to(receiverId.toString()).emit('call_ice', {
        senderId: userId,
        candidate
      });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      console.log(`User ${socket.user.username} disconnected`);

      // Notify friends
      socket.user.friends.forEach(friendId => {
        const friendSocketId = onlineUsers.get(friendId.toString());
        if (friendSocketId) {
          io.to(friendSocketId).emit('user_offline', userId);
        }
      });
    });
  });

  return io;
};
