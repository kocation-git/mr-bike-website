const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { sendStatusEmail, sendReminderEmail, sendChecklistEmail, sendServiceReport } = require('../mailer');
const { generateInvoice, generateInvoiceNumber } = require('../utils/invoice');

/**
 * Get or create a customer record by email, returns the customer ID.
 * Also stores invoices in invoices/{customerId}/ folder.
 */
function getOrCreateCustomer(email, name, phone) {
    const existing = db.prepare('SELECT id FROM customers WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) return existing.id;
    const result = db.prepare('INSERT INTO customers (email, name, phone) VALUES (?, ?, ?)').run(
        email.toLowerCase().trim(), name, phone || ''
    );
    return result.lastInsertRowid;
}

/**
 * Save a PDF invoice to disk under invoices/{customerId}/
 */
function saveInvoiceToDisk(customerId, invoiceNum, pdfBuffer) {
    const invoiceDir = path.join(__dirname, '..', 'invoices', String(customerId));
    if (!fs.existsSync(invoiceDir)) fs.mkdirSync(invoiceDir, { recursive: true });
    const filePath = path.join(invoiceDir, `${invoiceNum}.pdf`);
    fs.writeFileSync(filePath, pdfBuffer);
    return filePath;
}

// Simple auth middleware
function requireAuth(req, res, next) {
    const adminPass = process.env.ADMIN_PASSWORD || 'mrbike2026';
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${adminPass}`) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    next();
}

// GET /api/admin/bookings — list bookings with search & pagination
router.get('/bookings', requireAuth, (req, res) => {
    const { status, from, to, search, page = 1, limit = 20 } = req.query;
    let query = 'SELECT * FROM bookings WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as count FROM bookings WHERE 1=1';
    const params = [];
    const countParams = [];

    if (status && status !== 'all') {
        query += ' AND status = ?'; params.push(status);
        countQuery += ' AND status = ?'; countParams.push(status);
    }
    if (from) {
        query += ' AND date >= ?'; params.push(from);
        countQuery += ' AND date >= ?'; countParams.push(from);
    }
    if (to) {
        query += ' AND date <= ?'; params.push(to);
        countQuery += ' AND date <= ?'; countParams.push(to);
    }
    if (search && search.trim()) {
        const s = `%${search.trim()}%`;
        const searchClause = ' AND (name LIKE ? OR email LIKE ? OR address LIKE ? OR service LIKE ? OR phone LIKE ?)';
        query += searchClause; params.push(s, s, s, s, s);
        countQuery += searchClause; countParams.push(s, s, s, s, s);
    }

    const total = db.prepare(countQuery).get(...countParams).count;
    const pageNum = Math.max(1, parseInt(page));
    const perPage = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * perPage;

    query += ' ORDER BY date ASC, time_slot ASC, created_at DESC LIMIT ? OFFSET ?';
    params.push(perPage, offset);
    const bookings = db.prepare(query).all(...params);

    res.json({ success: true, bookings, total, page: pageNum, totalPages: Math.ceil(total / perPage) });
});

// GET /api/admin/bookings/:id — single booking
router.get('/bookings/:id', requireAuth, (req, res) => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, booking });
});

// PATCH /api/admin/bookings/:id — update booking fields, status, notes
router.patch('/bookings/:id', requireAuth, async (req, res) => {
    const { status, admin_notes, name, email, phone, service, date, time_slot, address, details } = req.body;

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    // Build dynamic update
    const fields = [];
    const params = [];

    if (name !== undefined)        { fields.push('name = ?');        params.push(name); }
    if (email !== undefined)       { fields.push('email = ?');       params.push(email); }
    if (phone !== undefined)       { fields.push('phone = ?');       params.push(phone); }
    if (service !== undefined)     { fields.push('service = ?');     params.push(service); }
    if (date !== undefined)        { fields.push('date = ?');        params.push(date); }
    if (time_slot !== undefined)   { fields.push('time_slot = ?');   params.push(time_slot); }
    if (address !== undefined)     { fields.push('address = ?');     params.push(address); }
    if (details !== undefined)     { fields.push('details = ?');     params.push(details); }
    if (admin_notes !== undefined) { fields.push('admin_notes = ?'); params.push(admin_notes); }
    if (req.body.price !== undefined) { fields.push('price = ?'); params.push(parseFloat(req.body.price) || 0); }

    if (status !== undefined) {
        const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }
        fields.push('status = ?');
        params.push(status);
    }

    if (fields.length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    fields.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE bookings SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    // Audit log
    const changes = [];
    if (status && booking.status !== status) changes.push(`status: ${booking.status} → ${status}`);
    if (name !== undefined && name !== booking.name) changes.push(`name updated`);
    if (email !== undefined && email !== booking.email) changes.push(`email updated`);
    if (service !== undefined && service !== booking.service) changes.push(`service updated`);
    if (date !== undefined && date !== booking.date) changes.push(`date updated`);
    if (admin_notes !== undefined && admin_notes !== booking.admin_notes) changes.push(`notes updated`);
    if (req.body.price !== undefined) changes.push(`price set to ${req.body.price} DKK`);
    if (changes.length > 0) {
        db.prepare('INSERT INTO audit_log (action, booking_id, details) VALUES (?, ?, ?)').run(
            'booking_updated', req.params.id, changes.join(', ')
        );
    }

    // Send status change email if status actually changed
    let emailSent = false;
    let checklistSent = false;
    if (status && booking.status !== status && ['confirmed', 'completed', 'cancelled'].includes(status)) {
        try {
            await sendStatusEmail({ ...booking, status });
            emailSent = true;
        } catch (err) {
            console.error('Failed to send status email:', err.message);
        }

        // Send checklist email when confirmed (Feature 3)
        if (status === 'confirmed' && !booking.checklist_sent) {
            try {
                await sendChecklistEmail(booking);
                db.prepare('UPDATE bookings SET checklist_sent = 1 WHERE id = ?').run(booking.id);
                checklistSent = true;
            } catch (err) {
                console.error('Failed to send checklist email:', err.message);
            }
        }
    }

    const msg = emailSent
        ? `Booking #${req.params.id} updated — ${status} email sent to ${booking.email}${checklistSent ? ' + checklist' : ''}`
        : `Booking #${req.params.id} updated`;
    res.json({ success: true, message: msg, emailSent, checklistSent });
});

