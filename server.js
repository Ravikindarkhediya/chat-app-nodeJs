// server.js - Fixed version
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Chat Notification API is running (Firebase disabled for testing)',
        timestamp: new Date().toISOString()
    });
});

// Test endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Chat Notification API',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            sendNotification: 'POST /send-notification'
        }
    });
});

// Notification endpoint (without Firebase for now)
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

        console.log('📥 Notification request received:', {
            receiverId,
            senderId,
            senderName,
            message,
            chatId,
            messageType
        });

        // Validate required fields
        if (!receiverId || !senderId || !senderName || !message || !chatId) {
            return res.status(400).json({
                error: 'Missing required fields: receiverId, senderId, senderName, message, chatId'
            });
        }

        // ✅ Temporary success response
        res.json({
            success: true,
            message: 'Notification received (Firebase integration pending)',
            data: {
                receiverId,
                senderName,
                messagePreview: message.substring(0, 50),
                chatId
            },
            tempMode: true
        });

    } catch (error) {
        console.error('Error processing notification:', error);
        res.status(500).json({
            error: 'Failed to process notification',
            details: error.message
        });
    }
});

// FCM Token endpoint
app.post('/user/:userId/fcm-token', async (req, res) => {
    try {
        const { userId } = req.params;
        const { fcmToken, deviceType } = req.body;

        console.log('📱 FCM Token update:', { userId, fcmToken: fcmToken?.substring(0, 20) + '...', deviceType });

        if (!fcmToken) {
            return res.status(400).json({ error: 'fcmToken is required' });
        }

        // ✅ Temporary success response
        res.json({
            success: true,
            message: 'FCM token received (Firebase integration pending)',
            userId: userId,
            tempMode: true
        });

    } catch (error) {
        console.error('Error updating FCM token:', error);
        res.status(500).json({ error: 'Failed to update FCM token' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});

// ✅ Fixed 404 handler - Remove wildcard
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method,
        availableEndpoints: [
            'GET /',
            'GET /health',
            'POST /send-notification',
            'POST /user/:userId/fcm-token'
        ]
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Chat Notification API running on port ${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/health`);
    console.log(`📱 Root endpoint: http://localhost:${PORT}/`);
    console.log(`⚠️  Firebase integration disabled for testing`);
});
