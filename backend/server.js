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

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB Limit

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    db.run(`INSERT INTO displays (pairing_code, socket_id, is_paired) VALUES (?, ?, 0)`, [pairingCode, socket.id], function(err) {
        if (!err) socket.emit('pairing_code', { code: pairingCode });
    });
    socket.on('disconnect', () => {
        db.run(`DELETE FROM displays WHERE socket_id = ? AND is_paired = 0`, [socket.id]);
    });
});

// --- API ROUTES ---
app.post('/api/pair-display', (req, res) => {
    const { pairingCode } = req.body;
    db.get(`SELECT * FROM displays WHERE pairing_code = ? AND is_paired = 0`, [pairingCode], (err, display) => {
        if (err || !display) return res.status(400).json({ success: false, message: 'Invalid code.' });
        db.run(`UPDATE displays SET is_paired = 1, pairing_code = NULL WHERE id = ?`, [display.id], (updateErr) => {
            if (updateErr) return res.status(500).json({ success: false });
            io.to(display.socket_id).emit('paired_success', { displayId: display.id });
            res.json({ success: true });
        });
    });
});

app.get('/api/displays', (req, res) => {
    db.all(`SELECT * FROM displays WHERE is_paired = 1`, [], (err, rows) => {
        res.json({ success: !err, displays: rows || [] });
    });
});

app.post('/api/upload', upload.array('mediaFiles', 20), (req, res) => {
    const { displayId, startDate, endDate, startTime, endTime } = req.body;
    if (!req.files || req.files.length === 0 || !displayId) return res.status(400).json({ success: false });

    let completed = 0;
    req.files.forEach((file, index) => {
        const mediaUrl = `/uploads/${file.filename}`;
        const ext = path.extname(file.originalname).toLowerCase();
        const mediaType = (ext === '.mp4' || ext === '.webm') ? 'video' : 'image';

        const query = `INSERT INTO playlist_items (display_id, media_url, media_type, play_order, start_date, end_date, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        db.run(query, [displayId, mediaUrl, mediaType, index + 1, startDate, endDate, startTime, endTime], () => {
            completed++;
            if (completed === req.files.length) {
                db.get(`SELECT socket_id FROM displays WHERE id = ?`, [displayId], (err, display) => {
                    if (display && display.socket_id) io.to(display.socket_id).emit('update_playlist');
                });
                res.json({ success: true, message: `Scheduled ${req.files.length} ads!` });
            }
        });
    });
});

app.get('/api/playlist/:displayId', (req, res) => {
    db.all(`SELECT * FROM playlist_items WHERE display_id = ? ORDER BY play_order ASC`, [req.params.displayId], (err, rows) => {
        res.json({ success: !err, playlist: rows || [] });
    });
});

app.delete('/api/playlist/:itemId', (req, res) => {
    const itemId = req.params.itemId;
    db.get(`SELECT display_id FROM playlist_items WHERE id = ?`, [itemId], (err, row) => {
        if (!row) return res.status(400).json({ success: false });
        db.run(`DELETE FROM playlist_items WHERE id = ?`, [itemId], () => {
            db.get(`SELECT socket_id FROM displays WHERE id = ?`, [row.display_id], (err, display) => {
                if (display && display.socket_id) io.to(display.socket_id).emit('update_playlist');
            });
            res.json({ success: true });
        });
    });
});

// 🔥 THE AMNESIA FIX 🔥
app.post('/api/reconnect', (req, res) => {
    const { displayId, socketId } = req.body;
    db.get(`SELECT id FROM displays WHERE id = ?`, [displayId], (err, row) => {
        if (!row) return res.json({ success: false, action: 'force_reset' }); // Tell TV to wipe memory
        db.run(`UPDATE displays SET socket_id = ? WHERE id = ?`, [socketId, displayId], (err) => res.json({ success: !err }));
    });
});

app.post('/api/rename-display', (req, res) => {
    db.run(`UPDATE displays SET display_name = ? WHERE id = ?`, [req.body.newName, req.body.displayId], (err) => res.json({ success: !err }));
});

app.post('/api/unpair-display', (req, res) => {
    const { displayId } = req.body;
    db.get(`SELECT socket_id FROM displays WHERE id = ?`, [displayId], (err, display) => {
        if (display && display.socket_id) io.to(display.socket_id).emit('force_logout');
        db.run(`DELETE FROM displays WHERE id = ?`, [displayId], () => {
            db.run(`DELETE FROM playlist_items WHERE display_id = ?`, [displayId]);
            res.json({ success: true });
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
