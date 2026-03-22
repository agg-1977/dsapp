// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// In-memory store for our pending TV connections
const pendingDisplays = {};

// 1. TV connects via WebSocket to get a QR code
io.on('connection', (socket) => {
    console.log('A display connected:', socket.id);

    // Generate a simple 6-character pairing code
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Store the socket connection mapped to the pairing code
    pendingDisplays[pairingCode] = socket.id;

    // Send the code back to the TV to display as a QR
    socket.emit('pairing_code', { code: pairingCode });

    socket.on('disconnect', () => {
        // Clean up if the TV disconnects
        for (const [code, id] of Object.entries(pendingDisplays)) {
            if (id === socket.id) delete pendingDisplays[code];
        }
    });
});

// 2. Mobile App hits this API to claim the TV
app.post('/api/pair-display', (req, res) => {
    const { pairingCode, adminUserId } = req.body;

    const socketId = pendingDisplays[pairingCode];

    if (socketId) {
        // Success! Tell the specific TV it has been paired
        io.to(socketId).emit('paired_success', { 
            message: 'Linked successfully!',
            displayId: `display_${Date.now()}` // Generate a permanent ID for the TV
        });

        // Remove from pending list
        delete pendingDisplays[pairingCode];
        
        res.json({ success: true, message: 'Display linked to your account.' });
    } else {
        res.status(400).json({ success: false, message: 'Invalid or expired QR code.' });
    }
});

server.listen(3000, () => {
    console.log('Signage Server running on port 3000');
});