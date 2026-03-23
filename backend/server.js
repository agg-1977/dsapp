// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./database');
const multer = require('multer'); // NEW: For file uploads
const path = require('path');
const fs = require('fs'); // NEW: To create folders

const app = express();
app.use(cors());
app.use(express.json());

// NEW: Automatically create an 'uploads' folder if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// NEW: Tell the server to let TVs access the files inside the 'uploads' folder
app.use('/uploads', express.static('uploads'));

// NEW: Configure how 'multer' saves the files
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        // Give the file a unique name using the current timestamp
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- SOCKET.IO (TV Connections) ---
io.on('connection', (socket) => {
    console.log('A display connected:', socket.id);
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    db.run(`INSERT INTO displays (pairing_code, socket_id, is_paired) VALUES (?, ?, 0)`, [pairingCode, socket.id], function(err) {
        if (!err) socket.emit('pairing_code', { code: pairingCode });
    });

    socket.on('disconnect', () => {
        db.run(`DELETE FROM displays WHERE socket_id = ? AND is_paired = 0`, [socket.id]);
    });
});

// --- API ROUTES ---

// 1. Pair the display
app.post('/api/pair-display', (req, res) => {
    const { pairingCode } = req.body;
    db.get(`SELECT * FROM displays WHERE pairing_code = ? AND is_paired = 0`, [pairingCode], (err, display) => {
        if (err || !display) return res.status(400).json({ success: false, message: 'Invalid code.' });

        db.run(`UPDATE displays SET is_paired = 1, pairing_code = NULL WHERE id = ?`, [display.id], (updateErr) => {
            if (updateErr) return res.status(500).json({ success: false, message: 'Database error.' });
            io.to(display.socket_id).emit('paired_success', { message: 'Linked successfully!', displayId: display.id });
            res.json({ success: true, message: 'Display linked to your account.' });
        });
    });
});

// 2. NEW: Get a list of all paired displays (so we can choose which one to send the ad to)
app.get('/api/displays', (req, res) => {
    db.all(`SELECT * FROM displays WHERE is_paired = 1`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, displays: rows });
    });
});

// 3. NEW: Upload an Ad and add it to the playlist
app.post('/api/upload', upload.single('mediaFile'), (req, res) => {
    const displayId = req.body.displayId;
    
    if (!req.file || !displayId) {
        return res.status(400).json({ success: false, message: 'Missing file or display ID.' });
    }

    // The URL the TV will use to play the video (e.g., /uploads/167890.mp4)
    const mediaUrl = `/uploads/${req.file.filename}`;
    
    // Determine if it's a video or image based on the file extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    const mediaType = (ext === '.mp4' || ext === '.webm') ? 'video' : 'image';

    // Insert it into the database playlist
    const query = `INSERT INTO playlist_items (display_id, media_url, media_type, play_order) VALUES (?, ?, ?, 1)`;
    db.run(query, [displayId, mediaUrl, mediaType], function(err) {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });

        // Tell the specific TV to refresh its playlist!
        db.get(`SELECT socket_id FROM displays WHERE id = ?`, [displayId], (err, display) => {
            if (display && display.socket_id) {
                io.to(display.socket_id).emit('update_playlist');
            }
        });

        res.json({ success: true, message: 'Ad uploaded successfully!' });
    });
});

// 4. Get the playlist for a specific TV
app.get('/api/playlist/:displayId', (req, res) => {
    const displayId = req.params.displayId;
    db.all(`SELECT * FROM playlist_items WHERE display_id = ? ORDER BY play_order ASC`, [displayId], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, playlist: rows });
    });
});

// --- NEW MANAGEMENT APIs ---

// 1. Silent Reconnect for refreshed TVs
app.post('/api/reconnect', (req, res) => {
    const { displayId, socketId } = req.body;
    db.run(`UPDATE displays SET socket_id = ? WHERE id = ?`, [socketId, displayId], (err) => {
        res.json({ success: !err });
    });
});

// 2. Rename a display (e.g., "Phaltan Entrance TV")
app.post('/api/rename-display', (req, res) => {
    const { displayId, newName } = req.body;
    db.run(`UPDATE displays SET display_name = ? WHERE id = ?`, [newName, displayId], (err) => {
        res.json({ success: !err });
    });
});

// 3. Unpair / Logout a TV
app.post('/api/unpair-display', (req, res) => {
    const { displayId } = req.body;
    
    // Find the TV's current connection and tell it to logout
    db.get(`SELECT socket_id FROM displays WHERE id = ?`, [displayId], (err, display) => {
        if (display && display.socket_id) {
            io.to(display.socket_id).emit('force_logout');
        }
        
        // Delete it from the database and wipe its playlist
        db.run(`DELETE FROM displays WHERE id = ?`, [displayId], () => {
            db.run(`DELETE FROM playlist_items WHERE display_id = ?`, [displayId]);
            res.json({ success: true, message: "Screen logged out successfully." });
        });
    });
});

server.listen(3000, () => {
    console.log('Signage Server running on port 3000');
});
