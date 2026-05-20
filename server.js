const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const contactRoutes = require('./routes/contact');
const adminRoutes = require('./routes/admin');
const modifyRoutes = require('./routes/modify');

const app = express();
app.set('trust proxy', 1); // Required for rate limiting behind Render/proxies

// Security headers via Helmet
const scriptSources = ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://www.google.com", "https://www.gstatic.com", "https://unpkg.com", "https://cdnjs.cloudflare.com"];
const connectSources = ["'self'", "https://www.google.com", "https://tile.openstreetmap.org", "https://*.tile.openstreetmap.org", "https://nominatim.openstreetmap.org"];
const frameSources = ["https://www.google.com", "https://www.gstatic.com"];

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: scriptSources,
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:", "https://tile.openstreetmap.org", "https://*.tile.openstreetmap.org", "https://unpkg.com"],
            connectSrc: connectSources,
            frameSrc: frameSources,
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(cors());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate limiter: max 5 booking requests per IP per 15 minutes
const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many requests. Please try again in a few minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/booking', bookingLimiter);
app.use('/api', contactRoutes);
app.use('/api', modifyRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
const startTime = Date.now();
app.get('/api/health', (req, res) => {
    const db = require('./db');
    let dbStatus = 'ok';
    try {
        db.prepare('SELECT 1').get();
    } catch (e) {
        dbStatus = 'error: ' + e.message;
    }

    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = uptime % 60;

    res.json({
        status: dbStatus === 'ok' ? 'healthy' : 'degraded',
        uptime: `${hours}h ${mins}m ${secs}s`,
        database: dbStatus,
        memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        version: require('./package.json').version,
        timestamp: new Date().toISOString(),
    });
});

// Automated daily DB backup (every 24 hours)
function backupDatabase() {
    const dbPath = path.join(__dirname, 'bookings.db');
    const backupDir = path.join(__dirname, 'backups');

    if (!fs.existsSync(dbPath)) return;
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const backupPath = path.join(backupDir, `bookings-${date}.db`);

    try {
        fs.copyFileSync(dbPath, backupPath);
        console.log(`[Backup] Database backed up to ${backupPath}`);

        // Keep only last 7 backups
        const files = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('bookings-') && f.endsWith('.db'))
            .sort()
            .reverse();
        for (const old of files.slice(7)) {
            fs.unlinkSync(path.join(backupDir, old));
            console.log(`[Backup] Removed old backup: ${old}`);
        }
    } catch (err) {
        console.error('[Backup] Failed:', err.message);
    }
}

// Run backup on startup and then every 24 hours
backupDatabase();
setInterval(backupDatabase, 24 * 60 * 60 * 1000);

// Auto-cancel unverified bookings older than 1 hour
function cleanupUnverifiedBookings() {
    const db = require('./db');
    const result = db.prepare(
        "UPDATE bookings SET status = 'cancelled' WHERE email_verified = 0 AND status = 'pending' AND created_at < datetime('now', '-1 hour')"
    ).run();
    if (result.changes > 0) {
        console.log(`[Cleanup] Cancelled ${result.changes} unverified booking(s)`);
        db.prepare('INSERT INTO audit_log (action, details, performed_by) VALUES (?, ?, ?)').run(
            'unverified_cleanup', `Auto-cancelled ${result.changes} unverified booking(s)`, 'system'
        );
    }
}
cleanupUnverifiedBookings();
setInterval(cleanupUnverifiedBookings, 10 * 60 * 1000); // Every 10 minutes

// Auto-send 24h reminder emails for tomorrow's confirmed bookings
async function sendDailyReminders() {
    const db = require('./db');
    const { sendReminderEmail } = require('./mailer');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const bookings = db.prepare(
        "SELECT * FROM bookings WHERE date = ? AND status = 'confirmed' AND reminder_sent = 0 AND email_verified = 1"
    ).all(tomorrowStr);

    for (const booking of bookings) {
        try {
            await sendReminderEmail(booking);
            db.prepare('UPDATE bookings SET reminder_sent = 1 WHERE id = ?').run(booking.id);
            db.prepare('INSERT INTO audit_log (action, booking_id, details, performed_by) VALUES (?, ?, ?, ?)').run(
                'reminder_sent', booking.id, `24h reminder sent to ${booking.email}`, 'system'
            );
            console.log(`[Reminder] Sent to ${booking.email} for booking #${booking.id} (${tomorrowStr})`);
        } catch (err) {
            console.error(`[Reminder] Failed for booking #${booking.id}:`, err.message);
        }
    }
    if (bookings.length > 0) console.log(`[Reminder] Processed ${bookings.length} reminder(s) for ${tomorrowStr}`);
}

// Auto-send review request 2 days after service completion
async function sendReviewRequests() {
    const db = require('./db');
    const { sendReviewRequestEmail } = require('./mailer');

    // Find bookings completed 2 days ago that haven't received a review request
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const targetDate = twoDaysAgo.toISOString().split('T')[0];

    const bookings = db.prepare(
        "SELECT * FROM bookings WHERE status = 'completed' AND review_sent = 0 AND date <= ? AND email_verified = 1"
    ).all(targetDate);

    for (const booking of bookings) {
        try {
            await sendReviewRequestEmail(booking);
            db.prepare('UPDATE bookings SET review_sent = 1 WHERE id = ?').run(booking.id);
            db.prepare('INSERT INTO audit_log (action, booking_id, details, performed_by) VALUES (?, ?, ?, ?)').run(
                'review_request_sent', booking.id, `Review request sent to ${booking.email}`, 'system'
            );
            console.log(`[Review] Request sent to ${booking.email} for booking #${booking.id}`);
        } catch (err) {
            console.error(`[Review] Failed for booking #${booking.id}:`, err.message);
        }
    }
    if (bookings.length > 0) console.log(`[Review] Processed ${bookings.length} review request(s)`);
}

// Run both jobs every hour (catches bookings throughout the day)
setInterval(sendDailyReminders, 60 * 60 * 1000);
setInterval(sendReviewRequests, 60 * 60 * 1000);
// Also run on startup after a short delay
setTimeout(() => { sendDailyReminders(); sendReviewRequests(); }, 5000);

// Clean URLs for pages
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, 'sitemap.xml')));
app.get('/booking-confirmed', (req, res) => res.sendFile(path.join(__dirname, 'booking-confirmed.html')));
app.get('/modify', (req, res) => res.sendFile(path.join(__dirname, 'modify-booking.html')));

// Serve index for root and known paths, 404 for everything else
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('*', (req, res) => {
    res.status(404).sendFile(path.join(__dirname, '404.html'));
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Mr. Bike server running on http://localhost:${PORT}`);
});
