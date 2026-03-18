const Group = require('../models/Group');
const Message = require('../models/Message');

const buildGroupPreview = async (groupId, userId) => {
  const lastMessage = await Message.findOne({ groupId })
    .sort({ createdAt: -1 })
    .populate('senderId', 'username profilePicture');

  const unreadCount = await Message.countDocuments({
    groupId,
    senderId: { $ne: userId },
    seenBy: { $ne: userId }
  });

  return {
    groupId: groupId.toString(),
    lastMessage: lastMessage || null,
    lastMessageTime: lastMessage?.createdAt || null,
    unreadCount
  };
};

const sanitizeMemberIds = (memberIds, currentUserId) => {
  const normalized = Array.isArray(memberIds)
    ? memberIds
    : memberIds
      ? [memberIds]
      : [];
  const ids = normalized.map((id) => id.toString());
  if (!ids.includes(currentUserId)) {
    ids.push(currentUserId);
  }
  return [...new Set(ids)];
};

// @desc    Get groups for current user with last message and unread count
// @route   GET /api/groups
const getGroups = async (req, res) => {
  const userId = req.user._id.toString();
  const groups = await Group.find({ members: userId })
    .populate('members', 'username email profilePicture')
    .populate('admins', 'username email profilePicture')
    .sort({ updatedAt: -1 });

  const previews = await Promise.all(groups.map(async (group) => {
    const preview = await buildGroupPreview(group._id, req.user._id);
    return {
      ...group.toObject(),
      lastMessage: preview.lastMessage,
      lastMessageTime: preview.lastMessageTime,
      unreadCount: preview.unreadCount
    };
  }));

  res.json(previews);
};

// @desc    Create a new group
// @route   POST /api/groups
const createGroup = async (req, res) => {
  const { name, memberIds } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ message: 'Group name is required' });
  }

  const userId = req.user._id.toString();
  const members = sanitizeMemberIds(memberIds, userId);
  const avatar = req.file ? `/uploads/${req.file.filename}` : (req.body.avatar || '');

  const group = await Group.create({
    name: name.trim(),
    avatar,
    createdBy: req.user._id,
    admins: [req.user._id],
    members
  });

  const populated = await Group.findById(group._id)
    .populate('members', 'username email profilePicture')
    .populate('admins', 'username email profilePicture');

  const io = req.app.get('io');
  if (io) {
    members.forEach((memberId) => {
      io.to(memberId.toString()).emit('group_created', populated);
    });
  }

  res.status(201).json(populated);
};

const isAdmin = (group, userId) => group.admins.some((id) => id.toString() === userId);

// @desc    Update group (name/avatar)
// @route   PUT /api/groups/:groupId
const updateGroup = async (req, res) => {
  const { groupId } = req.params;
  const group = await Group.findById(groupId);
  if (!group) {
    return res.status(404).json({ message: 'Group not found' });
  }

  const userId = req.user._id.toString();
  if (!isAdmin(group, userId)) {
    return res.status(403).json({ message: 'Only admins can update the group' });
  }

  if (req.body.name && req.body.name.trim()) {
    group.name = req.body.name.trim();
  }
  if (req.file) {
    group.avatar = `/uploads/${req.file.filename}`;
  } else if (req.body.avatar) {
    group.avatar = req.body.avatar;
  }

  await group.save();

  const populated = await Group.findById(group._id)
    .populate('members', 'username email profilePicture')
    .populate('admins', 'username email profilePicture');

  const io = req.app.get('io');
  if (io) {
    group.members.forEach((memberId) => {
      io.to(memberId.toString()).emit('group_updated', populated);
    });
  }

  res.json(populated);
};

// @desc    Add members to group
// @route   POST /api/groups/:groupId/members
const addMembers = async (req, res) => {
  const { groupId } = req.params;
  const { memberIds } = req.body;
  const group = await Group.findById(groupId);
  if (!group) {
    return res.status(404).json({ message: 'Group not found' });
  }

  const userId = req.user._id.toString();
  if (!isAdmin(group, userId)) {
    return res.status(403).json({ message: 'Only admins can add members' });
  }

  const normalized = Array.isArray(memberIds) ? memberIds : [];
  const nextMembers = normalized
    .map((id) => id.toString())
    .filter((id) => id !== userId);

  const existing = new Set(group.members.map((id) => id.toString()));
  nextMembers.forEach((id) => existing.add(id));
  group.members = Array.from(existing);

  await group.save();

  const populated = await Group.findById(group._id)
    .populate('members', 'username email profilePicture')
    .populate('admins', 'username email profilePicture');

  const io = req.app.get('io');
  if (io) {
    const addedMembers = nextMembers.filter((id) => id !== userId);
    addedMembers.forEach((memberId) => {
      io.to(memberId.toString()).emit('group_created', populated);
    });
    group.members.forEach((memberId) => {
      io.to(memberId.toString()).emit('group_updated', populated);
    });
  }

  res.json(populated);
};