// DELETE /api/admin/bookings/:id
router.delete('/bookings/:id', requireAuth, (req, res) => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
    db.prepare('INSERT INTO audit_log (action, booking_id, details) VALUES (?, ?, ?)').run(
        'booking_deleted', req.params.id, `Deleted: ${booking.name} — ${booking.service} on ${booking.date}`
    );
    res.json({ success: true, message: `Booking #${req.params.id} deleted` });
});

// GET /api/admin/stats
router.get('/stats', requireAuth, (req, res) => {
    const total = db.prepare('SELECT COUNT(*) as count FROM bookings').get().count;
    const pending = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'").get().count;
    const confirmed = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'confirmed'").get().count;
    const completed = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'completed'").get().count;
    const cancelled = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'cancelled'").get().count;
    const today = new Date().toISOString().split('T')[0];
    const todayCount = db.prepare('SELECT COUNT(*) as count FROM bookings WHERE date = ?').get(today).count;
    const upcoming = db.prepare(
        "SELECT COUNT(*) as count FROM bookings WHERE date >= ? AND status IN ('pending', 'confirmed')"
    ).get(today).count;
    res.json({ success: true, stats: { total, pending, confirmed, completed, cancelled, todayCount, upcoming } });
});

// GET /api/admin/export — CSV export
router.get('/export', requireAuth, (req, res) => {
    const bookings = db.prepare('SELECT * FROM bookings ORDER BY date ASC').all();
    const headers = ['ID', 'Name', 'Email', 'Phone', 'Service', 'Date', 'Time Slot', 'Address', 'Details', 'Notes', 'Status', 'Created'];
    const csvRows = [headers.join(',')];
    for (const b of bookings) {
        csvRows.push([
            b.id,
            `"${(b.name || '').replace(/"/g, '""')}"`,
            `"${(b.email || '').replace(/"/g, '""')}"`,
            `"${(b.phone || '').replace(/"/g, '""')}"`,
            `"${(b.service || '').replace(/"/g, '""')}"`,
            b.date,
            `"${(b.time_slot || '').replace(/"/g, '""')}"`,
            `"${(b.address || '').replace(/"/g, '""')}"`,
            `"${(b.details || '').replace(/"/g, '""')}"`,
            `"${(b.admin_notes || '').replace(/"/g, '""')}"`,
            b.status,
            b.created_at
        ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=mr-bike-bookings-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csvRows.join('\n'));
});

// GET /api/admin/customer/:email — booking history for a customer
router.get('/customer/:email', requireAuth, (req, res) => {
    const bookings = db.prepare('SELECT * FROM bookings WHERE email = ? ORDER BY created_at DESC').all(req.params.email);
    const stats = {
        total: bookings.length,
        completed: bookings.filter(b => b.status === 'completed').length,
        firstBooking: bookings.length ? bookings[bookings.length - 1].created_at : null,
        lastBooking: bookings.length ? bookings[0].created_at : null,
    };
    res.json({ success: true, bookings, stats });
});

// GET /api/admin/calendar — bookings grouped by date for calendar view
router.get('/calendar', requireAuth, (req, res) => {
    const { month, year } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = `${y}-${String(m).padStart(2, '0')}-31`;

    const bookings = db.prepare(
        "SELECT * FROM bookings WHERE date >= ? AND date <= ? AND status != 'cancelled' ORDER BY date ASC, time_slot ASC"
    ).all(startDate, endDate);

    // Group by date
    const calendar = {};
    for (const b of bookings) {
        if (!calendar[b.date]) calendar[b.date] = [];
        calendar[b.date].push(b);
    }
    res.json({ success: true, calendar, month: m, year: y });
});

// POST /api/admin/send-reminders — send reminder emails for tomorrow's bookings
router.post('/send-reminders', requireAuth, async (req, res) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const bookings = db.prepare(
        "SELECT * FROM bookings WHERE date = ? AND status IN ('pending', 'confirmed')"
    ).all(tomorrowStr);

    let sent = 0;
    let failed = 0;
    for (const booking of bookings) {
        try {
            await sendReminderEmail(booking);
            sent++;
        } catch (err) {
            console.error(`Reminder failed for booking #${booking.id}:`, err.message);
            failed++;
        }
    }
    db.prepare('INSERT INTO audit_log (action, booking_id, details) VALUES (?, ?, ?)').run(
        'reminders_sent', null, `Sent ${sent} reminders for ${tomorrowStr}${failed ? `, ${failed} failed` : ''}`
    );
    res.json({ success: true, message: `Sent ${sent} reminders${failed ? `, ${failed} failed` : ''}`, sent, failed });
});

// GET /api/admin/analytics — charts data
router.get('/analytics', requireAuth, (req, res) => {
    // Weekly trend: bookings per week for the last 8 weeks
    const weeklyTrend = db.prepare(`
        SELECT strftime('%Y-W%W', date) as week,
               MIN(date) as week_start,
               COUNT(*) as count
        FROM bookings
        WHERE date >= date('now', '-56 days')
        GROUP BY week
        ORDER BY week ASC
    `).all();

    // Popular services: count per service type
    const popularServices = db.prepare(`
        SELECT service, COUNT(*) as count
        FROM bookings
        GROUP BY service
        ORDER BY count DESC
    `).all();

    // Busiest days of the week
    const busiestDays = db.prepare(`
        SELECT CASE CAST(strftime('%w', date) AS INTEGER)
            WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue'
            WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat'
        END as day,
        CAST(strftime('%w', date) AS INTEGER) as day_num,
        COUNT(*) as count
        FROM bookings
        GROUP BY day_num
        ORDER BY day_num ASC
    `).all();

    // Status breakdown
    const statusBreakdown = db.prepare(`
        SELECT status, COUNT(*) as count FROM bookings GROUP BY status
    `).all();

    res.json({ success: true, weeklyTrend, popularServices, busiestDays, statusBreakdown });
});

// GET /api/admin/services — list all services (including inactive)
router.get('/services', requireAuth, (req, res) => {
    const services = db.prepare('SELECT * FROM services ORDER BY sort_order ASC').all();
    res.json({ success: true, services });
});

// POST /api/admin/services — add a new service
router.post('/services', requireAuth, (req, res) => {
    const { name, emoji, price, duration, duration_minutes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Service name required' });
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM services').get().m || 0;
    const durMin = parseInt(duration_minutes) || (duration ? parseInt(String(duration).match(/(\d+)/)?.[1] || '120') : 120);
    db.prepare('INSERT INTO services (name, emoji, price, duration, duration_minutes, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(
        name, emoji || '', parseFloat(price) || 0, duration || '', durMin, maxOrder + 1
    );
    db.prepare('INSERT INTO audit_log (action, details) VALUES (?, ?)').run('service_added', `Added service: ${name} (${price} DKK, ~${durMin} min)`);
    res.json({ success: true, message: 'Service added' });
});

// PATCH /api/admin/services/:id — update a service
router.patch('/services/:id', requireAuth, (req, res) => {
    const { name, emoji, price, duration, active } = req.body;
    const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
    if (!svc) return res.status(404).json({ success: false, message: 'Service not found' });

    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (emoji !== undefined) { fields.push('emoji = ?'); params.push(emoji); }
    if (price !== undefined) { fields.push('price = ?'); params.push(parseFloat(price) || 0); }
    if (duration !== undefined) { fields.push('duration = ?'); params.push(duration); }
    if (req.body.duration_minutes !== undefined) { fields.push('duration_minutes = ?'); params.push(parseInt(req.body.duration_minutes) || 120); }
    if (active !== undefined) { fields.push('active = ?'); params.push(active ? 1 : 0); }
    if (fields.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });

    params.push(req.params.id);
    db.prepare(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true, message: 'Service updated' });
});

