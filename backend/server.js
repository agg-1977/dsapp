// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./database');
const multer = require('multer'); 
const path = require('path');
const fs = require('fs'); 

const app = express();
app.use(cors());
app.use(express.json());

// Automatically create an 'uploads' folder if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Tell the server to let TVs access the files inside the 'uploads' folder
app.use('/uploads', express.static('uploads'));

// Configure how 'multer' saves the files
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

// 2. Get a list of all paired displays
app.get('/api/displays', (req, res) => {
    db.all(`SELECT * FROM displays WHERE is_paired = 1`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, displays: rows });
    });
});

// 3. NEW: Upload Multiple Ads & Schedule Them
app.post('/api/upload', upload.array('mediaFiles', 20), (req, res) => {
    const { displayId, startDate, endDate, startTime, endTime } = req.body;
    
    if (!req.files || req.files.length === 0 || !displayId) {
        return res.status(400).json({ success: false, message: 'Missing files or display ID.' });
    }

    let completed = 0;
    
    req.files.forEach((file, index) => {
        const mediaUrl = `/uploads/${file.filename}`;
        const ext = path.extname(file.originalname).toLowerCase();
        const mediaType = (ext === '.mp4' || ext === '.webm') ? 'video' : 'image';

        const query = `INSERT INTO playlist_items 
            (display_id, media_url, media_type, play_order, start_date, end_date, start_time, end_time) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
            
        db.run(query, [displayId, mediaUrl, mediaType, index + 1, startDate, endDate, startTime, endTime], (err) => {
            completed++;
            if (completed === req.files.length) {
                // Notify TV to refresh once all files are saved
                db.get(`SELECT socket_id FROM displays WHERE id = ?`, [displayId], (err, display) => {
                    if (display && display.socket_id) io.to(display.socket_id).emit('update_playlist');
                });
                res.json({ success: true, message: `Successfully scheduled ${req.files.length} ads!` });
            }
        });
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

// --- MANAGEMENT APIs ---

// 1. Silent Reconnect for refreshed TVs
app.post('/api/reconnect', (req, res) => {
    const { displayId, socketId } = req.body;
    db.run(`UPDATE displays SET socket_id = ? WHERE id = ?`, [socketId, displayId], (err) => {
        res.json({ success: !err });
    });
});

// 2. Rename a display (e.g., "Main Entrance TV")
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

// FIXED: Let Render choose the port so it doesn't crash!
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Signage Server running on port ${PORT}`);
});