// @desc    Remove a member from group
// @route   DELETE /api/groups/:groupId/members/:memberId
const removeMember = async (req, res) => {
  const { groupId, memberId } = req.params;
  const group = await Group.findById(groupId);
  if (!group) {
    return res.status(404).json({ message: 'Group not found' });
  }

  const userId = req.user._id.toString();
  if (!isAdmin(group, userId)) {
    return res.status(403).json({ message: 'Only admins can remove members' });
  }

  group.members = group.members.filter((id) => id.toString() !== memberId);
  group.admins = group.admins.filter((id) => id.toString() !== memberId);

  if (group.members.length === 0) {
    await Message.deleteMany({ groupId });
    await group.deleteOne();
    return res.json({ message: 'Group deleted' });
  }

  if (group.admins.length === 0) {
    group.admins = [req.user._id];
  }

  await group.save();

  const populated = await Group.findById(group._id)
    .populate('members', 'username email profilePicture')
    .populate('admins', 'username email profilePicture');

  const io = req.app.get('io');
  if (io) {
    io.to(memberId.toString()).emit('group_removed', { groupId });
    group.members.forEach((member) => {
      io.to(member.toString()).emit('group_updated', populated);
    });
  }

  res.json(populated);
};

// @desc    Leave a group
// @route   POST /api/groups/:groupId/leave
const leaveGroup = async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user._id.toString();
  const group = await Group.findById(groupId);
  if (!group) {
    return res.status(404).json({ message: 'Group not found' });
  }

  group.members = group.members.filter((id) => id.toString() !== userId);
  group.admins = group.admins.filter((id) => id.toString() !== userId);

  if (group.members.length === 0) {
    await Message.deleteMany({ groupId });
    await group.deleteOne();
    return res.json({ message: 'Group deleted' });
  }

  if (group.admins.length === 0) {
    group.admins = [group.members[0]];
  }

  await group.save();

  const populated = await Group.findById(group._id)
    .populate('members', 'username email profilePicture')
    .populate('admins', 'username email profilePicture');

  const io = req.app.get('io');
  if (io) {
    io.to(userId).emit('group_removed', { groupId });
    group.members.forEach((member) => {
      io.to(member.toString()).emit('group_updated', populated);
    });
  }

  res.json(populated);
};

// @desc    Delete group
// @route   DELETE /api/groups/:groupId
const deleteGroup = async (req, res) => {
  const { groupId } = req.params;
  const group = await Group.findById(groupId);
  if (!group) {
    return res.status(404).json({ message: 'Group not found' });
  }

  const userId = req.user._id.toString();
  if (!isAdmin(group, userId)) {
    return res.status(403).json({ message: 'Only admins can delete the group' });
  }

  await Message.deleteMany({ groupId });
  const members = group.members.map((id) => id.toString());
  await group.deleteOne();

  const io = req.app.get('io');
  if (io) {
    members.forEach((memberId) => {
      io.to(memberId).emit('group_deleted', { groupId });
    });
  }

  res.json({ message: 'Group deleted' });
};

// @desc    Get group messages
// @route   GET /api/groups/:groupId/messages
const getGroupMessages = async (req, res) => {
  const { groupId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const skip = (page - 1) * limit;

  const group = await Group.findById(groupId).select('members');
  if (!group) {
    return res.status(404).json({ message: 'Group not found' });
  }
  const isMember = group.members.some((id) => id.toString() === req.user._id.toString());
  if (!isMember) {
    return res.status(403).json({ message: 'You are not a member of this group' });
  }

  const messages = await Message.find({ groupId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10))
    .populate('senderId', 'username profilePicture');

  const total = await Message.countDocuments({ groupId });

  res.json({
    messages: messages.reverse(),
    page: parseInt(page, 10),
    totalPages: Math.ceil(total / limit),
    total
  });
};

// @desc    Mark group messages as seen by current user
// @route   PUT /api/groups/:groupId/seen
const markGroupSeen = async (req, res) => {
  const { groupId } = req.params;
  const group = await Group.findById(groupId).select('members');
  if (!group) {
    return res.status(404).json({ message: 'Group not found' });
  }
  const isMember = group.members.some((id) => id.toString() === req.user._id.toString());
  if (!isMember) {
    return res.status(403).json({ message: 'You are not a member of this group' });
  }
  await Message.updateMany(
    { groupId, seenBy: { $ne: req.user._id } },
    { $addToSet: { seenBy: req.user._id } }
  );
  res.json({ message: 'Group messages marked as seen' });
};

module.exports = {
  getGroups,
  createGroup,
  updateGroup,
  addMembers,
  removeMember,
  leaveGroup,
  deleteGroup,
  getGroupMessages,
  markGroupSeen
};
