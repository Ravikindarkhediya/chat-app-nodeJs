// server.js - Complete Firebase Integration
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin
try {
    const serviceAccount = require('./firebase-service-account.json');

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID
    });

    const db = admin.firestore();
    console.log('✅ Firebase Admin initialized successfully');
} catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    console.log('⚠️  Running without Firebase - notifications will be logged only');
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Chat Notification API is running with Firebase',
        timestamp: new Date().toISOString(),
        firebase: admin.apps.length > 0 ? 'enabled' : 'disabled'
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

        console.log('📥 Notification request:', { receiverId, senderId, senderName, chatId });

        // Validate required fields
        if (!receiverId || !senderId || !senderName || !message || !chatId) {
            return res.status(400).json({
                error: 'Missing required fields: receiverId, senderId, senderName, message, chatId'
            });
        }

        if (admin.apps.length === 0) {
            // Firebase not initialized - return success but don't send
            console.log('⚠️  Firebase not initialized - notification logged only');
            return res.json({
                success: true,
                message: 'Notification logged (Firebase disabled)',
                firebase: false
            });
        }

        const db = admin.firestore();

        // Get receiver's FCM token
        const userDoc = await db.collection('users').doc(receiverId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Receiver not found' });
        }

        const userData = userDoc.data();
        const fcmToken = userData.fcmToken;

        if (!fcmToken) {
            return res.status(400).json({ error: 'No FCM token found for receiver' });
        }

        // Check if user is online and in same chat
        const isOnline = userData.isOnline || false;
        const activeChat = userData.activeChatId;

        if (isOnline && activeChat === chatId) {
            return res.json({
                success: true,
                message: 'User is viewing this chat, notification skipped',
                skipped: true
            });
        }

        // Format notification body
        const notificationBody = getNotificationBody(message, messageType);

        // Create FCM message
        const fcmMessage = {
            notification: {
                title: senderName,
                body: notificationBody
            },
            data: {
                chatId: chatId,
                senderId: senderId,
                senderName: senderName,
                messageType: messageType,
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

        // Send notification
        const response = await admin.messaging().send(fcmMessage);

        console.log('✅ FCM Notification sent:', response);

        res.json({
            success: true,
            messageId: response,
            receiverId: receiverId,
            senderName: senderName,
            firebase: true
        });

    } catch (error) {
        console.error('❌ Error sending notification:', error);

        if (error.code === 'messaging/registration-token-not-registered') {
            res.status(400).json({
                error: 'Invalid FCM token',
                code: 'TOKEN_INVALID'
            });
        } else {
            res.status(500).json({
                error: 'Failed to send notification',
                details: error.message
            });
        }
    }
});

// Update FCM Token endpoint
app.post('/user/:userId/fcm-token', async (req, res) => {
    try {
        const { userId } = req.params;
        const { fcmToken, deviceType } = req.body;

        console.log('📱 FCM Token update:', { userId, deviceType });

        if (!fcmToken) {
            return res.status(400).json({ error: 'fcmToken is required' });
        }

        if (admin.apps.length === 0) {
            return res.json({
                success: true,
                message: 'FCM token received (Firebase disabled)',
                firebase: false
            });
        }

        const db = admin.firestore();

        await db.collection('users').doc(userId).set({
            fcmToken: fcmToken,
            deviceType: deviceType || 'unknown',
            lastTokenUpdate: admin.firestore.FieldValue.serverTimestamp(),
            isOnline: true,
            lastActive: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log('✅ FCM token saved to Firestore');

        res.json({
            success: true,
            message: 'FCM token updated successfully',
            userId: userId,
            firebase: true
        });

    } catch (error) {
        console.error('❌ Error updating FCM token:', error);
        res.status(500).json({ error: 'Failed to update FCM token' });
    }
});

// Helper function
function getNotificationBody(message, messageType) {
    switch (messageType) {
        case 'image': return '📷 Sent an image';
        case 'video': return '🎥 Sent a video';
        case 'audio': return '🎵 Sent an audio message';
        case 'document': return '📄 Sent a document';
        case 'location': return '📍 Shared location';
        default: return message.length > 100 ? `${message.substring(0, 100)}...` : message;
    }
}

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
    console.log(`🚀 Chat Notification API running on port ${PORT}`);
    console.log(`📱 Health: http://localhost:${PORT}/health`);
});