// DELETE /api/admin/services/:id — delete a service
router.delete('/services/:id', requireAuth, (req, res) => {
    const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
    if (!svc) return res.status(404).json({ success: false, message: 'Service not found' });
    db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
    db.prepare('INSERT INTO audit_log (action, details) VALUES (?, ?)').run('service_deleted', `Deleted service: ${svc.name}`);
    res.json({ success: true, message: 'Service deleted' });
});

// --- Promo Codes ---
// GET /api/admin/promos — list all promo codes
router.get('/promos', requireAuth, (req, res) => {
    const promos = db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all();
    res.json({ success: true, promos });
});

// POST /api/admin/promos — create a promo code
router.post('/promos', requireAuth, (req, res) => {
    const { code, discount_type, discount_value, max_uses, min_order, expires_at } = req.body;
    if (!code || !code.trim()) return res.status(400).json({ success: false, message: 'Code is required' });
    if (!discount_value || discount_value <= 0) return res.status(400).json({ success: false, message: 'Discount value must be positive' });
    if (discount_type === 'percent' && discount_value > 100) return res.status(400).json({ success: false, message: 'Percent discount cannot exceed 100' });

    try {
        db.prepare(`INSERT INTO promo_codes (code, discount_type, discount_value, max_uses, min_order, expires_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
            code.trim().toUpperCase(), discount_type || 'percent', parseFloat(discount_value), max_uses ? parseInt(max_uses) : null, parseFloat(min_order) || 0, expires_at || null
        );
        db.prepare('INSERT INTO audit_log (action, details) VALUES (?, ?)').run('promo_created', `Created promo: ${code.trim().toUpperCase()} (${discount_value}${discount_type === 'fixed' ? ' DKK' : '%'} off)`);
        res.json({ success: true, message: 'Promo code created' });
    } catch (e) {
        if (e.message.includes('UNIQUE')) return res.status(409).json({ success: false, message: 'Code already exists' });
        throw e;
    }
});

// PATCH /api/admin/promos/:id — update promo code
router.patch('/promos/:id', requireAuth, (req, res) => {
    const promo = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(req.params.id);
    if (!promo) return res.status(404).json({ success: false, message: 'Promo not found' });

    const fields = [];
    const params = [];
    if (req.body.active !== undefined) { fields.push('active = ?'); params.push(req.body.active ? 1 : 0); }
    if (req.body.max_uses !== undefined) { fields.push('max_uses = ?'); params.push(req.body.max_uses ? parseInt(req.body.max_uses) : null); }
    if (req.body.expires_at !== undefined) { fields.push('expires_at = ?'); params.push(req.body.expires_at || null); }
    if (fields.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });

    params.push(req.params.id);
    db.prepare(`UPDATE promo_codes SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true, message: 'Promo updated' });
});

