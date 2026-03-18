import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import io from 'socket.io-client'
import api from '../api/axios'
import { useAuth } from '../App'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'https://natter-convo.onrender.com'
const EMOJI_OPTIONS = ['😀', '😂', '😍', '👍', '🙏', '🔥', '🎉', '❤️', '😊', '😎', '🤝', '😢', '😡', '👏', '💯', '🚀']

// Helper to get full image URL
const getFullImageUrl = (url) => {
  if (!url) return null
  if (url.startsWith('http')) return url
  return `${SOCKET_URL}${url}`
}

const getEntityId = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  return value._id || null
}

const normalizeFriend = (friend) => ({
  _id: getEntityId(friend) || `friend-${Math.random().toString(36).slice(2, 9)}`,
  username: friend?.username || 'Unknown User',
  email: friend?.email || '',
  profilePicture: friend?.profilePicture || '',
  lastMessage: friend?.lastMessage || null,
  lastMessageTime: friend?.lastMessageTime || null,
  unreadCount: Number(friend?.unreadCount || 0)
})

const normalizeGroup = (group) => ({
  _id: getEntityId(group) || `group-${Math.random().toString(36).slice(2, 9)}`,
  name: group?.name || 'Untitled Group',
  avatar: group?.avatar || '',
  members: Array.isArray(group?.members) ? group.members : [],
  admins: Array.isArray(group?.admins) ? group.admins : [],
  lastMessage: group?.lastMessage || null,
  lastMessageTime: group?.lastMessageTime || null,
  unreadCount: Number(group?.unreadCount || 0)
})

const normalizeMessage = (message) => ({
  ...message,
  _id: message?._id || `message-${Math.random().toString(36).slice(2, 9)}`,
  clientTempId: message?.clientTempId || null,
  senderId: message?.senderId || null,
  receiverId: message?.receiverId || null,
  message: message?.message || '',
  image: message?.image || '',
  audio: message?.audio || '',
  video: message?.video || '',
  createdAt: message?.createdAt || new Date().toISOString()
})

const getLastMessagePreview = (lastMessage) => {
  if (!lastMessage) return 'Start a conversation'
  if (typeof lastMessage === 'string') return lastMessage
  if (typeof lastMessage === 'object') {
    if (lastMessage.message) return lastMessage.message
    if (lastMessage.image) return 'Shared an image'
    if (lastMessage.audio) return 'Voice message'
    if (lastMessage.video) return 'Shared a video'
  }
  return 'Start a conversation'
}

const getConversationSearchScore = (friend, query) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return 0

  const username = (friend.username || '').toLowerCase()
  const email = (friend.email || '').toLowerCase()
  const preview = getLastMessagePreview(friend.lastMessage).toLowerCase()

  if (username === normalizedQuery) return 0
  if (username.startsWith(normalizedQuery)) return 1
  if (email.startsWith(normalizedQuery)) return 2
  if (username.includes(normalizedQuery)) return 3
  if (email.includes(normalizedQuery)) return 4
  if (preview.includes(normalizedQuery)) return 5
  return 99
}

