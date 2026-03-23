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

    // 🔥 THE FIX: Destroy the old table pulled from GitHub
    db.run(`DROP TABLE IF EXISTS playlist_items`);

    // 2. Rebuild it with the advanced scheduling columns!
    db.run(`CREATE TABLE playlist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        display_id INTEGER,
        media_url TEXT,
        media_type TEXT,
        play_order INTEGER,
        start_date TEXT,
        end_date TEXT,
        start_time TEXT,
        end_time TEXT
    )`);
});

module.exports = db;