// DELETE /api/admin/promos/:id
router.delete('/promos/:id', requireAuth, (req, res) => {
    const promo = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(req.params.id);
    if (!promo) return res.status(404).json({ success: false, message: 'Promo not found' });
    db.prepare('DELETE FROM promo_codes WHERE id = ?').run(req.params.id);
    db.prepare('INSERT INTO audit_log (action, details) VALUES (?, ?)').run('promo_deleted', `Deleted promo: ${promo.code}`);
    res.json({ success: true, message: 'Promo deleted' });
});

// GET /api/admin/audit — audit log viewer
router.get('/audit', requireAuth, (req, res) => {
    const { page = 1, limit = 30 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const perPage = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * perPage;

    const total = db.prepare('SELECT COUNT(*) as count FROM audit_log').get().count;
    const logs = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?').all(perPage, offset);

    res.json({ success: true, logs, total, page: pageNum, totalPages: Math.ceil(total / perPage) });
});

// GET /api/admin/revenue — revenue analytics
router.get('/revenue', requireAuth, (req, res) => {
    // Revenue by month (last 12 months)
    const monthlyRevenue = db.prepare(`
        SELECT strftime('%Y-%m', date) as month,
               SUM(price) as revenue,
               COUNT(*) as bookings
        FROM bookings
        WHERE status = 'completed' AND price > 0 AND date >= date('now', '-12 months')
        GROUP BY month
        ORDER BY month ASC
    `).all();

    // Revenue by service
    const serviceRevenue = db.prepare(`
        SELECT service,
               SUM(price) as revenue,
               COUNT(*) as bookings,
               ROUND(AVG(price), 0) as avg_price
        FROM bookings
        WHERE status = 'completed' AND price > 0
        GROUP BY service
        ORDER BY revenue DESC
    `).all();

    // Total revenue stats
    const totals = db.prepare(`
        SELECT SUM(price) as total_revenue,
               COUNT(*) as total_completed,
               ROUND(AVG(price), 0) as avg_per_booking
        FROM bookings
        WHERE status = 'completed' AND price > 0
    `).get();

    // This week vs last week
    const thisWeek = db.prepare(`
        SELECT COALESCE(SUM(price), 0) as revenue
        FROM bookings
        WHERE status = 'completed' AND price > 0
        AND date >= date('now', 'weekday 0', '-6 days')
    `).get().revenue;

    const lastWeek = db.prepare(`
        SELECT COALESCE(SUM(price), 0) as revenue
        FROM bookings
        WHERE status = 'completed' AND price > 0
        AND date >= date('now', 'weekday 0', '-13 days')
        AND date < date('now', 'weekday 0', '-6 days')
    `).get().revenue;

    res.json({
        success: true,
        monthlyRevenue,
        serviceRevenue,
        totals: totals || { total_revenue: 0, total_completed: 0, avg_per_booking: 0 },
        thisWeek,
        lastWeek,
    });
});

// ==================== BLOCKED SLOTS ====================

// GET /api/admin/blocked-slots?month=X&year=Y  (or ?all=1 for all upcoming)
router.get('/blocked-slots', requireAuth, (req, res) => {
    if (req.query.all === '1') {
        const today = new Date().toISOString().split('T')[0];
        const blocks = db.prepare('SELECT * FROM blocked_slots WHERE date >= ? ORDER BY date ASC, time_slot ASC').all(today);
        return res.json({ success: true, blocks });
    }
    const y = parseInt(req.query.year) || new Date().getFullYear();
    const m = parseInt(req.query.month) || new Date().getMonth() + 1;
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = `${y}-${String(m).padStart(2, '0')}-31`;
    const blocks = db.prepare('SELECT * FROM blocked_slots WHERE date >= ? AND date <= ? ORDER BY date ASC, time_slot ASC').all(startDate, endDate);
    res.json({ success: true, blocks });
});

// Canonical slot labels — must match ALL_SLOTS in utils/slots.js
const VALID_SLOTS = ['08:00 \u2013 10:00', '10:00 \u2013 12:00', '12:00 \u2013 14:00', '14:00 \u2013 16:00', '16:00 \u2013 18:00', '18:00 \u2013 20:00'];

function normalizeSlot(raw) {
    // Strip all dash-like chars and spaces around them, then match against canonical labels
    const cleaned = raw.replace(/\s*[\u2013\u2014\-\u2012\uFFFD]+\s*/g, '|').trim();
    return VALID_SLOTS.find(s => s.replace(/\s*\u2013\s*/g, '|') === cleaned) || null;
}

// POST /api/admin/blocked-slots
router.post('/blocked-slots', requireAuth, (req, res) => {
    const { date, reason } = req.body;
    const time_slot = req.body.time_slot ? normalizeSlot(req.body.time_slot) : null;
    if (!date || !time_slot) return res.status(400).json({ success: false, message: 'Date and valid time slot required' });
    // Check if already blocked
    const existing = db.prepare('SELECT id FROM blocked_slots WHERE date = ? AND time_slot = ?').get(date, time_slot);
    if (existing) return res.status(409).json({ success: false, message: 'Slot already blocked' });
    db.prepare('INSERT INTO blocked_slots (date, time_slot, reason) VALUES (?, ?, ?)').run(date, time_slot, reason || '');
    db.prepare('INSERT INTO audit_log (action, details) VALUES (?, ?)').run('slot_blocked', `Blocked ${time_slot} on ${date}: ${reason || 'no reason'}`);
    res.json({ success: true, message: 'Slot blocked' });
});

// DELETE /api/admin/blocked-slots/:id
router.delete('/blocked-slots/:id', requireAuth, (req, res) => {
    const block = db.prepare('SELECT * FROM blocked_slots WHERE id = ?').get(req.params.id);
    if (!block) return res.status(404).json({ success: false, message: 'Block not found' });
    db.prepare('DELETE FROM blocked_slots WHERE id = ?').run(req.params.id);
    db.prepare('INSERT INTO audit_log (action, details) VALUES (?, ?)').run('slot_unblocked', `Unblocked ${block.time_slot} on ${block.date}`);
    res.json({ success: true, message: 'Block removed' });
});

// ==================== SERVICE REPORTS ====================

// POST /api/admin/bookings/:id/report — create/update service report with pricing
router.post('/bookings/:id/report', requireAuth, async (req, res) => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const { work_done, parts_replaced, extra_charges, recommendations, mechanic_notes, final_total } = req.body;
    if (!work_done || !Array.isArray(work_done) || work_done.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one work item is required' });
    }

    // Generate invoice number if not already assigned
    let invoiceNum = booking.invoice_number;
    if (!invoiceNum) {
        invoiceNum = generateInvoiceNumber(db);
        db.prepare('UPDATE bookings SET invoice_number = ? WHERE id = ?').run(invoiceNum, booking.id);
    }

    // Update final price on the booking
    if (final_total !== undefined) {
        db.prepare('UPDATE bookings SET price = ? WHERE id = ?').run(parseFloat(final_total) || 0, booking.id);
    }

    const existing = db.prepare('SELECT id FROM service_reports WHERE booking_id = ?').get(req.params.id);
    if (existing) {
        db.prepare('UPDATE service_reports SET work_done = ?, parts_replaced = ?, extra_charges = ?, recommendations = ?, mechanic_notes = ?, final_total = ? WHERE booking_id = ?').run(
            JSON.stringify(work_done), JSON.stringify(parts_replaced || []), JSON.stringify(extra_charges || []), JSON.stringify(recommendations || []), mechanic_notes || '', parseFloat(final_total) || 0, req.params.id
        );
    } else {
        db.prepare('INSERT INTO service_reports (booking_id, work_done, parts_replaced, extra_charges, recommendations, mechanic_notes, final_total) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            req.params.id, JSON.stringify(work_done), JSON.stringify(parts_replaced || []), JSON.stringify(extra_charges || []), JSON.stringify(recommendations || []), mechanic_notes || '', parseFloat(final_total) || 0
        );
    }

    // Save invoice PDF to disk under customer folder
    try {
        const customerId = getOrCreateCustomer(booking.email, booking.name, booking.phone);
        const updatedBooking = { ...booking, invoice_number: invoiceNum, price: parseFloat(final_total) || booking.price };
        const report = db.prepare('SELECT * FROM service_reports WHERE booking_id = ?').get(req.params.id);
        const pdfBuffer = await generateInvoice(updatedBooking, report);
        const savedPath = saveInvoiceToDisk(customerId, invoiceNum, pdfBuffer);
        console.log(`[Invoice] Saved ${invoiceNum} for customer #${customerId} → ${savedPath}`);
    } catch (err) {
        console.error('[Invoice] Failed to save PDF to disk:', err.message);
    }

    db.prepare('INSERT INTO audit_log (action, booking_id, details) VALUES (?, ?, ?)').run(
        'report_created', req.params.id, `Service report created/updated for booking #${req.params.id} (total: ${final_total} DKK)`
    );
    res.json({ success: true, message: 'Report saved' });
});

