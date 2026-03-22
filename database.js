// database.js
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./signage.db', (err) => {
    if (err) {
        console.error("Database error:", err.message);
    } else {
        console.log("Connected to the local SQLite database.");
    }
});

db.serialize(() => {
    // 1. The Screens Table
    db.run(`CREATE TABLE IF NOT EXISTS displays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        display_name TEXT,
        pairing_code TEXT,
        socket_id TEXT,
        is_paired INTEGER DEFAULT 0
    )`);

    // 2. NEW: The Playlist Table
    // This stores which ads play on which screen, and in what order.
    db.run(`CREATE TABLE IF NOT EXISTS playlist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        display_id INTEGER,
        media_url TEXT,
        media_type TEXT, -- e.g., 'video' or 'image'
        play_order INTEGER
    )`);
});

module.exports = db;