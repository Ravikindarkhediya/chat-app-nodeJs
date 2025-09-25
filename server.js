// server.js - Fixed wildcard issue
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin (with error handling)
let db;
let firebaseEnabled = false;

try {
    const admin = require('firebase-admin');

    // Check if service account exists or use environment variable
    let serviceAccount;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        serviceAccount = require('./firebase-service-account.json');
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID
    });

    db = admin.firestore();
    firebaseEnabled = true;
    console.log('✅ Firebase Admin initialized successfully');
} catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    console.log('⚠️  Running without Firebase - notifications will be logged only');
}

// ✅ Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Chat Notification API',
        version: '1.0.0',
        status: 'running',
        firebase: firebaseEnabled ? 'enabled' : 'disabled',
        endpoints: {
            health: '/health',
            sendNotification: 'POST /send-notification',
            updateToken: 'POST /user/:userId/fcm-token'
        },
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Chat Notification API is running',
        firebase: firebaseEnabled ? 'enabled' : 'disabled',
        timestamp: new Date().toISOString()
    });
});

// Send notification endpoint
app.post('/send-notification', async (req, res) => {
    try {
        const {
            receiverId,
            senderId,
            senderName,
            message,
            chatId,
            messageType = 'text'
        } = req.body;

        console.log('📥 Notification request:', {
            receiverId,
            senderId,
            senderName,
            chatId,
            messageType
        });

        // Validate required fields
        if (!receiverId || !senderId || !senderName || !message || !chatId) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['receiverId', 'senderId', 'senderName', 'message', 'chatId']
            });
        }

        if (!firebaseEnabled) {
            console.log('⚠️  Firebase disabled - notification logged only');
            return res.json({
                success: true,
                message: 'Notification logged (Firebase disabled)',
                data: {
                    receiverId,
                    senderName,
                    messagePreview: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
                    chatId
                },
                firebase: false
            });
        }

        const admin = require('firebase-admin');

        // Get receiver's FCM token from Firestore
        const userDoc = await db.collection('users').doc(receiverId).get();

        if (!userDoc.exists) {
            console.log(`❌ User not found: ${receiverId}`);
            return res.status(404).json({
                error: 'Receiver not found',
                receiverId: receiverId
            });
        }

        const userData = userDoc.data();
        const fcmToken = userData.fcmToken;

        if (!fcmToken) {
            console.log(`❌ No FCM token for user: ${receiverId}`);
            return res.status(400).json({
                error: 'No FCM token found for receiver',
                receiverId: receiverId
            });
        }

        // Check if user is online and viewing same chat
        const isOnline = userData.isOnline || false;
        const activeChat = userData.activeChatId;

        if (isOnline && activeChat === chatId) {
            console.log(`🔇 User ${receiverId} is viewing chat ${chatId}, skipping notification`);
            return res.json({
                success: true,
                message: 'User is viewing this chat, notification skipped',
                skipped: true,
                receiverId: receiverId
            });
        }

        // Format notification body based on message type
        const notificationBody = getNotificationBody(message, messageType);

        // Create FCM message payload
        const fcmMessage = {
            notification: {
                title: senderName,
                body: notificationBody
            },
            data: {
                chatId: chatId.toString(),
                senderId: senderId.toString(),
                senderName: senderName.toString(),
                messageType: messageType.toString(),
                type: 'chat',
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
            },
            token: fcmToken,
            android: {
                notification: {
                    channelId: 'chat_messages',
                    priority: 'high',
                    sound: 'default',
                    icon: 'ic_stat_mind_zora'
                }
            },
            apns: {
                payload: {
                    aps: {
                        alert: {
                            title: senderName,
                            body: notificationBody
                        },
                        sound: 'default',
                        badge: 1
                    }
                }
            }
        };

        // Send FCM notification
        const response = await admin.messaging().send(fcmMessage);

        console.log('✅ FCM notification sent successfully:', response);

        res.json({
            success: true,
            messageId: response,
            receiverId: receiverId,
            senderName: senderName,
            notificationBody: notificationBody,
            firebase: true
        });

    } catch (error) {
        console.error('❌ Error sending notification:', error);

        if (error.code === 'messaging/registration-token-not-registered') {
            res.status(400).json({
                error: 'Invalid or expired FCM token',
                code: 'TOKEN_INVALID',
                receiverId: req.body.receiverId
            });
        } else {
            res.status(500).json({
                error: 'Failed to send notification',
                details: error.message,
                code: error.code || 'UNKNOWN_ERROR'
            });
        }
    }
});

// Update FCM Token endpoint
app.post('/user/:userId/fcm-token', async (req, res) => {
    try {
        const { userId } = req.params;
        const { fcmToken, deviceType } = req.body;

        console.log('📱 FCM Token update request:', {
            userId,
            deviceType,
            tokenPreview: fcmToken ? fcmToken.substring(0, 20) + '...' : 'null'
        });

        if (!fcmToken) {
            return res.status(400).json({
                error: 'fcmToken is required',
                received: { userId, deviceType }
            });
        }

        if (!firebaseEnabled) {
            console.log('⚠️  Firebase disabled - token logged only');
            return res.json({
                success: true,
                message: 'FCM token received (Firebase disabled)',
                userId: userId,
                firebase: false
            });
        }

        const admin = require('firebase-admin');

        // Save token to Firestore
        await db.collection('users').doc(userId).set({
            fcmToken: fcmToken,
            deviceType: deviceType || 'unknown',
            lastTokenUpdate: admin.firestore.FieldValue.serverTimestamp(),
            isOnline: true,
            lastActive: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`✅ FCM token saved for user: ${userId}`);

        res.json({
            success: true,
            message: 'FCM token updated successfully',
            userId: userId,
            deviceType: deviceType,
            firebase: true
        });

    } catch (error) {
        console.error('❌ Error updating FCM token:', error);
        res.status(500).json({
            error: 'Failed to update FCM token',
            details: error.message,
            userId: req.params.userId
        });
    }
});

// Helper function to format notification body
function getNotificationBody(message, messageType) {
    switch (messageType) {
        case 'image':
            return '📷 Sent an image';
        case 'video':
            return '🎥 Sent a video';
        case 'audio':
            return '🎵 Sent an audio message';
        case 'document':
            return '📄 Sent a document';
        case 'location':
            return '📍 Shared location';
        default:
            return message && message.length > 100
                ? `${message.substring(0, 100)}...`
                : message || 'New message';
    }
}

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// ✅ 404 handler - FIXED (remove wildcard)
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method,
        availableEndpoints: {
            'GET /': 'API information',
            'GET /health': 'Health check',
            'POST /send-notification': 'Send push notification',
            'POST /user/:userId/fcm-token': 'Update FCM token'
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Chat Notification API running on port ${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/health`);
    console.log(`🔥 Firebase: ${firebaseEnabled ? 'enabled' : 'disabled'}`);
});