// GET /api/admin/bookings/:id/report
router.get('/bookings/:id/report', requireAuth, (req, res) => {
    const report = db.prepare('SELECT * FROM service_reports WHERE booking_id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: 'No report found' });
    res.json({ success: true, report });
});

// POST /api/admin/bookings/:id/report/send — email the service report + PDF invoice to customer
router.post('/bookings/:id/report/send', requireAuth, async (req, res) => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const report = db.prepare('SELECT * FROM service_reports WHERE booking_id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: 'No report found. Create one first.' });

    try {
        // Generate PDF invoice
        const pdfBuffer = await generateInvoice(booking, report);

        // Save to disk
        const customerId = getOrCreateCustomer(booking.email, booking.name, booking.phone);
        const invoiceNum = booking.invoice_number || `MRB-${booking.id}`;
        saveInvoiceToDisk(customerId, invoiceNum, pdfBuffer);

        // Send email with PDF attached
        await sendServiceReport(booking, report, pdfBuffer);
        db.prepare('UPDATE bookings SET report_sent = 1 WHERE id = ?').run(req.params.id);
        db.prepare('INSERT INTO audit_log (action, booking_id, details) VALUES (?, ?, ?)').run(
            'report_sent', req.params.id, `Service report + invoice emailed to ${booking.email}`
        );
        res.json({ success: true, message: `Report & invoice sent to ${booking.email}` });
    } catch (err) {
        console.error('Failed to send report:', err.message);
        res.status(500).json({ success: false, message: 'Failed to send report email' });
    }
});

// GET /api/admin/bookings/:id/invoice — download PDF invoice
router.get('/bookings/:id/invoice', requireAuth, async (req, res) => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const report = db.prepare('SELECT * FROM service_reports WHERE booking_id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: 'No report found' });

    const invoiceNum = booking.invoice_number || `MRB-${booking.id}`;

    // Try to serve from disk first
    const customer = db.prepare('SELECT id FROM customers WHERE email = ?').get(booking.email.toLowerCase().trim());
    if (customer) {
        const filePath = path.join(__dirname, '..', 'invoices', String(customer.id), `${invoiceNum}.pdf`);
        if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoiceNum}.pdf`);
            return res.sendFile(filePath);
        }
    }

    // Fallback: generate on the fly and save
    try {
        const pdfBuffer = await generateInvoice(booking, report);
        const customerId = getOrCreateCustomer(booking.email, booking.name, booking.phone);
        saveInvoiceToDisk(customerId, invoiceNum, pdfBuffer);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoiceNum}.pdf`);
        res.send(pdfBuffer);
    } catch (err) {
        console.error('Invoice generation failed:', err.message);
        res.status(500).json({ success: false, message: 'Failed to generate invoice' });
    }
});