const getGroupSearchScore = (group, query) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return 0

  const name = (group.name || '').toLowerCase()
  const preview = getLastMessagePreview(group.lastMessage).toLowerCase()

  if (name === normalizedQuery) return 0
  if (name.startsWith(normalizedQuery)) return 1
  if (name.includes(normalizedQuery)) return 2
  if (preview.includes(normalizedQuery)) return 3
  return 99
}
export default function Chat() {
  const { user, logout, updateUser, theme, toggleTheme } = useAuth()
  const [friends, setFriends] = useState([])
  const [groups, setGroups] = useState([])
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [socket, setSocket] = useState(null)
  const [onlineUsers, setOnlineUsers] = useState(new Set())
  const [typingFriend, setTypingFriend] = useState(null)
  const [showAddFriend, setShowAddFriend] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [showManageGroup, setShowManageGroup] = useState(false)
  const [conversationSearchQuery, setConversationSearchQuery] = useState('')
  const [friendSearchQuery, setFriendSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [groupSearchQuery, setGroupSearchQuery] = useState('')
  const [groupSearchResults, setGroupSearchResults] = useState([])
  const [groupSearchLoading, setGroupSearchLoading] = useState(false)
  const [groupNameInput, setGroupNameInput] = useState('')
  const [groupMembersInput, setGroupMembersInput] = useState([])
  const [groupAvatarFile, setGroupAvatarFile] = useState(null)
  const [groupToManage, setGroupToManage] = useState(null)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showClearChatConfirm, setShowClearChatConfirm] = useState(false)
  const [showRemoveFriendConfirm, setShowRemoveFriendConfirm] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [messageToDelete, setMessageToDelete] = useState(null)
  const [friendToRemove, setFriendToRemove] = useState(null)
  const [copiedMessageId, setCopiedMessageId] = useState(null)
  const [callState, setCallState] = useState('idle') // idle | outgoing | incoming | active
  const [callType, setCallType] = useState(null) // audio | video
  const [callPeer, setCallPeer] = useState(null)
  const [incomingCall, setIncomingCall] = useState(null)
  const [callError, setCallError] = useState('')
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [callStatus, setCallStatus] = useState('')
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [groupCallState, setGroupCallState] = useState('idle') // idle | incoming | active
  const [groupCallType, setGroupCallType] = useState(null) // audio | video
  const [incomingGroupCall, setIncomingGroupCall] = useState(null)
  const [groupLocalStream, setGroupLocalStream] = useState(null)
  const [groupRemoteStreams, setGroupRemoteStreams] = useState({})
  const [groupMuted, setGroupMuted] = useState(false)
  const [groupCameraOff, setGroupCameraOff] = useState(false)
  const [groupCallStatus, setGroupCallStatus] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const messagesEndRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const remoteTypingTimeoutRef = useRef(null)
  const fileInputRef = useRef(null)
  const profilePictureInputRef = useRef(null)
  const messageInputRef = useRef(null)
  const emojiPickerRef = useRef(null)
  const selectedFriendRef = useRef(null)
  const selectedGroupRef = useRef(null)
  const userRef = useRef(null)
  const friendsRef = useRef([])
  const peerConnectionRef = useRef(null)
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const callTimeoutRef = useRef(null)
  const groupPeersRef = useRef(new Map())
  const groupLocalStreamRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])

  useEffect(() => {
    selectedFriendRef.current = selectedFriend
    setTypingFriend(null)
  }, [selectedFriend])

  useEffect(() => {
    selectedGroupRef.current = selectedGroup
    setTypingFriend(null)
  }, [selectedGroup])

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    friendsRef.current = friends
  }, [friends])

  const updateFriendPreview = (friendId, latestMessage, { incrementUnread = false, resetUnread = false } = {}) => {
    setFriends(prev =>
      prev
        .map(friend =>
          friend._id === friendId
            ? {
                ...friend,
                lastMessage: normalizeMessage(latestMessage),
                lastMessageTime: latestMessage?.createdAt || new Date().toISOString(),
                unreadCount: resetUnread
                  ? 0
                  : incrementUnread
                    ? (friend.unreadCount || 0) + 1
                    : friend.unreadCount
              }
            : friend
        )
        .sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0))
    )
  }

  const updateGroupPreview = (groupId, latestMessage, { incrementUnread = false, resetUnread = false } = {}) => {
    setGroups(prev =>
      prev
        .map(group =>
          group._id === groupId
            ? {
                ...group,
                lastMessage: normalizeMessage(latestMessage),
                lastMessageTime: latestMessage?.createdAt || new Date().toISOString(),
                unreadCount: resetUnread
                  ? 0
                  : incrementUnread
                    ? (group.unreadCount || 0) + 1
                    : group.unreadCount
              }
            : group
        )
        .sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0))
    )
  }

  const appendOrReplaceMessage = (incomingMessage) => {
    const normalizedIncomingMessage = normalizeMessage(incomingMessage)

    setMessages(prev => {
      const existingIndex = prev.findIndex(message =>
        message._id === normalizedIncomingMessage._id ||
        (normalizedIncomingMessage.clientTempId &&
          message.clientTempId === normalizedIncomingMessage.clientTempId)
      )

      if (existingIndex >= 0) {
        const next = [...prev]
        next[existingIndex] = {
          ...next[existingIndex],
          ...normalizedIncomingMessage
        }
        return next
      }

      return [...prev, normalizedIncomingMessage]
    })

    const senderId = getEntityId(normalizedIncomingMessage.senderId)
    const receiverId = getEntityId(normalizedIncomingMessage.receiverId)
    const currentUserId = getEntityId(userRef.current)
    const activeFriendId = getEntityId(selectedFriendRef.current)
    const activeGroupId = getEntityId(selectedGroupRef.current)
    const groupId = getEntityId(normalizedIncomingMessage.groupId)
    const friendId = senderId === currentUserId ? receiverId : senderId

    if (groupId) {
      updateGroupPreview(groupId, normalizedIncomingMessage)
      if (activeGroupId && groupId === activeGroupId && senderId !== currentUserId) {
        api.put(`/api/groups/${activeGroupId}/seen`).catch((error) => {
          console.error('Error marking group messages as seen:', error)
        })
      }
    } else if (friendId) {
      updateFriendPreview(friendId, normalizedIncomingMessage)
      if (activeFriendId && senderId === activeFriendId && senderId !== currentUserId) {
        api.put(`/api/messages/seen/${activeFriendId}`).catch((error) => {
          console.error('Error marking messages as seen:', error)
        })
      }
    }
  }

  const mergeFriendIntoList = (friendData) => {
    const normalizedFriend = normalizeFriend(friendData)
    setFriends(prev => {
      const exists = prev.some(friend => friend._id === normalizedFriend._id)
      if (exists) {
        return prev.map(friend =>
          friend._id === normalizedFriend._id ? { ...friend, ...normalizedFriend } : friend
        )
      }
      return [...prev, normalizedFriend]
    })
  }

  const mergeGroupIntoList = (groupData) => {
    const normalizedGroup = normalizeGroup(groupData)
    setGroups(prev => {
      const exists = prev.some(group => group._id === normalizedGroup._id)
      if (exists) {
        return prev.map(group =>
          group._id === normalizedGroup._id ? { ...group, ...normalizedGroup } : group
        )
      }
      return [...prev, normalizedGroup]
    })
  }

  const applyProfileUpdate = (profileData) => {
    const userId = getEntityId(profileData)
    if (!userId) return

    if (userId === getEntityId(userRef.current)) {
      const nextUser = {
        ...userRef.current,
        ...profileData
      }
      updateUser(nextUser)
    }

    setFriends(prev =>
      prev.map(friend =>
        friend._id === userId
          ? {
              ...friend,
              username: profileData.username || friend.username,
              email: profileData.email || friend.email,
              profilePicture: profileData.profilePicture || ''
            }
          : friend
      )
    )

    setSelectedFriend(prev =>
      prev?._id === userId
        ? {
            ...prev,
            username: profileData.username || prev.username,
            email: profileData.email || prev.email,
            profilePicture: profileData.profilePicture || ''
          }
        : prev
    )
  }

  const removeFriendFromList = (friendId) => {
    setFriends(prev => prev.filter(friend => friend._id !== friendId))
    setSearchResults(prev => prev.filter(result => result._id !== friendId))
    setSelectedFriend(prev => (prev?._id === friendId ? null : prev))
  }

  const removeGroupFromList = (groupId) => {
    setGroups(prev => prev.filter(group => group._id !== groupId))
    setSelectedGroup(prev => (prev?._id === groupId ? null : prev))
  }

  const applyConversationPreview = (preview) => {
    if (!preview?.friendId) return

    setFriends(prev =>
      prev.map(friend =>
        friend._id === preview.friendId
          ? {
              ...friend,
              lastMessage: preview.lastMessage ? normalizeMessage(preview.lastMessage) : null,
              lastMessageTime: preview.lastMessageTime || null
            }
          : friend
      )
    )
  }

  const getCallPeerId = (peer) => {
    if (!peer) return null
    return typeof peer === 'string' ? peer : peer._id
  }

  const createPeerConnection = (peerId) => {
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })

    connection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('call_ice', { receiverId: peerId, candidate: event.candidate })
      }
    }

    connection.ontrack = (event) => {
      const [stream] = event.streams
      if (stream) {
        setRemoteStream(stream)
      }
    }

    if (localStream) {
      localStream.getTracks().forEach(track => {
        connection.addTrack(track, localStream)
      })
    }

    peerConnectionRef.current = connection
    return connection
  }

  const cleanupCall = () => {
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current)
      callTimeoutRef.current = null
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null
      peerConnectionRef.current.onicecandidate = null
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop())
    }
    setLocalStream(null)
    setRemoteStream(null)
    setCallState('idle')
    setCallType(null)
    setCallPeer(null)
    setIncomingCall(null)
    setCallError('')
    setIsMuted(false)
    setIsCameraOff(false)
    setCallStatus('')
    setIsScreenSharing(false)
  }

  const cleanupGroupCall = () => {
    groupPeersRef.current.forEach((peer) => {
      peer.ontrack = null
      peer.onicecandidate = null
      peer.close()
    })
    groupPeersRef.current.clear()

    if (groupLocalStream) {
      groupLocalStream.getTracks().forEach(track => track.stop())
    }
    groupLocalStreamRef.current = null

    setGroupLocalStream(null)
    setGroupRemoteStreams({})
    setGroupCallState('idle')
    setGroupCallType(null)
    setIncomingGroupCall(null)
    setGroupMuted(false)
    setGroupCameraOff(false)
    setGroupCallStatus('')
  }

  const startCall = async (type) => {
    if (!selectedFriend || !socket) return

    try {
      setCallStatus('Requesting access...')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video'
      })
      setLocalStream(stream)
      setCallType(type)
      setCallPeer(selectedFriend)
      setCallState('outgoing')
      setCallError('')
      setIsMuted(false)
      setIsCameraOff(false)
      setCallStatus('Calling...')

      const peerId = selectedFriend._id
      const connection = createPeerConnection(peerId)
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)

      socket.emit('call_request', {
        receiverId: peerId,
        callType: type,
        offer
      })

      callTimeoutRef.current = setTimeout(() => {
        setCallError('No answer. Call ended.')
        endCall()
      }, 30000)
    } catch (error) {
      console.error('Error starting call:', error)
      setCallError('Unable to access microphone/camera.')
      cleanupCall()
    }
  }

  const acceptCall = async () => {
    if (!incomingCall || !socket) return

    try {
      setCallStatus('Connecting...')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incomingCall.callType === 'video'
      })
      setLocalStream(stream)
      setCallType(incomingCall.callType)
      setCallPeer({ _id: incomingCall.senderId })
      setCallState('active')
      setCallError('')
      setIsMuted(false)
      setIsCameraOff(false)

      const connection = createPeerConnection(incomingCall.senderId)
      await connection.setRemoteDescription(new RTCSessionDescription(incomingCall.offer))
      const answer = await connection.createAnswer()
      await connection.setLocalDescription(answer)

      socket.emit('call_answer', {
        receiverId: incomingCall.senderId,
        answer
      })
      setIncomingCall(null)
      setCallStatus('In call')
    } catch (error) {
      console.error('Error accepting call:', error)
      setCallError('Unable to answer the call.')
      cleanupCall()
    }
  }

  const rejectCall = () => {
    if (!incomingCall || !socket) return
    socket.emit('call_reject', {
      receiverId: incomingCall.senderId,
      reason: 'rejected'
    })
    setIncomingCall(null)
    cleanupCall()
  }

  const endCall = () => {
    const peerId = getCallPeerId(callPeer) || incomingCall?.senderId
    if (peerId && socket) {
      socket.emit('call_end', { receiverId: peerId })
    }
    cleanupCall()
  }

  const toggleMute = () => {
    if (!localStream) return
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled
    })
    setIsMuted(prev => !prev)
  }

  const toggleCamera = () => {
    if (!localStream) return
    localStream.getVideoTracks().forEach(track => {
      track.enabled = !track.enabled
    })
    setIsCameraOff(prev => !prev)
  }

  const getMemberName = (memberId) => {
    const group = selectedGroupRef.current
    const member = group?.members?.find(item => getEntityId(item) === memberId)
    return member?.username || 'Member'
  }

  const createGroupPeerConnection = (peerId, groupId) => {
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })

    connection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('group_call_ice', {
          receiverId: peerId,
          groupId,
          candidate: event.candidate
        })
      }
    }

    connection.ontrack = (event) => {
      const [stream] = event.streams
      if (stream) {
        setGroupRemoteStreams(prev => ({
          ...prev,
          [peerId]: stream
        }))
      } else if (event.track) {
        setGroupRemoteStreams(prev => {
          const existing = prev[peerId] || new MediaStream()
          existing.addTrack(event.track)
          return {
            ...prev,
            [peerId]: existing
          }
        })
      }
    }

    const activeStream = groupLocalStreamRef.current || groupLocalStream
    if (activeStream) {
      activeStream.getTracks().forEach(track => {
        connection.addTrack(track, activeStream)
      })
    }

    groupPeersRef.current.set(peerId, connection)
    return connection
  }

  const startGroupCall = async (type) => {
    if (!selectedGroup || !socket) return
    try {
      setGroupCallStatus('Requesting access...')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video'
      })
      setGroupLocalStream(stream)
      setGroupCallType(type)
      setGroupCallState('active')
      setGroupMuted(false)
      setGroupCameraOff(false)
      setGroupCallStatus('Connecting...')

      socket.emit('group_call_start', {
        groupId: selectedGroup._id,
        callType: type
      })

      socket.emit('group_call_join', { groupId: selectedGroup._id })
    } catch (error) {
      console.error('Error starting group call:', error)
      cleanupGroupCall()
    }
  }

  const acceptGroupCall = async () => {
    if (!incomingGroupCall || !socket) return
    try {
      setGroupCallStatus('Connecting...')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incomingGroupCall.callType === 'video'
      })
      setGroupLocalStream(stream)
      setGroupCallType(incomingGroupCall.callType)
      setGroupCallState('active')
      setGroupMuted(false)
      setGroupCameraOff(false)

      socket.emit('group_call_join', { groupId: incomingGroupCall.groupId })
      setIncomingGroupCall(null)
      setGroupCallStatus('In call')
    } catch (error) {
      console.error('Error accepting group call:', error)
      cleanupGroupCall()
    }
  }

  const rejectGroupCall = () => {
    setIncomingGroupCall(null)
    cleanupGroupCall()
  }

  const endGroupCall = () => {
    if (selectedGroupRef.current?._id && socket) {
      socket.emit('group_call_end', { groupId: selectedGroupRef.current._id })
    }
    cleanupGroupCall()
  }

  const toggleGroupMute = () => {
    if (!groupLocalStream) return
    groupLocalStream.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled
    })
    setGroupMuted(prev => !prev)
  }

  const toggleGroupCamera = () => {
    if (!groupLocalStream) return
    groupLocalStream.getVideoTracks().forEach(track => {
      track.enabled = !track.enabled
    })
    setGroupCameraOff(prev => !prev)
  }

  const toggleScreenShare = async () => {
    if (!peerConnectionRef.current) return

    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        const screenTrack = screenStream.getVideoTracks()[0]
        const sender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video')
        if (sender && screenTrack) {
          await sender.replaceTrack(screenTrack)
        }

        setIsScreenSharing(true)
        setIsCameraOff(false)
        setLocalStream(prev => {
          if (!prev) return prev
          const audioTracks = prev.getAudioTracks()
          const nextStream = new MediaStream([...audioTracks, screenTrack])
          return nextStream
        })

        screenTrack.onended = async () => {
          try {
            const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
            const cameraTrack = cameraStream.getVideoTracks()[0]
            const senderRestore = peerConnectionRef.current?.getSenders().find(s => s.track?.kind === 'video')
            if (senderRestore && cameraTrack) {
              await senderRestore.replaceTrack(cameraTrack)
            }

            setLocalStream(prev => {
              if (!prev) return prev
              const audioTracks = prev.getAudioTracks()
              return new MediaStream([...audioTracks, cameraTrack])
            })
          } catch (error) {
            console.error('Error restoring camera after screen share:', error)
          } finally {
            setIsScreenSharing(false)
          }
        }
      } catch (error) {
        console.error('Error starting screen share:', error)
      }
    } else {
      const sender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video')
      if (!sender) return
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        const cameraTrack = cameraStream.getVideoTracks()[0]
        await sender.replaceTrack(cameraTrack)
        setLocalStream(prev => {
          if (!prev) return prev
          const audioTracks = prev.getAudioTracks()
          return new MediaStream([...audioTracks, cameraTrack])
        })
      } catch (error) {
        console.error('Error stopping screen share:', error)
      } finally {
        setIsScreenSharing(false)
      }
    }
  }

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      auth: { token: localStorage.getItem('token') },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    })

    newSocket.on('connect', () => {
      console.log('Connected to socket server')
    })

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message)
    })

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason)
    })

    newSocket.on('user_online', (userId) => {
      setOnlineUsers(prev => new Set([...prev, userId]))
    })

    newSocket.on('user_offline', (userId) => {
      setOnlineUsers(prev => {
        const newSet = new Set(prev)
        newSet.delete(userId)
        return newSet
      })
    })

    newSocket.on('receive_message', (message) => {
      const activeFriend = selectedFriendRef.current
      const currentUser = userRef.current
      const senderId = getEntityId(message.senderId)
      const receiverId = getEntityId(message.receiverId)
      const isActiveChatMessage =
        activeFriend &&
        currentUser &&
        ((senderId === activeFriend._id && receiverId === currentUser._id) ||
          (senderId === currentUser._id && receiverId === activeFriend._id))

      if (isActiveChatMessage) {
        appendOrReplaceMessage(message)
      } else {
        const friendId = senderId === currentUser?._id ? receiverId : senderId
        if (friendId) {
          updateFriendPreview(friendId, message, {
            incrementUnread: senderId !== currentUser?._id
          })
        }
      }
    })

    newSocket.on('message_sent', (message) => {
      appendOrReplaceMessage(message)
    })

    newSocket.on('typing', ({ senderId, isTyping }) => {
      const activeFriend = selectedFriendRef.current
      if (activeFriend && senderId === activeFriend._id) {
        if (remoteTypingTimeoutRef.current) {
          clearTimeout(remoteTypingTimeoutRef.current)
        }

        if (isTyping) {
          setTypingFriend(senderId)
          remoteTypingTimeoutRef.current = setTimeout(() => {
            setTypingFriend(null)
          }, 2500)
        } else {
          setTypingFriend(null)
        }
      }
    })

    newSocket.on('friend_added', (friendData) => {
      mergeFriendIntoList(friendData)
    })

    newSocket.on('friend_removed', ({ friendId }) => {
      removeFriendFromList(friendId)
    })

    newSocket.on('group_created', (groupData) => {
      mergeGroupIntoList(groupData)
      if (groupData?._id) {
        newSocket.emit('join_group', groupData._id)
      }
    })

    newSocket.on('group_updated', (groupData) => {
      mergeGroupIntoList(groupData)
      if (groupData?._id) {
        newSocket.emit('join_group', groupData._id)
      }
    })

    newSocket.on('group_deleted', ({ groupId }) => {
      removeGroupFromList(groupId)
      if (groupId) {
        newSocket.emit('leave_group', groupId)
      }
    })

    newSocket.on('group_removed', ({ groupId }) => {
      removeGroupFromList(groupId)
      if (groupId) {
        newSocket.emit('leave_group', groupId)
      }
    })

    newSocket.on('group_message', (message) => {
      const activeGroup = selectedGroupRef.current
      if (activeGroup && message.groupId && getEntityId(message.groupId) === activeGroup._id) {
        appendOrReplaceMessage(message)
      } else if (message.groupId) {
        updateGroupPreview(getEntityId(message.groupId), message, { incrementUnread: true })
      }
    })

    newSocket.on('group_message_deleted', ({ messageId }) => {
      setMessages(prev => prev.filter(message => message._id !== messageId))
    })

    newSocket.on('message_deleted', ({ messageId, previews }) => {
      setMessages(prev => prev.filter(message => message._id !== messageId))
      previews?.forEach(applyConversationPreview)
    })

    newSocket.on('call_request', ({ senderId, callType, offer }) => {
      if (callState !== 'idle') {
        newSocket.emit('call_reject', { receiverId: senderId, reason: 'busy' })
        return
      }
      const knownFriend = friendsRef.current.find(friend => friend._id === senderId)
      setIncomingCall({ senderId, callType, offer })
      setCallState('incoming')
      setCallType(callType)
      setCallPeer(knownFriend || { _id: senderId, username: 'Unknown' })
      setCallError('')
    })

    newSocket.on('call_answer', async ({ answer }) => {
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer))
          setCallState('active')
          setCallStatus('In call')
          if (callTimeoutRef.current) {
            clearTimeout(callTimeoutRef.current)
            callTimeoutRef.current = null
          }
        }
      } catch (error) {
        console.error('Error handling call answer:', error)
      }
    })

    newSocket.on('call_reject', () => {
      setCallError('Call rejected.')
      cleanupCall()
    })

    newSocket.on('call_end', () => {
      setCallError('Call ended.')
      cleanupCall()
    })

    newSocket.on('call_ice', async ({ candidate }) => {
      try {
        if (peerConnectionRef.current && candidate) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
        }
      } catch (error) {
        console.error('Error adding ICE candidate:', error)
      }
    })

    newSocket.on('group_call_start', ({ groupId, callType, callerId }) => {
      const activeGroup = selectedGroupRef.current
      if (!activeGroup || activeGroup._id !== groupId) return
      if (groupCallState !== 'idle') return
      if (callerId === userRef.current?._id) return
      setIncomingGroupCall({ groupId, callType, callerId })
      setGroupCallType(callType)
      setGroupCallState('incoming')
      setGroupCallStatus('Incoming group call...')
    })

    newSocket.on('group_call_join', async ({ groupId, participantId }) => {
      const activeGroup = selectedGroupRef.current
      if (!activeGroup || activeGroup._id !== groupId) return
      if (!groupLocalStream) return
      if (participantId === userRef.current?._id) return

      try {
        const connection = createGroupPeerConnection(participantId, groupId)
        const offer = await connection.createOffer()
        await connection.setLocalDescription(offer)
        newSocket.emit('group_call_offer', {
          receiverId: participantId,
          groupId,
          offer
        })
      } catch (error) {
        console.error('Error creating group offer:', error)
      }
    })

    newSocket.on('group_call_offer', async ({ senderId, groupId, offer }) => {
      const activeGroup = selectedGroupRef.current
      if (!activeGroup || activeGroup._id !== groupId) return
      if (!groupLocalStream) return
      if (senderId === userRef.current?._id) return

      try {
        let connection = groupPeersRef.current.get(senderId)
        if (!connection) {
          connection = createGroupPeerConnection(senderId, groupId)
        }
        await connection.setRemoteDescription(new RTCSessionDescription(offer))
        const answer = await connection.createAnswer()
        await connection.setLocalDescription(answer)
        newSocket.emit('group_call_answer', {
          receiverId: senderId,
          groupId,
          answer
        })
      } catch (error) {
        console.error('Error handling group offer:', error)
      }
    })

    newSocket.on('group_call_answer', async ({ senderId, groupId, answer }) => {
      const activeGroup = selectedGroupRef.current
      if (!activeGroup || activeGroup._id !== groupId) return
      try {
        const connection = groupPeersRef.current.get(senderId)
        if (connection) {
          await connection.setRemoteDescription(new RTCSessionDescription(answer))
        }
      } catch (error) {
        console.error('Error handling group answer:', error)
      }
    })

    newSocket.on('group_call_ice', async ({ senderId, groupId, candidate }) => {
      const activeGroup = selectedGroupRef.current
      if (!activeGroup || activeGroup._id !== groupId) return
      try {
        const connection = groupPeersRef.current.get(senderId)
        if (connection && candidate) {
          await connection.addIceCandidate(new RTCIceCandidate(candidate))
        }
      } catch (error) {
        console.error('Error handling group ICE:', error)
      }
    })

    newSocket.on('group_call_end', ({ groupId, participantId }) => {
      const activeGroup = selectedGroupRef.current
      if (!activeGroup || activeGroup._id !== groupId) return
      if (participantId && groupPeersRef.current.has(participantId)) {
        const connection = groupPeersRef.current.get(participantId)
        connection.close()
        groupPeersRef.current.delete(participantId)
        setGroupRemoteStreams(prev => {
          const next = { ...prev }
          delete next[participantId]
          return next
        })
      } else if (!participantId) {
        cleanupGroupCall()
      }
    })

    newSocket.on('profile_updated', (profileData) => {
      applyProfileUpdate(profileData)
    })

    setSocket(newSocket)

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
      if (remoteTypingTimeoutRef.current) {
        clearTimeout(remoteTypingTimeoutRef.current)
      }
      newSocket.disconnect()
    }
  }, [])

  // Fetch friends
  useEffect(() => {
    const fetchFriends = async () => {
      try {
        const response = await api.get('/api/friends')
        const normalizedFriends = Array.isArray(response.data)
          ? response.data.map(normalizeFriend)
          : []
        setFriends(normalizedFriends.sort((a, b) => {
          const timeA = a.lastMessage?.createdAt || a.lastMessageTime || a.updatedAt
          const timeB = b.lastMessage?.createdAt || b.lastMessageTime || b.updatedAt
          return new Date(timeB) - new Date(timeA)
        }))
      } catch (err) {
        console.error('Error fetching friends:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchFriends()
  }, [])

  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const response = await api.get('/api/groups')
        const normalizedGroups = Array.isArray(response.data)
          ? response.data.map(normalizeGroup)
          : []
        setGroups(normalizedGroups.sort((a, b) => {
          const timeA = a.lastMessage?.createdAt || a.lastMessageTime || a.updatedAt
          const timeB = b.lastMessage?.createdAt || b.lastMessageTime || b.updatedAt
          return new Date(timeB) - new Date(timeA)
        }))
      } catch (err) {
        console.error('Error fetching groups:', err)
      }
    }
    fetchGroups()
  }, [])

  useEffect(() => {
    if (!socket) return
    groups.forEach((group) => {
      if (group?._id) {
        socket.emit('join_group', group._id)
      }
    })
  }, [groups, socket])

  // Fetch messages when friend is selected
  useEffect(() => {
    const fetchMessages = async () => {
      if (selectedGroup) {
        try {
          const response = await api.get(`/api/groups/${selectedGroup._id}/messages`)
          setMessages(Array.isArray(response.data?.messages) ? response.data.messages.map(normalizeMessage) : [])
          await api.put(`/api/groups/${selectedGroup._id}/seen`)
          updateGroupPreview(selectedGroup._id, response.data?.messages?.slice(-1)?.[0] || null, { resetUnread: true })
        } catch (err) {
          console.error('Error fetching group messages:', err)
        }
        return
      }

      if (!selectedFriend) return
      try {
        const response = await api.get(`/api/messages/${selectedFriend._id}`)
        setMessages(Array.isArray(response.data?.messages) ? response.data.messages.map(normalizeMessage) : [])
        // Mark messages as seen
        await api.put(`/api/messages/seen/${selectedFriend._id}`)
        updateFriendPreview(selectedFriend._id, response.data?.messages?.slice(-1)?.[0] || null, { resetUnread: true })
      } catch (err) {
        console.error('Error fetching messages:', err)
      }
    }
    fetchMessages()
  }, [selectedFriend, selectedGroup])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  useEffect(() => {
    if (!groupLocalStream) return
    if (localVideoRef.current && groupCallType === 'video') {
      localVideoRef.current.srcObject = groupLocalStream
    }
    groupLocalStreamRef.current = groupLocalStream
    groupPeersRef.current.forEach((connection) => {
      const existingTracks = connection.getSenders().map(sender => sender.track?.id).filter(Boolean)
      groupLocalStream.getTracks().forEach(track => {
        if (!existingTracks.includes(track.id)) {
          connection.addTrack(track, groupLocalStream)
        }
      })
    })
  }, [groupLocalStream, groupCallType])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!showEmojiPicker) return
      if (emojiPickerRef.current?.contains(event.target)) return
      setShowEmojiPicker(false)
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [showEmojiPicker])

  // Handle typing
  const handleTyping = (e) => {
    const nextValue = e.target.value
    setNewMessage(nextValue)
    
    if (socket && selectedFriend && !selectedGroup) {
      socket.emit('typing', { receiverId: selectedFriend._id, isTyping: true })
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
      
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing', { receiverId: selectedFriend._id, isTyping: false })
      }, 2000)
    }
  }

  // Send message
  const sendMessage = async (e) => {
    e.preventDefault()
    if (!newMessage.trim() || !socket) return

    if (selectedGroup) {
      const messageData = {
        groupId: selectedGroup._id,
        message: newMessage.trim(),
        clientTempId: `temp-${Date.now()}`
      }

      try {
        socket.emit('send_group_message', messageData)
        setNewMessage('')

        const tempMessage = {
          ...messageData,
          senderId: { _id: user._id, username: user.username },
          receiverId: user._id,
          groupId: selectedGroup._id,
          createdAt: new Date().toISOString(),
          _id: messageData.clientTempId
        }
        appendOrReplaceMessage(tempMessage)
      } catch (err) {
        console.error('Error sending group message:', err)
      }
      return
    }

    if (!selectedFriend) return

    const messageData = {
      receiverId: selectedFriend._id,
      message: newMessage.trim(),
      clientTempId: `temp-${Date.now()}`
    }

    // Clear typing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
      socket.emit('typing', { receiverId: selectedFriend._id, isTyping: false })
    }

    try {
      socket.emit('send_message', messageData)
      setNewMessage('')
      setTypingFriend(null)
      
      // Optimistically add message to UI
      const tempMessage = {
        ...messageData,
        senderId: { _id: user._id, username: user.username },
        receiverId: selectedFriend._id,
        createdAt: new Date().toISOString(),
        _id: messageData.clientTempId
      }
      appendOrReplaceMessage(tempMessage)
    } catch (err) {
      console.error('Error sending message:', err)
    }
  }

  // Handle file upload (image/video)
  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file || !socket) return

    const formData = new FormData()
    formData.append('image', file)

    try {
      const response = await api.post('/api/messages/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      const isVideo = file.type.startsWith('video/')

      if (selectedGroup) {
        const messageData = {
          groupId: selectedGroup._id,
          message: '',
          image: isVideo ? '' : response.data.fileUrl,
          video: isVideo ? response.data.fileUrl : '',
          clientTempId: `temp-${Date.now()}`
        }

        socket.emit('send_group_message', messageData)

        const tempMessage = {
          ...messageData,
          senderId: { _id: user._id, username: user.username },
          receiverId: user._id,
          groupId: selectedGroup._id,
          createdAt: new Date().toISOString(),
          _id: messageData.clientTempId
        }
        appendOrReplaceMessage(tempMessage)
      } else if (selectedFriend) {
        const messageData = {
          receiverId: selectedFriend._id,
          message: '',
          image: isVideo ? '' : response.data.fileUrl,
          video: isVideo ? response.data.fileUrl : '',
          clientTempId: `temp-${Date.now()}`
        }

        socket.emit('send_message', messageData)

        const tempMessage = {
          ...messageData,
          senderId: { _id: user._id, username: user.username },
          receiverId: selectedFriend._id,
          createdAt: new Date().toISOString(),
          _id: messageData.clientTempId
        }
        appendOrReplaceMessage(tempMessage)
      }
    } catch (err) {
      console.error('Error uploading file:', err)
    }

    // Reset file input
    e.target.value = ''
  }

  const startRecording = async () => {
    if (isRecording || !socket) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const formData = new FormData()
        formData.append('image', audioBlob, `voice-${Date.now()}.webm`)

        try {
          const response = await api.post('/api/messages/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          })

          if (selectedGroup) {
            const messageData = {
              groupId: selectedGroup._id,
              message: '',
              audio: response.data.fileUrl,
              clientTempId: `temp-${Date.now()}`
            }

            socket.emit('send_group_message', messageData)

            const tempMessage = {
              ...messageData,
              senderId: { _id: user._id, username: user.username },
              receiverId: user._id,
              groupId: selectedGroup._id,
              createdAt: new Date().toISOString(),
              _id: messageData.clientTempId
            }
            appendOrReplaceMessage(tempMessage)
          } else if (selectedFriend) {
            const messageData = {
              receiverId: selectedFriend._id,
              message: '',
              audio: response.data.fileUrl,
              clientTempId: `temp-${Date.now()}`
            }

            socket.emit('send_message', messageData)

            const tempMessage = {
              ...messageData,
              senderId: { _id: user._id, username: user.username },
              receiverId: selectedFriend._id,
              createdAt: new Date().toISOString(),
              _id: messageData.clientTempId
            }
            appendOrReplaceMessage(tempMessage)
          }
        } catch (error) {
          console.error('Error uploading voice message:', error)
        } finally {
          stream.getTracks().forEach(track => track.stop())
        }
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
    } catch (error) {
      console.error('Error starting voice recording:', error)
    }
  }

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return
    mediaRecorderRef.current.stop()
    setIsRecording(false)
  }

  // Delete user account
  const deleteAccount = async () => {
    try {
      await api.delete('/api/users/profile')
      logout()
    } catch (err) {
      console.error('Error deleting account:', err)
    }
  }

  // Clear chat with a friend
  const clearChat = async () => {
    try {
      await api.delete(`/api/messages/${selectedFriend._id}`)
      setMessages([])
      setShowClearChatConfirm(false)
    } catch (err) {
      console.error('Error clearing chat:', err)
    }
  }

  // Remove a friend
  const removeFriend = async () => {
    const targetFriend = friendToRemove || selectedFriend
    if (!targetFriend) return

    try {
      await api.delete(`/api/friends/${targetFriend._id}`)
      removeFriendFromList(targetFriend._id)
      setFriendToRemove(null)
      setShowRemoveFriendConfirm(false)
    } catch (err) {
      console.error('Error removing friend:', err)
    }
  }

  const insertEmoji = (emoji) => {
    const textarea = messageInputRef.current
    const start = textarea?.selectionStart ?? newMessage.length
    const end = textarea?.selectionEnd ?? newMessage.length
    const nextMessage = `${newMessage.slice(0, start)}${emoji}${newMessage.slice(end)}`

    setNewMessage(nextMessage)
    setShowEmojiPicker(false)

    requestAnimationFrame(() => {
      if (!textarea) return
      textarea.focus()
      const cursorPosition = start + emoji.length
      textarea.setSelectionRange(cursorPosition, cursorPosition)
    })
  }

  const deleteMessage = async () => {
    if (!messageToDelete?._id) return

    try {
      const response = await api.delete(`/api/messages/item/${messageToDelete._id}`)
      setMessages(prev => prev.filter(message => message._id !== messageToDelete._id))
      response.data?.previews?.forEach(applyConversationPreview)
      setMessageToDelete(null)
    } catch (err) {
      console.error('Error deleting message:', err)
    }
  }

  const copyMessage = async (message) => {
    if (!message?.message) return

    try {
      await navigator.clipboard.writeText(message.message)
      setCopiedMessageId(message._id)
      setTimeout(() => {
        setCopiedMessageId(current => (current === message._id ? null : current))
      }, 1500)
    } catch (error) {
      console.error('Error copying message:', error)
    }
  }

  const handleProfilePictureUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('profilePicture', file)

    try {
      const response = await api.put('/api/users/profile', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
      applyProfileUpdate(response.data)
      setShowProfileMenu(false)
    } catch (error) {
      console.error('Error updating profile picture:', error)
    } finally {
      event.target.value = ''
    }
  }

  useEffect(() => {
    if (!showAddFriend) {
      return
    }

    let cancelled = false

    const fetchSuggestions = async () => {
      setSearchLoading(true)

      try {
        const query = friendSearchQuery.trim()
        const endpoint = query
          ? `/api/users/search?q=${encodeURIComponent(query)}&limit=50`
          : '/api/users/search?limit=50'
        const response = await api.get(endpoint)

        if (!cancelled) {
          setSearchResults(Array.isArray(response.data) ? response.data.map(normalizeFriend) : [])
        }
      } catch (err) {
        console.error('Error searching users:', err)
        if (!cancelled) {
          setSearchResults([])
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false)
        }
      }
    }

    const timeoutId = setTimeout(fetchSuggestions, friendSearchQuery.trim() ? 250 : 0)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [friendSearchQuery, showAddFriend])

  useEffect(() => {
    if (!showCreateGroup && !showManageGroup) {
      return
    }

    let cancelled = false

    const fetchGroupSuggestions = async () => {
      setGroupSearchLoading(true)

      try {
        const query = groupSearchQuery.trim()
        const endpoint = query
          ? `/api/users/search?scope=all&q=${encodeURIComponent(query)}`
          : '/api/users/search?scope=all'
        const response = await api.get(endpoint)

        if (!cancelled) {
          setGroupSearchResults(Array.isArray(response.data) ? response.data.map(normalizeFriend) : [])
        }
      } catch (err) {
        console.error('Error searching users for group:', err)
        if (!cancelled) {
          setGroupSearchResults([])
        }
      } finally {
        if (!cancelled) {
          setGroupSearchLoading(false)
        }
      }
    }

    const timeoutId = setTimeout(fetchGroupSuggestions, groupSearchQuery.trim() ? 250 : 0)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [groupSearchQuery, showCreateGroup, showManageGroup])

  useEffect(() => {
    if (!groupToManage) return
    const updated = groups.find(group => group._id === groupToManage._id)
    if (updated) {
      setGroupToManage(updated)
    }
  }, [groups, groupToManage])

  // Add friend
  const addFriend = async (userToAdd) => {
    try {
      const response = await api.post('/api/friends/add', { friendId: userToAdd._id })
      mergeFriendIntoList(response.data.friend)
      setSearchResults([])
      setFriendSearchQuery('')
      setShowAddFriend(false)
    } catch (err) {
      console.error('Error adding friend:', err)
    }
  }

  const createGroup = async () => {
    if (!groupNameInput.trim()) return

    try {
      const formData = new FormData()
      formData.append('name', groupNameInput.trim())
      if (groupMembersInput.length > 0) {
        const memberIds = groupMembersInput.map(member => member._id)
        memberIds.forEach(id => formData.append('memberIds', id))
      }
      if (groupAvatarFile) {
        formData.append('avatar', groupAvatarFile)
      }

      const response = await api.post('/api/groups', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      mergeGroupIntoList(response.data)
      setShowCreateGroup(false)
      setGroupNameInput('')
      setGroupMembersInput([])
      setGroupAvatarFile(null)
      setGroupSearchQuery('')
      setGroupSearchResults([])
    } catch (err) {
      console.error('Error creating group:', err)
    }
  }

  const updateGroup = async () => {
    if (!groupToManage) return

    try {
      const formData = new FormData()
      if (groupNameInput.trim()) {
        formData.append('name', groupNameInput.trim())
      }
      if (groupAvatarFile) {
        formData.append('avatar', groupAvatarFile)
      }

      const response = await api.put(`/api/groups/${groupToManage._id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      mergeGroupIntoList(response.data)
      setShowManageGroup(false)
      setGroupToManage(null)
      setGroupNameInput('')
      setGroupAvatarFile(null)
    } catch (err) {
      console.error('Error updating group:', err)
    }
  }

  const addGroupMembers = async (members) => {
    if (!groupToManage) return
    if (!members.length) return

    try {
      const memberIds = members.map(member => member._id)
      const response = await api.post(`/api/groups/${groupToManage._id}/members`, { memberIds })
      mergeGroupIntoList(response.data)
      setGroupSearchQuery('')
      setGroupSearchResults([])
    } catch (err) {
      console.error('Error adding group members:', err)
    }
  }

  const removeGroupMember = async (memberId) => {
    if (!groupToManage) return

    try {
      const response = await api.delete(`/api/groups/${groupToManage._id}/members/${memberId}`)
      mergeGroupIntoList(response.data)
    } catch (err) {
      console.error('Error removing group member:', err)
    }
  }

  const leaveGroup = async (groupId) => {
    try {
      await api.post(`/api/groups/${groupId}/leave`)
      removeGroupFromList(groupId)
      setShowManageGroup(false)
    } catch (err) {
      console.error('Error leaving group:', err)
    }
  }

  const deleteGroup = async (groupId) => {
    try {
      await api.delete(`/api/groups/${groupId}`)
      removeGroupFromList(groupId)
      setShowManageGroup(false)
    } catch (err) {
      console.error('Error deleting group:', err)
    }
  }

  // Get initials
  const getInitials = (name) => {
    return name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
  }

  // Format time
  const formatTime = (date) => {
    if (!date) return ''
    const d = new Date(date)
    const now = new Date()
    const diff = now - d
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (days === 1) {
      return 'Yesterday'
    } else if (days < 7) {
      return d.toLocaleDateString([], { weekday: 'short' })
    } else {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  }

  const isOnline = (friendId) => onlineUsers.has(friendId)
  const currentUserId = getEntityId(user)
  const normalizedConversationQuery = conversationSearchQuery.trim().toLowerCase()
  const filteredFriends = friends
    .filter(friend => getConversationSearchScore(friend, normalizedConversationQuery) !== 99)
    .sort((a, b) => {
      const scoreDifference =
        getConversationSearchScore(a, normalizedConversationQuery) -
        getConversationSearchScore(b, normalizedConversationQuery)

      if (scoreDifference !== 0) {
        return scoreDifference
      }

      const timeA = new Date(a.lastMessage?.createdAt || a.lastMessageTime || 0)
      const timeB = new Date(b.lastMessage?.createdAt || b.lastMessageTime || 0)
      return timeB - timeA
    })

  const filteredGroups = groups
    .filter(group => getGroupSearchScore(group, normalizedConversationQuery) !== 99)
    .sort((a, b) => {
      const scoreDifference =
        getGroupSearchScore(a, normalizedConversationQuery) -
        getGroupSearchScore(b, normalizedConversationQuery)

      if (scoreDifference !== 0) {
        return scoreDifference
      }

      const timeA = new Date(a.lastMessage?.createdAt || a.lastMessageTime || 0)
      const timeB = new Date(b.lastMessage?.createdAt || b.lastMessageTime || 0)
      return timeB - timeA
    })

  const canManageSelectedGroup = groupToManage?.admins?.some(
    (admin) => getEntityId(admin) === currentUserId
  )

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <motion.aside 
        className="sidebar"
        initial={{ x: -300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="sidebar-header">
          <div className="sidebar-user">
            <motion.div 
              className="user-avatar"
              whileHover={{ scale: 1.05 }}
            >
              {user?.profilePicture ? (
                <img src={getFullImageUrl(user.profilePicture)} alt={user?.username || 'Profile'} />
              ) : (
                getInitials(user?.username)
              )}
              <span className="online-indicator"></span>
            </motion.div>
            <div className="user-info">
              <h3>{user?.username}</h3>
              <p>Online</p>
            </div>
            <div className="profile-dropdown" style={{ marginLeft: 'auto' }}>
              <motion.button
                className="btn btn-ghost btn-icon"
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <i className="fas fa-ellipsis-v"></i>
              </motion.button>
              <AnimatePresence>
                {showProfileMenu && (
                  <motion.div
                    className="profile-menu"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    <button onClick={() => setShowDeleteConfirm(true)}>
                      <i className="fas fa-trash-alt"></i>
                      Delete Account
                    </button>
                    <button onClick={() => profilePictureInputRef.current?.click()}>
                      <i className="fas fa-camera"></i>
                      Update Photo
                    </button>
                    <button onClick={toggleTheme}>
                      <i className={`fas fa-${theme === 'dark' ? 'sun' : 'moon'}`}></i>
                      {theme === 'dark' ? 'Light Theme' : 'Dark Theme'}
                    </button>
                    <button onClick={logout}>
                      <i className="fas fa-sign-out-alt"></i>
                      Logout
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <input
              type="file"
              ref={profilePictureInputRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleProfilePictureUpload}
            />
          </div>

          <div className="search-box">
            <i className="fas fa-search"></i>
            <input
              type="text"
              placeholder="Search conversations..."
              value={conversationSearchQuery}
              onChange={(e) => {
                setConversationSearchQuery(e.target.value)
                if (showAddFriend) setShowAddFriend(false)
              }}
            />
          </div>

          <div className="sidebar-actions">
            <motion.button
              className="btn btn-primary"
              onClick={() => setShowAddFriend(true)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <i className="fas fa-user-plus"></i>
              Add Friend
            </motion.button>
            <motion.button
              className="btn btn-secondary"
              onClick={() => setShowCreateGroup(true)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <i className="fas fa-users"></i>
              New Group
            </motion.button>
          </div>
        </div>

        <div className="friends-list">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
              <div className="loading-spinner"></div>
            </div>
          ) : (
            <>
              <div style={{ padding: '0.75rem 0.75rem 0.25rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Friends
              </div>
              {filteredFriends.length === 0 ? (
                <div style={{ 
                  textAlign: 'center', 
                  padding: '1.5rem', 
                  color: 'var(--text-muted)',
                  fontSize: '0.9rem'
                }}>
                  <i className="fas fa-user-friends" style={{ fontSize: '1.5rem', marginBottom: '0.75rem', display: 'block' }}></i>
                  {friends.length === 0 ? 'No friends yet. Add someone to start chatting!' : 'No friends match your search.'}
                </div>
              ) : (
                filteredFriends.map((friend, index) => (
                  <motion.div
                    key={friend._id}
                    className={`friend-item ${selectedFriend?._id === friend._id ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedGroup(null)
                      setSelectedFriend(friend)
                    }}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    whileHover={{ backgroundColor: 'var(--surface-light)' }}
                  >
                    <div className="friend-avatar" style={{ 
                      background: isOnline(friend._id) 
                        ? 'var(--gradient-2)' 
                        : 'var(--surface-lighter)',
                      color: isOnline(friend._id) ? 'white' : 'var(--text-muted)'
                    }}>
                      {friend.profilePicture ? (
                        <img src={getFullImageUrl(friend.profilePicture)} alt={friend.username} />
                      ) : (
                        getInitials(friend.username)
                      )}
                      {isOnline(friend._id) && <span className="online-indicator"></span>}
                    </div>
                    <div className="friend-info">
                      <h4>{friend.username}</h4>
                      <p>{getLastMessagePreview(friend.lastMessage)}</p>
                    </div>
                    <div className="friend-meta">
                      <span className="time">{formatTime(friend.lastMessage?.createdAt || friend.lastMessageTime)}</span>
                      {friend.unreadCount > 0 && (
                        <span className="unread">{friend.unreadCount}</span>
                      )}
                    </div>
                    <button
                      className="friend-remove-btn"
                      title="Remove friend"
                      onClick={(e) => {
                        e.stopPropagation()
                        setFriendToRemove(friend)
                        setShowRemoveFriendConfirm(true)
                      }}
                    >
                      <i className="fas fa-user-minus"></i>
                    </button>
                  </motion.div>
                ))
              )}

              <div style={{ padding: '1rem 0.75rem 0.25rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Groups
              </div>
              {filteredGroups.length === 0 ? (
                <div style={{ 
                  textAlign: 'center', 
                  padding: '1.25rem', 
                  color: 'var(--text-muted)',
                  fontSize: '0.9rem'
                }}>
                  <i className="fas fa-users" style={{ fontSize: '1.5rem', marginBottom: '0.75rem', display: 'block' }}></i>
                  {groups.length === 0 ? 'No groups yet. Create one to get started!' : 'No groups match your search.'}
                </div>
              ) : (
                filteredGroups.map((group, index) => (
                  <motion.div
                    key={group._id}
                    className={`friend-item ${selectedGroup?._id === group._id ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedFriend(null)
                      setSelectedGroup(group)
                    }}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    whileHover={{ backgroundColor: 'var(--surface-light)' }}
                  >
                    <div className="friend-avatar" style={{ 
                      background: 'var(--gradient-1)',
                      color: 'white'
                    }}>
                      {group.avatar ? (
                        <img src={getFullImageUrl(group.avatar)} alt={group.name} />
                      ) : (
                        getInitials(group.name)
                      )}
                    </div>
                    <div className="friend-info">
                      <h4>{group.name}</h4>
                      <p>{getLastMessagePreview(group.lastMessage)}</p>
                    </div>
                    <div className="friend-meta">
                      <span className="time">{formatTime(group.lastMessage?.createdAt || group.lastMessageTime)}</span>
                      {group.unreadCount > 0 && (
                        <span className="unread">{group.unreadCount}</span>
                      )}
                    </div>
                    <button
                      className="friend-remove-btn"
                      title="Manage group"
                      onClick={(e) => {
                        e.stopPropagation()
                        setGroupToManage(group)
                        setGroupNameInput(group.name)
                        setGroupAvatarFile(null)
                        setShowManageGroup(true)
                      }}
                    >
                      <i className="fas fa-cog"></i>
                    </button>
                  </motion.div>
                ))
              )}
            </>
          )}
        </div>
      </motion.aside>

      {/* Chat Area */}
      <main className="chat-area">
        {selectedFriend || selectedGroup ? (
          <>
            {/* Chat Header */}
            <div 
              className="chat-header"
            >
              <div className="chat-header-info">
                {selectedGroup ? (
                  <>
                    <div className="friend-avatar" style={{ 
                      background: 'var(--gradient-1)',
                      color: 'white'
                    }}>
                      {selectedGroup.avatar ? (
                        <img src={getFullImageUrl(selectedGroup.avatar)} alt={selectedGroup.name} />
                      ) : (
                        getInitials(selectedGroup.name)
                      )}
                    </div>
                    <div>
                      <h3>{selectedGroup.name}</h3>
                      <p className="status">
                        {selectedGroup.members?.length || 0} members
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="friend-avatar" style={{ 
                      background: isOnline(selectedFriend._id) 
                        ? 'var(--gradient-2)' 
                        : 'var(--surface-lighter)',
                      color: isOnline(selectedFriend._id) ? 'white' : 'var(--text-muted)'
                    }}>
                      {selectedFriend.profilePicture ? (
                        <img src={getFullImageUrl(selectedFriend.profilePicture)} alt={selectedFriend.username} />
                      ) : (
                        getInitials(selectedFriend.username)
                      )}
                      {isOnline(selectedFriend._id) && <span className="online-indicator"></span>}
                    </div>
                    <div>
                      <h3>{selectedFriend.username}</h3>
                      <p className={`status ${isOnline(selectedFriend._id) ? 'online' : ''}`}>
                        {isOnline(selectedFriend._id) ? (
                          <><span className="online-indicator" style={{ width: 8, height: 8 }}></span> Online</>
                        ) : (
                          'Offline'
                        )}
                      </p>
                    </div>
                  </>
                )}
              </div>
              <div className="chat-header-actions">
                {selectedGroup ? (
                  <>
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() => {
                        setGroupToManage(selectedGroup)
                        setGroupNameInput(selectedGroup.name)
                        setGroupAvatarFile(null)
                        setShowManageGroup(true)
                      }}
                      title="Manage group"
                    >
                      <i className="fas fa-cog"></i>
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() => startGroupCall('audio')}
                      title="Group audio call"
                      disabled={groupCallState !== 'idle'}
                    >
                      <i className="fas fa-phone"></i>
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() => startGroupCall('video')}
                      title="Group video call"
                      disabled={groupCallState !== 'idle'}
                    >
                      <i className="fas fa-video"></i>
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() => leaveGroup(selectedGroup._id)}
                      title="Leave group"
                    >
                      <i className="fas fa-sign-out-alt"></i>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() => startCall('audio')}
                      title="Audio call"
                      disabled={callState !== 'idle'}
                    >
                      <i className="fas fa-phone"></i>
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() => startCall('video')}
                      title="Video call"
                      disabled={callState !== 'idle'}
                    >
                      <i className="fas fa-video"></i>
                    </button>
                    <button 
                      className="btn btn-ghost btn-icon"
                      onClick={() => setShowClearChatConfirm(true)}
                      title="Clear chat"
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                    <button 
                      className="btn btn-ghost btn-icon"
                      onClick={() => {
                        setFriendToRemove(selectedFriend)
                        setShowRemoveFriendConfirm(true)
                      }}
                      title="Remove friend"
                    >
                      <i className="fas fa-user-minus"></i>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="messages-container">
              {messages.map((message, index) => {
                const senderId = getEntityId(message.senderId)
                const isSent = senderId === currentUserId
                const isGroupMessage = Boolean(message.groupId)
                const senderProfile = message.senderId
                return (
                  <motion.div
                    key={message._id || index}
                    className={`message ${isSent ? 'sent' : 'received'}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                  >
                    <div className="message-avatar">
                      {isSent ? (
                        user?.profilePicture ? (
                          <img src={getFullImageUrl(user.profilePicture)} alt={user.username} />
                        ) : (
                          getInitials(user.username)
                        )
                      ) : senderProfile?.profilePicture ? (
                        <img src={getFullImageUrl(senderProfile.profilePicture)} alt={senderProfile.username || 'User'} />
                      ) : (
                        getInitials(senderProfile?.username || selectedFriend?.username)
                      )}
                    </div>
                    <div className="message-content">
                      {!isSent && isGroupMessage && senderProfile?.username && (
                        <span className="message-time" style={{ fontSize: '0.75rem' }}>
                          {senderProfile.username}
                        </span>
                      )}
                      {message.message && (
                        <button
                          className="message-copy-btn"
                          type="button"
                          title="Copy message"
                          onClick={() => copyMessage(message)}
                        >
                          <i className={`fas fa-${copiedMessageId === message._id ? 'check' : 'copy'}`}></i>
                        </button>
                      )}
                      <button
                        className="message-delete-btn"
                        type="button"
                        title="Delete message"
                        onClick={() => setMessageToDelete(message)}
                      >
                        <i className="fas fa-trash-alt"></i>
                      </button>
                      {message.image && (
                        <div className="message-image">
                          <img src={getFullImageUrl(message.image)} alt="Shared" />
                        </div>
                      )}
                      {message.video && (
                        <video
                          controls
                          src={getFullImageUrl(message.video)}
                          style={{ width: '260px', borderRadius: 'var(--radius)' }}
                        />
                      )}
                      {message.audio && (
                        <audio
                          controls
                          src={getFullImageUrl(message.audio)}
                          style={{ width: '220px' }}
                        />
                      )}
                      {message.message && (
                        <div className="message-bubble">{message.message}</div>
                      )}
                      <span className="message-time">
                        {formatTime(message.createdAt)}
                      </span>
                    </div>
                  </motion.div>
                )
              })}
              
              {typingFriend && !selectedGroup && (
                <motion.div
                  className="message received"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <div className="message-avatar">
                    {getInitials(selectedFriend.username)}
                  </div>
                  <div className="typing-indicator">
                    <div className="typing-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <motion.div 
              className="message-input-container"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
            >
              <form className="message-input-wrapper" onSubmit={sendMessage}>
                <div className="emoji-picker-wrap" ref={emojiPickerRef}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => setShowEmojiPicker(prev => !prev)}
                    title="Add emoji"
                  >
                    <i className="far fa-smile"></i>
                  </button>
                  <AnimatePresence>
                    {showEmojiPicker && (
                      <motion.div
                        className="emoji-picker"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 12 }}
                      >
                        {EMOJI_OPTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            className="emoji-option"
                            onClick={() => insertEmoji(emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button 
                  type="button" 
                  className="btn btn-ghost btn-icon"
                  onClick={() => fileInputRef.current?.click()}
                  title="Send media"
                >
                  <i className="fas fa-paperclip"></i>
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/*,video/*"
                  style={{ display: 'none' }}
                />
                <textarea
                  ref={messageInputRef}
                  className="message-input"
                  placeholder={selectedGroup ? `Message ${selectedGroup.name}...` : 'Type a message...'}
                  value={newMessage}
                  onChange={handleTyping}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage(e)
                    }
                  }}
                  rows={1}
                />
                <button
                  type="button"
                  className={`btn btn-ghost btn-icon ${isRecording ? 'recording' : ''}`}
                  onClick={isRecording ? stopRecording : startRecording}
                  title={isRecording ? 'Stop recording' : 'Record voice message'}
                >
                  <i className={`fas fa-${isRecording ? 'stop' : 'microphone'}`}></i>
                </button>
                <motion.button
                  type="submit"
                  className="send-btn"
                  disabled={!newMessage.trim()}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <i className="fas fa-paper-plane"></i>
                </motion.button>
              </form>
            </motion.div>
          </>
        ) : (
          <motion.div 
            className="empty-chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="empty-chat-icon">
              <i className="fas fa-comments"></i>
            </div>
            <h3>Select a conversation</h3>
            <p>Choose a friend from the sidebar to start chatting</p>
          </motion.div>
        )}
      </main>

      {/* Add Friend Modal */}
      <AnimatePresence>
        {showAddFriend && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowAddFriend(false)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>Add Friend</h2>
                <button 
                  className="modal-close"
                  onClick={() => setShowAddFriend(false)}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <div className="search-box" style={{ marginBottom: '1rem' }}>
                <i className="fas fa-search"></i>
                <input
                  type="text"
                  placeholder="Search by username or email..."
                  value={friendSearchQuery}
                  onChange={(e) => setFriendSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="search-results">
                {searchLoading ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                    Searching...
                  </p>
                ) : searchResults.length > 0 ? (
                  searchResults.map((result) => (
                    <motion.div
                      key={result._id}
                      className="search-result-item"
                      onClick={() => addFriend(result)}
                      whileHover={{ backgroundColor: 'var(--surface-light)' }}
                    >
                      <div className="friend-avatar">
                        {result.profilePicture ? (
                          <img src={getFullImageUrl(result.profilePicture)} alt={result.username} />
                        ) : (
                          getInitials(result.username)
                        )}
                      </div>
                      <div className="friend-info">
                        <h4>{result.username}</h4>
                        <p>{result.email}</p>
                      </div>
                      <button className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
                        <i className="fas fa-user-plus"></i> Add
                      </button>
                    </motion.div>
                  ))
                ) : friendSearchQuery.trim().length > 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                    No users found
                  </p>
                ) : (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                    Recommended users will appear here as you search.
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Account Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>Delete Account</h2>
                <button 
                  className="modal-close"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
              <div style={{ padding: '1rem', textAlign: 'center' }}>
                <p style={{ marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
                  Are you sure you want to delete your account? This action cannot be undone and all your data will be permanently removed.
                </p>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  <button 
                    className="btn btn-ghost"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn btn-danger"
                    onClick={deleteAccount}
                    style={{ backgroundColor: '#dc3545', color: 'white' }}
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clear Chat Confirmation Modal */}
      <AnimatePresence>
        {showClearChatConfirm && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowClearChatConfirm(false)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>Clear Chat</h2>
                <button 
                  className="modal-close"
                  onClick={() => setShowClearChatConfirm(false)}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
              <div style={{ padding: '1rem', textAlign: 'center' }}>
                <p style={{ marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
                  Are you sure you want to clear this chat? This action cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  <button 
                    className="btn btn-ghost"
                    onClick={() => setShowClearChatConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn btn-danger"
                    onClick={clearChat}
                    style={{ backgroundColor: '#dc3545', color: 'white' }}
                  >
                    Clear Chat
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Remove Friend Confirmation Modal */}
      <AnimatePresence>
        {showRemoveFriendConfirm && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowRemoveFriendConfirm(false)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>Remove Friend</h2>
                <button 
                  className="modal-close"
                  onClick={() => setShowRemoveFriendConfirm(false)}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
              <div style={{ padding: '1rem', textAlign: 'center' }}>
                <p style={{ marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
                  Are you sure you want to remove {(friendToRemove || selectedFriend)?.username} from your friends? This action cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  <button 
                    className="btn btn-ghost"
                    onClick={() => setShowRemoveFriendConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn btn-danger"
                    onClick={removeFriend}
                    style={{ backgroundColor: '#dc3545', color: 'white' }}
                  >
                    Remove Friend
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {messageToDelete && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMessageToDelete(null)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>Delete Message</h2>
                <button
                  className="modal-close"
                  onClick={() => setMessageToDelete(null)}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
              <div style={{ padding: '1rem', textAlign: 'center' }}>
                <p style={{ marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
                  Delete this message permanently for this chat?
                </p>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setMessageToDelete(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={deleteMessage}
                    style={{ backgroundColor: '#dc3545', color: 'white' }}
                  >
                    Delete Message
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Group Modal */}
      <AnimatePresence>
        {showCreateGroup && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowCreateGroup(false)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>Create Group</h2>
                <button 
                  className="modal-close"
                  onClick={() => setShowCreateGroup(false)}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">Group name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter group name"
                  value={groupNameInput}
                  onChange={(e) => setGroupNameInput(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Group avatar</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setGroupAvatarFile(e.target.files?.[0] || null)}
                />
              </div>

              <div className="search-box" style={{ marginBottom: '1rem' }}>
                <i className="fas fa-search"></i>
                <input
                  type="text"
                  placeholder="Add members by username or email..."
                  value={groupSearchQuery}
                  onChange={(e) => setGroupSearchQuery(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                {groupMembersInput.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No members selected yet.
                  </p>
                ) : (
                  groupMembersInput.map(member => (
                    <div key={member._id} className="search-result-item">
                      <div className="friend-avatar">
                        {member.profilePicture ? (
                          <img src={getFullImageUrl(member.profilePicture)} alt={member.username} />
                        ) : (
                          getInitials(member.username)
                        )}
                      </div>
                      <div className="friend-info">
                        <h4>{member.username}</h4>
                        <p>{member.email}</p>
                      </div>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setGroupMembersInput(prev => prev.filter(item => item._id !== member._id))}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="search-results">
                {groupSearchLoading ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                    Searching...
                  </p>
                ) : groupSearchResults.length > 0 ? (
                  groupSearchResults.map((result) => (
                    <motion.div
                      key={result._id}
                      className="search-result-item"
                      onClick={() => {
                        if (result._id === user?._id) return
                        setGroupMembersInput(prev => {
                          if (prev.some(member => member._id === result._id)) return prev
                          return [...prev, result]
                        })
                      }}
                      whileHover={{ backgroundColor: 'var(--surface-light)' }}
                    >
                      <div className="friend-avatar">
                        {result.profilePicture ? (
                          <img src={getFullImageUrl(result.profilePicture)} alt={result.username} />
                        ) : (
                          getInitials(result.username)
                        )}
                      </div>
                      <div className="friend-info">
                        <h4>{result.username}</h4>
                        <p>{result.email}</p>
                      </div>
                      <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
                        <i className="fas fa-user-plus"></i> Add
                      </button>
                    </motion.div>
                  ))
                ) : groupSearchQuery.trim().length > 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                    No users found
                  </p>
                ) : (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                    Search users to add to the group.
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button className="btn btn-ghost" onClick={() => setShowCreateGroup(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={createGroup}>
                  Create Group
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manage Group Modal */}
      <AnimatePresence>
        {showManageGroup && groupToManage && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowManageGroup(false)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>Manage Group</h2>
                <button 
                  className="modal-close"
                  onClick={() => setShowManageGroup(false)}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">Group name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Update group name"
                  value={groupNameInput}
                  onChange={(e) => setGroupNameInput(e.target.value)}
                  disabled={!canManageSelectedGroup}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Change avatar</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setGroupAvatarFile(e.target.files?.[0] || null)}
                  disabled={!canManageSelectedGroup}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <h4 style={{ marginBottom: '0.5rem' }}>Members</h4>
                {groupToManage.members?.map(member => {
                  const isAdmin = groupToManage.admins?.some(admin => getEntityId(admin) === member._id)
                  const canRemove = canManageSelectedGroup && member._id !== user?._id
                  return (
                    <div key={member._id} className="search-result-item">
                      <div className="friend-avatar">
                        {member.profilePicture ? (
                          <img src={getFullImageUrl(member.profilePicture)} alt={member.username} />
                        ) : (
                          getInitials(member.username)
                        )}
                      </div>
                      <div className="friend-info">
                        <h4>{member.username}</h4>
                        <p>{isAdmin ? 'Admin' : 'Member'}</p>
                      </div>
                      {canRemove && (
                        <button
                          className="btn btn-ghost"
                          onClick={() => removeGroupMember(member._id)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {canManageSelectedGroup && (
                <>
                  <div className="search-box" style={{ marginBottom: '1rem' }}>
                    <i className="fas fa-search"></i>
                    <input
                      type="text"
                      placeholder="Add more members..."
                      value={groupSearchQuery}
                      onChange={(e) => setGroupSearchQuery(e.target.value)}
                    />
                  </div>

                  <div className="search-results">
                    {groupSearchLoading ? (
                      <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                        Searching...
                      </p>
                    ) : groupSearchResults.length > 0 ? (
                      groupSearchResults.map((result) => {
                        const isAlreadyMember = groupToManage.members?.some(member => member._id === result._id)
                        return (
                          <motion.div
                            key={result._id}
                            className="search-result-item"
                            onClick={() => {
                              if (isAlreadyMember) return
                              addGroupMembers([result])
                            }}
                            whileHover={{ backgroundColor: 'var(--surface-light)' }}
                          >
                            <div className="friend-avatar">
                              {result.profilePicture ? (
                                <img src={getFullImageUrl(result.profilePicture)} alt={result.username} />
                              ) : (
                                getInitials(result.username)
                              )}
                            </div>
                            <div className="friend-info">
                              <h4>{result.username}</h4>
                              <p>{result.email}</p>
                            </div>
                            <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
                              <i className="fas fa-user-plus"></i> Add
                            </button>
                          </motion.div>
                        )
                      })
                    ) : groupSearchQuery.trim().length > 0 ? (
                      <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                        No users found
                      </p>
                    ) : (
                      <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
                        Search users to add to the group.
                      </p>
                    )}
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between', marginTop: '1.5rem' }}>
                <button className="btn btn-ghost" onClick={() => leaveGroup(groupToManage._id)}>
                  Leave Group
                </button>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button className="btn btn-secondary" onClick={updateGroup} disabled={!canManageSelectedGroup}>
                    Save Changes
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ backgroundColor: '#dc3545', color: 'white' }}
                    onClick={() => deleteGroup(groupToManage._id)}
                    disabled={!canManageSelectedGroup}
                  >
                    Delete Group
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Call Modal */}
      <AnimatePresence>
        {callState !== 'idle' && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 520 }}
            >
              <div className="modal-header">
                <h2>{callType === 'video' ? 'Video Call' : 'Audio Call'}</h2>
                <button className="modal-close" onClick={endCall}>
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <div style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                {callState === 'incoming' && 'Incoming call...'}
                {callState === 'outgoing' && (callStatus || 'Calling...')}
                {callState === 'active' && (callStatus || 'In call')}
              </div>

              {callError && (
                <div style={{ color: '#dc3545', textAlign: 'center', marginBottom: '1rem' }}>
                  {callError}
                </div>
              )}

              {callType === 'video' ? (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    style={{ width: '100%', borderRadius: 12, background: '#000' }}
                  />
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '40%', borderRadius: 12, background: '#000', justifySelf: 'end' }}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="friend-avatar" style={{ width: 72, height: 72, fontSize: '1.5rem' }}>
                    {callPeer?.username ? getInitials(callPeer.username) : 'A'}
                  </div>
                  <p style={{ color: 'var(--text-muted)' }}>Audio only</p>
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                {callState === 'incoming' && (
                  <>
                    <button className="btn btn-secondary" onClick={acceptCall}>
                      Accept
                    </button>
                    <button className="btn btn-danger" style={{ backgroundColor: '#dc3545', color: 'white' }} onClick={rejectCall}>
                      Reject
                    </button>
                  </>
                )}
                {callState === 'outgoing' && (
                  <button className="btn btn-danger" style={{ backgroundColor: '#dc3545', color: 'white' }} onClick={endCall}>
                    Cancel
                  </button>
                )}
                {callState === 'active' && (
                  <>
                    <button className="btn btn-secondary" onClick={toggleMute}>
                      <i className={`fas fa-${isMuted ? 'microphone-slash' : 'microphone'}`}></i>
                      {isMuted ? 'Unmute' : 'Mute'}
                    </button>
                    {callType === 'video' && (
                      <>
                        <button className="btn btn-secondary" onClick={toggleCamera}>
                          <i className={`fas fa-${isCameraOff ? 'video-slash' : 'video'}`}></i>
                          {isCameraOff ? 'Camera On' : 'Camera Off'}
                        </button>
                        <button className="btn btn-secondary" onClick={toggleScreenShare}>
                          <i className={`fas fa-${isScreenSharing ? 'desktop' : 'share-square'}`}></i>
                          {isScreenSharing ? 'Stop Share' : 'Share Screen'}
                        </button>
                      </>
                    )}
                    <button className="btn btn-danger" style={{ backgroundColor: '#dc3545', color: 'white' }} onClick={endCall}>
                      End Call
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Group Call Modal */}
      <AnimatePresence>
        {groupCallState !== 'idle' && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 720 }}
            >
              <div className="modal-header">
                <h2>{groupCallType === 'video' ? 'Group Video Call' : 'Group Audio Call'}</h2>
                <button className="modal-close" onClick={endGroupCall}>
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <div style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                {groupCallState === 'incoming' && 'Incoming group call...'}
                {groupCallState === 'active' && (groupCallStatus || 'In call')}
              </div>

              {groupCallType === 'video' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                  <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden' }}>
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{ width: '100%' }}
                    />
                    <div style={{ padding: '0.5rem', textAlign: 'center', fontSize: '0.8rem' }}>
                      You
                    </div>
                  </div>
                  {Object.entries(groupRemoteStreams).map(([id, stream]) => (
                    <div key={id} style={{ background: '#000', borderRadius: 12, overflow: 'hidden' }}>
                      <video
                        autoPlay
                        playsInline
                        ref={(el) => {
                          if (el && stream) {
                            el.srcObject = stream
                          }
                        }}
                        style={{ width: '100%' }}
                      />
                      <div style={{ padding: '0.5rem', textAlign: 'center', fontSize: '0.8rem' }}>
                        {getMemberName(id)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <div className="friend-avatar" style={{ width: 72, height: 72, fontSize: '1.5rem', margin: '0 auto' }}>
                    {selectedGroup?.name ? getInitials(selectedGroup.name) : 'G'}
                  </div>
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Audio only</p>
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                {groupCallState === 'incoming' && (
                  <>
                    <button className="btn btn-secondary" onClick={acceptGroupCall}>
                      Join
                    </button>
                    <button className="btn btn-danger" style={{ backgroundColor: '#dc3545', color: 'white' }} onClick={rejectGroupCall}>
                      Decline
                    </button>
                  </>
                )}
                {groupCallState === 'active' && (
                  <>
                    <button className="btn btn-secondary" onClick={toggleGroupMute}>
                      <i className={`fas fa-${groupMuted ? 'microphone-slash' : 'microphone'}`}></i>
                      {groupMuted ? 'Unmute' : 'Mute'}
                    </button>
                    {groupCallType === 'video' && (
                      <button className="btn btn-secondary" onClick={toggleGroupCamera}>
                        <i className={`fas fa-${groupCameraOff ? 'video-slash' : 'video'}`}></i>
                        {groupCameraOff ? 'Camera On' : 'Camera Off'}
                      </button>
                    )}
                    <button className="btn btn-danger" style={{ backgroundColor: '#dc3545', color: 'white' }} onClick={endGroupCall}>
                      End Call
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