// GET /api/admin/customers — list all customers with their invoice folders
router.get('/customers', requireAuth, (req, res) => {
    const customers = db.prepare(`
        SELECT c.id, c.email, c.name, c.phone, c.created_at,
               COUNT(b.id) as total_bookings,
               SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) as completed_bookings
        FROM customers c
        LEFT JOIN bookings b ON LOWER(TRIM(b.email)) = c.email
        GROUP BY c.id ORDER BY c.name ASC
    `).all();
    res.json({ success: true, customers });
});

// GET /api/admin/customers/:id/invoices — list invoices for a customer
router.get('/customers/:id/invoices', requireAuth, (req, res) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const invoiceDir = path.join(__dirname, '..', 'invoices', String(customer.id));
    let invoices = [];
    if (fs.existsSync(invoiceDir)) {
        invoices = fs.readdirSync(invoiceDir)
            .filter(f => f.endsWith('.pdf'))
            .map(f => ({
                filename: f,
                invoiceNumber: f.replace('.pdf', ''),
                url: `/api/admin/customers/${customer.id}/invoice/${f}`,
            }));
    }
    res.json({ success: true, customer, invoices });
});

// GET /api/admin/customers/:id/invoice/:filename — download a specific invoice
router.get('/customers/:id/invoice/:filename', requireAuth, (req, res) => {
    const filePath = path.join(__dirname, '..', 'invoices', req.params.id, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${req.params.filename}`);
    res.sendFile(filePath);
});

// ==================== ZONES MANAGEMENT ====================

// GET /api/admin/zones
router.get('/zones', requireAuth, (req, res) => {
    const zones = db.prepare('SELECT * FROM zones ORDER BY surcharge ASC').all();
    res.json({ success: true, zones });
});

// PATCH /api/admin/zones/:id
router.patch('/zones/:id', requireAuth, (req, res) => {
    const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(req.params.id);
    if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });

    const fields = [];
    const params = [];
    if (req.body.name !== undefined) { fields.push('name = ?'); params.push(req.body.name); }
    if (req.body.keywords !== undefined) { fields.push('keywords = ?'); params.push(req.body.keywords); }
    if (req.body.surcharge !== undefined) { fields.push('surcharge = ?'); params.push(parseFloat(req.body.surcharge) || 0); }
    if (req.body.active !== undefined) { fields.push('active = ?'); params.push(req.body.active ? 1 : 0); }
    if (fields.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });

    params.push(req.params.id);
    db.prepare(`UPDATE zones SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true, message: 'Zone updated' });
});

module.exports = router;
