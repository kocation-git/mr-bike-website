const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const DOMPurify = require('isomorphic-dompurify');
const db = require('../db');
const { transporter, esc, getFromAddress, formatDate } = require('../mailer');
const { getAvailableSlots, getMonthAvailability, getWeekSlotsRemaining, slotsNeeded, ALL_SLOTS } = require('../utils/slots');

// Sanitize a plain-text field: strip all HTML
const clean = (s) => DOMPurify.sanitize(String(s || ''), { ALLOWED_TAGS: [] }).trim();

// GET /api/services — public list of active services
router.get('/services', (req, res) => {
    const services = db.prepare('SELECT id, name, emoji, price, duration, duration_minutes FROM services WHERE active = 1 ORDER BY sort_order ASC').all();
    res.json({ success: true, services });
});

// GET /api/promo/validate?code=XXX&subtotal=NNN&email=...&phone=... — validate a promo code
router.get('/promo/validate', (req, res) => {
    const { code, subtotal, email, phone } = req.query;
    if (!code) return res.json({ success: false, message: 'No code provided' });

    const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ? AND active = 1').get(code.trim().toUpperCase());
    if (!promo) return res.json({ success: false, message: 'Invalid promo code' });

    // Check expiry
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        return res.json({ success: false, message: 'This promo code has expired' });
    }
    // Check max uses
    if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
        return res.json({ success: false, message: 'This promo code has reached its usage limit' });
    }
    // Check if this email or phone already used this promo code
    const upperCode = code.trim().toUpperCase();
    if (email || phone) {
        const used = db.prepare(
            'SELECT id FROM promo_usage WHERE promo_code = ? AND (email = ? OR phone = ?)'
        ).get(upperCode, (email || '').trim().toLowerCase(), (phone || '').trim());
        if (used) {
            return res.json({ success: false, message: 'You have already used this promo code.' });
        }
    }
    // Check minimum order
    const sub = parseFloat(subtotal) || 0;
    if (promo.min_order > 0 && sub < promo.min_order) {
        return res.json({ success: false, message: `Minimum order of ${promo.min_order} DKK required` });
    }

    // Calculate discount
    let discount = 0;
    if (promo.discount_type === 'percent') {
        discount = Math.round(sub * (promo.discount_value / 100));
    } else {
        discount = Math.min(promo.discount_value, sub);
    }

    res.json({
        success: true,
        code: promo.code,
        discount_type: promo.discount_type,
        discount_value: promo.discount_value,
        discount,
        label: promo.discount_type === 'percent' ? `${promo.discount_value}% off` : `${promo.discount_value} DKK off`,
    });
});

// Multer setup for photo uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `bike-${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Only JPG, PNG, and WebP images are allowed'));
    }
});

// reCAPTCHA verification helper
async function verifyCaptcha(token) {
    const secret = process.env.RECAPTCHA_SECRET;
    if (!secret) return true;

    const response = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${secret}&response=${token}`,
    });
    const data = await response.json();
    return data.success && data.score >= 0.5;
}

// ==================== AVAILABILITY ENDPOINTS ====================

// GET /api/availability?date=YYYY-MM-DD&duration=N — check available slots for a date
router.get('/availability', (req, res) => {
    const { date, duration } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'Date required' });

    const durationMin = parseInt(duration) || 120;
    const available = getAvailableSlots(date, durationMin);

    // For backward compatibility, also return booked list
    const booked = db.prepare(
        "SELECT time_slot FROM bookings WHERE date = ? AND status IN ('pending', 'confirmed') AND time_slot != ''"
    ).all(date).map(b => b.time_slot);

    res.json({ success: true, available, booked });
});

// GET /api/availability/month?month=X&year=Y — month calendar data
router.get('/availability/month', (req, res) => {
    const y = parseInt(req.query.year) || new Date().getFullYear();
    const m = parseInt(req.query.month) || new Date().getMonth() + 1;
    const calendar = getMonthAvailability(y, m);
    res.json({ success: true, calendar, month: m, year: y });
});

// GET /api/availability/week-count — slots remaining this week
router.get('/availability/week-count', (req, res) => {
    const data = getWeekSlotsRemaining();
    res.json({ success: true, ...data });
});

// ==================== ZONES ====================

// GET /api/zones — list all active zones
router.get('/zones', (req, res) => {
    const zones = db.prepare('SELECT id, name, keywords, surcharge FROM zones WHERE active = 1 ORDER BY surcharge ASC').all();
    res.json({ success: true, zones });
});

// HQ coordinates and distance-based zone thresholds (meters)
const HQ_LAT = 55.6499;
const HQ_LNG = 12.6106;
const ZONE_THRESHOLDS = [
    { name: 'Central',    maxDistance: 5000,  surcharge: 0 },
    { name: 'Inner Ring', maxDistance: 8000,  surcharge: 50 },
    { name: 'Outer Ring', maxDistance: 12000, surcharge: 100 },
];

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function zoneFromDistance(dist) {
    for (const z of ZONE_THRESHOLDS) {
        if (dist <= z.maxDistance) return z;
    }
    return { name: 'Other', maxDistance: Infinity, surcharge: 100 };
}

function formatZoneLabel(zone) {
    return zone.surcharge > 0 ? `${zone.name} (+${zone.surcharge} DKK travel)` : `${zone.name} (no surcharge)`;
}

// GET /api/zone/lookup?address=...&lat=...&lng=... — detect zone from coordinates or address keywords
router.get('/zone/lookup', (req, res) => {
    const { address, lat, lng } = req.query;
    if (!address && !lat) return res.json({ success: false, message: 'Address required' });

    // Primary: distance-based detection if coordinates provided
    if (lat && lng) {
        const dist = haversineDistance(HQ_LAT, HQ_LNG, parseFloat(lat), parseFloat(lng));
        const zone = zoneFromDistance(dist);
        return res.json({
            success: true,
            zone: zone.name,
            surcharge: zone.surcharge,
            distance: Math.round(dist),
            label: formatZoneLabel(zone),
        });
    }

    // Fallback: keyword-based detection from address text
    const zones = db.prepare('SELECT * FROM zones WHERE active = 1 ORDER BY surcharge ASC').all();
    const addrLower = (address || '').toLowerCase();

    for (const zone of zones) {
        const keywords = zone.keywords.split(',').map(k => k.trim().toLowerCase());
        for (const keyword of keywords) {
            if (keyword && addrLower.includes(keyword)) {
                return res.json({
                    success: true,
                    zone: zone.name,
                    surcharge: zone.surcharge,
                    label: formatZoneLabel(zone),
                });
            }
        }
    }

    // No zone matched — default to outer ring
    res.json({
        success: true,
        zone: 'Other',
        surcharge: 100,
        label: 'Other area (+100 DKK travel)',
    });
});

// Get booking details (for confirmation page)
router.get('/booking/:id', (req, res) => {
    const booking = db.prepare('SELECT id, name, service, date, time_slot, address, zone, zone_surcharge FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, booking });
});

// ==================== BOOKING SUBMISSION ====================

router.post('/booking', upload.single('photo'), async (req, res) => {
    try {
        const { name, email, phone, service, date, timeSlot, address, details, website, captchaToken, price, promoCode, subtotal, discount, zone, zoneSurcharge, durationMinutes } = req.body;

        // --- Honeypot check ---
        if (website) {
            console.log('Honeypot triggered, ignoring submission');
            return res.status(200).json({ success: true, message: 'Booking received!' });
        }

        // --- reCAPTCHA check ---
        if (process.env.RECAPTCHA_SECRET) {
            const isHuman = await verifyCaptcha(captchaToken);
            if (!isHuman) {
                return res.status(403).json({ success: false, message: 'CAPTCHA verification failed. Please try again.' });
            }
        }

        // --- Validation ---
        if (!name || name.trim().length < 2) return res.status(400).json({ success: false, message: 'Please enter your full name.' });
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Please enter a valid email.' });
        if (!service) return res.status(400).json({ success: false, message: 'Please select a service.' });
        if (!date) return res.status(400).json({ success: false, message: 'Please select a preferred date.' });
        if (!address || address.trim().length < 5) return res.status(400).json({ success: false, message: 'Please enter your address.' });

        // --- Calculate total duration from selected services ---
        const serviceNames = service.split(',').map(s => s.trim());
        let totalDuration = 0;
        for (const svcName of serviceNames) {
            const svc = db.prepare('SELECT duration_minutes FROM services WHERE name = ? AND active = 1').get(svcName);
            if (svc) totalDuration += svc.duration_minutes;
        }
        if (totalDuration === 0) totalDuration = parseInt(durationMinutes) || 120;

        // --- Check slot availability (duration-aware overlap prevention) ---
        if (timeSlot) {
            // Normalize any dash variant to canonical en-dash format
            const normDash = s => s.replace(/\s*[\u2013\u2014\-\u2012\uFFFD]+\s*/g, ' \u2013 ').trim();
            const normalizedSlot = normDash(timeSlot);
            const available = getAvailableSlots(date, totalDuration);
            const availableValues = available.map(s => normDash(typeof s === 'string' ? s : s.value));
            if (!availableValues.includes(normalizedSlot)) {
                return res.status(409).json({ success: false, message: 'That time slot is no longer available for the selected service duration. Please choose another.' });
            }
        }

        // --- Sanitize ---
        const safeName = esc(name.trim());
        const safeEmail = esc(email.trim());
        const safePhone = esc((phone || '').trim());
        const safeService = esc(service);
        const safeAddress = esc(address.trim());
        const safeDetails = details ? esc(details.trim()).replace(/\n/g, '<br>') : '';
        const safeTimeSlot = timeSlot ? esc(timeSlot) : '';

        const formattedDate = formatDate(date);
        const receivedAt = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
        const timeDisplay = safeTimeSlot ? ` (${safeTimeSlot})` : '';

        // Photo path if uploaded
        const photoPath = req.file ? req.file.filename : '';

        // --- Check promo code per-user usage (email or phone) ---
        if (promoCode) {
            const upperPromo = promoCode.trim().toUpperCase();
            const alreadyUsed = db.prepare(
                'SELECT id FROM promo_usage WHERE promo_code = ? AND (email = ? OR phone = ?)'
            ).get(upperPromo, email.trim().toLowerCase(), (phone || '').trim());
            if (alreadyUsed) {
                return res.status(400).json({ success: false, message: 'You have already used this promo code.' });
            }
        }

        // --- Generate tokens ---
        const modificationToken = crypto.randomBytes(32).toString('hex');
        const verificationToken = crypto.randomBytes(32).toString('hex');
        // Modification token expires 7 days after booking date
        const tokenExpiresAt = new Date(new Date(date + 'T23:59:59').getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const finalPrice = parseFloat(price) || 0;

        // --- Save to database ---
        const cleanSubtotal = parseFloat(subtotal) || 0;
        const cleanDiscount = parseFloat(discount) || 0;
        const cleanPromoCode = promoCode ? clean(promoCode).toUpperCase() : '';
        const cleanName = clean(name);
        const cleanEmail = email.trim();
        const cleanPhone = clean(phone || '');
        const cleanService = clean(service);
        const cleanAddress = clean(address);
        const cleanDetails = clean(details || '');
        const cleanTimeSlot = (timeSlot || '').trim();
        const cleanZone = clean(zone || '');
        const cleanZoneSurcharge = parseFloat(zoneSurcharge) || 0;

        const stmt = db.prepare(`
            INSERT INTO bookings (name, email, phone, service, date, time_slot, address, details, photo, price, subtotal, discount, promo_code, status, modification_token, token_expires_at, duration_minutes, zone, zone_surcharge, email_verified, verification_token)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, ?)
        `);
        const result = stmt.run(cleanName, cleanEmail, cleanPhone, cleanService, date, cleanTimeSlot, cleanAddress, cleanDetails, photoPath, finalPrice, cleanSubtotal, cleanDiscount, cleanPromoCode, modificationToken, tokenExpiresAt, totalDuration, cleanZone, cleanZoneSurcharge, verificationToken);
        const bookingId = result.lastInsertRowid;

        // Increment promo code usage and record per-user usage
        if (promoCode) {
            const upperPromo = promoCode.trim().toUpperCase();
            db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ? AND active = 1').run(upperPromo);
            db.prepare('INSERT INTO promo_usage (promo_code, email, phone, booking_id) VALUES (?, ?, ?, ?)').run(
                upperPromo, cleanEmail.toLowerCase(), cleanPhone, bookingId
            );
        }

        // Audit log
        const promoNote = promoCode ? ` (promo: ${promoCode.trim().toUpperCase()})` : '';
        const zoneNote = cleanZone ? ` [zone: ${cleanZone}]` : '';
        db.prepare('INSERT INTO audit_log (action, booking_id, details) VALUES (?, ?, ?)').run(
            'booking_created', bookingId, `New booking: ${service} for ${cleanName} on ${date}${promoNote}${zoneNote}`
        );

        console.log(`New booking #${bookingId} from ${safeName} — ${safeService} on ${formattedDate}${timeDisplay} | time_slot="${cleanTimeSlot}"`);

        const fromAddress = getFromAddress();
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const verifyLink = `${baseUrl}/api/verify/${verificationToken}`;

        // --- Send verification email to customer ---
        await transporter.sendMail({
            from: fromAddress,
            to: email.trim(),
            subject: `Verify Your Booking — ${safeService} | Mr. Bike`,
            html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
        <p style="margin:0;color:#E8186D;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:26px;font-weight:700;">Confirm Your Email</h1>
      </td></tr>
      <tr><td style="background:#ffffff;padding:40px;">
        <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.7;">
          Thanks for booking with <strong>Mr. Bike</strong>! Please verify your email to complete your booking for <strong>${safeService}</strong> on <strong>${formattedDate}${timeDisplay}</strong>.
        </p>

        <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;padding:16px 20px;margin-bottom:24px;text-align:center;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#92400E;">Your time slot is held for 1 hour</p>
          <p style="margin:4px 0 0;font-size:12px;color:#78350F;">Please verify now to secure your booking.</p>
        </div>

        <div style="text-align:center;margin-bottom:28px;">
          <a href="${verifyLink}" style="background:#E8186D;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:700;display:inline-block;">Verify & Confirm Booking</a>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:28px;">
          <tr><td style="padding:24px;">
            <p style="margin:0 0 16px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Booking Summary</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;width:90px;border-bottom:1px solid #f1f5f9;">Reference</td><td style="padding:7px 0;color:#E8186D;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9;">#${bookingId}</td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Service</td><td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${safeService}</td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Date</td><td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${formattedDate}${timeDisplay}</td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Address</td><td style="padding:7px 0;color:#0f172a;font-size:14px;">${safeAddress}</td></tr>
            </table>
          </td></tr>
        </table>

        <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">If you did not make this booking, you can safely ignore this email and the booking will be automatically cancelled.</p>
      </td></tr>
      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;color:#E8186D;font-size:15px;font-weight:700;">Mr. Bike</p>
        <p style="margin:0;color:#475569;font-size:13px;">Mobile Bike Repair Copenhagen &nbsp;·&nbsp; +45 91 61 00 13</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
        });

        console.log(`Verification email sent for booking #${bookingId} to ${cleanEmail}`);
        res.status(200).json({
            success: true,
            message: 'Almost there! Check your email to verify and confirm your booking.',
            bookingId,
            requiresVerification: true,
        });

    } catch (error) {
        console.error('Booking error:', error);
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again or contact us on WhatsApp.' });
    }
});

// ==================== EMAIL VERIFICATION ====================

// GET /api/verify/:token — verify email and activate booking
router.get('/verify/:token', async (req, res) => {
    const { token } = req.params;
    if (!token || token.length < 32) {
        return res.status(400).send(verifyPage('Invalid Link', 'This verification link is not valid.', 'error'));
    }

    const booking = db.prepare(
        "SELECT * FROM bookings WHERE verification_token = ? AND verification_token != ''"
    ).get(token);

    if (!booking) {
        return res.status(404).send(verifyPage('Link Expired', 'This verification link is no longer valid. The booking may have been cancelled.', 'error'));
    }

    if (booking.email_verified) {
        return res.send(verifyPage('Already Verified', `Your booking #${booking.id} for <strong>${esc(booking.service)}</strong> is already confirmed!`, 'success', booking.id));
    }

    if (booking.status === 'cancelled') {
        return res.send(verifyPage('Booking Cancelled', 'This booking has been cancelled because the email was not verified in time.', 'error'));
    }

    // Mark as verified and set status to confirmed
    db.prepare("UPDATE bookings SET email_verified = 1, verification_token = '', status = 'confirmed' WHERE id = ?").run(booking.id);

    db.prepare('INSERT INTO audit_log (action, booking_id, details, performed_by) VALUES (?, ?, ?, ?)').run(
        'email_verified', booking.id, `Email verified and auto-confirmed for ${booking.email}`, 'customer'
    );

    // Now send the owner notification and customer confirmation emails
    try {
        const fromAddress = getFromAddress();
        const ownerEmail = process.env.OWNER_EMAIL || 'fernando.pcn@gmail.com';
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const modifyLink = `${baseUrl}/modify?token=${booking.modification_token}`;
        const formattedDate = formatDate(booking.date);
        const timeDisplay = booking.time_slot ? ` at ${booking.time_slot}` : '';
        const safeName = esc(booking.name);
        const safeEmail = esc(booking.email);
        const safePhone = esc(booking.phone || '');
        const safeService = esc(booking.service);
        const safeAddress = esc(booking.address);
        const safeDetails = esc(booking.details || '');
        const receivedAt = new Date(booking.created_at).toLocaleString('en-DK');
        const photoNotice = booking.photo ? `<p style="margin:16px 0 0;color:#64748b;font-size:13px;">Customer attached a photo — <a href="${baseUrl}/uploads/${booking.photo}" style="color:#3b82f6;">View photo</a></p>` : '';
        const zoneInfo = booking.zone ? `<tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Zone</td><td style="padding:7px 0;color:#0f172a;font-size:14px;">${esc(booking.zone)}${booking.zone_surcharge > 0 ? ` (+${booking.zone_surcharge} DKK)` : ''}</td></tr>` : '';
        // Owner notification
        await transporter.sendMail({
            from: fromAddress,
            to: ownerEmail,
            subject: `New Booking #${booking.id}: ${safeService} — ${safeName}`,
            html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><p style="margin:0;color:#E8186D;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike</p>
            <h1 style="margin:6px 0 0;color:#ffffff;font-size:24px;font-weight:700;">New Booking #${booking.id}</h1></td>
          <td align="right"><div style="background:#E8186D;border-radius:50%;width:52px;height:52px;text-align:center;line-height:52px;font-size:26px;">🔧</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#ffffff;padding:40px;">
        <div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:8px;padding:10px 16px;margin-bottom:20px;text-align:center;">
          <p style="margin:0;color:#065F46;font-size:13px;font-weight:600;">Email verified by customer</p>
        </div>
        <p style="margin:0 0 24px;color:#475569;font-size:15px;">Booking received on <strong>${receivedAt}</strong>.</p>
        <div style="background:#fdf2f8;border:2px solid #E8186D;border-radius:10px;padding:16px 24px;margin-bottom:28px;text-align:center;">
          <p style="margin:0;color:#9a1250;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Requested Service</p>
          <p style="margin:6px 0 0;color:#E8186D;font-size:20px;font-weight:700;">${safeService}</p>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:24px;">
          <tr><td style="padding:24px;"><p style="margin:0 0 16px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Customer Details</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;width:90px;">Name</td><td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;">${safeName}</td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:7px 0;"><a href="mailto:${safeEmail}" style="color:#3b82f6;font-size:14px;text-decoration:none;">${safeEmail}</a></td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Phone</td><td style="padding:7px 0;color:#0f172a;font-size:14px;">${safePhone || '—'}</td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Date</td><td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;">${formattedDate}${timeDisplay}</td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Duration</td><td style="padding:7px 0;color:#0f172a;font-size:14px;">~${booking.duration_minutes} min</td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Address</td><td style="padding:7px 0;color:#0f172a;font-size:14px;">${safeAddress}</td></tr>
              ${zoneInfo}
            </table></td></tr>
        </table>
        ${safeDetails ? `<p style="margin:0 0 10px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Additional Details</p><div style="background:#f8fafc;border-left:4px solid #E8186D;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:28px;"><p style="margin:0;color:#1e293b;font-size:14px;line-height:1.7;">${safeDetails}</p></div>` : ''}
        ${photoNotice}
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;"><tr>
          <td style="padding-right:8px;"><a href="mailto:${safeEmail}?subject=Your Mr. Bike Booking — ${safeService}" style="display:block;background:#0f172a;color:#ffffff;text-decoration:none;padding:13px 0;border-radius:8px;font-size:14px;font-weight:600;text-align:center;">Reply by Email</a></td>
          <td style="padding-left:8px;"><a href="https://wa.me/4591610013?text=Hi ${encodeURIComponent(booking.name)}, this is Mr. Bike regarding your booking for ${encodeURIComponent(booking.service)}" style="display:block;background:#25d366;color:#ffffff;text-decoration:none;padding:13px 0;border-radius:8px;font-size:14px;font-weight:600;text-align:center;">Reply on WhatsApp</a></td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;"><p style="margin:0;color:#475569;font-size:13px;">Mr. Bike — Mobile Bike Repair Copenhagen</p></td></tr>
    </table></td></tr>
</table></body></html>`
        });

        // Customer confirmation
        await transporter.sendMail({
            from: fromAddress,
            to: booking.email,
            subject: `Booking Confirmed — ${safeService} | Mr. Bike`,
            html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
        <p style="margin:0;color:#E8186D;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:26px;font-weight:700;">Booking Confirmed!</h1>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:15px;">We'll be at your door ready to fix your ride.</p>
      </td></tr>
      <tr><td style="background:#ffffff;padding:40px;">
        <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.7;">Your email has been verified and your booking is confirmed! Your reference is <strong>#${booking.id}</strong>.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:28px;">
          <tr><td style="padding:24px;"><p style="margin:0 0 16px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Booking Summary</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;width:90px;border-bottom:1px solid #f1f5f9;">Reference</td><td style="padding:7px 0;color:#E8186D;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9;">#${booking.id}</td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Service</td><td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${safeService}</td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Date</td><td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${formattedDate}${timeDisplay}</td></tr>
              <tr><td style="padding:7px 0;color:#64748b;font-size:13px;">Address</td><td style="padding:7px 0;color:#0f172a;font-size:14px;">${safeAddress}</td></tr>
            </table></td></tr>
        </table>
        <div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:10px;padding:16px 20px;margin-bottom:24px;text-align:center;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#065F46;">Life is short. Your chain shouldn't be.</p>
          <p style="margin:4px 0 0;font-size:12px;color:#047857;">We keep your ride smooth — always.</p>
        </div>
        <div style="text-align:center;margin-bottom:20px;">
          <a href="${modifyLink}" style="background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;">Reschedule or Cancel</a>
        </div>
        <div style="text-align:center;margin-bottom:20px;">
          <a href="https://wa.me/4591610013" style="background:#25d366;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;">WhatsApp Us</a>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">This is an automated confirmation. Please do not reply to this email.</p>
      </td></tr>
      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;color:#E8186D;font-size:15px;font-weight:700;">Mr. Bike</p>
        <p style="margin:0;color:#475569;font-size:13px;">Mobile Bike Repair Copenhagen &nbsp;·&nbsp; +45 91 61 00 13</p>
      </td></tr>
    </table></td></tr>
</table></body></html>`
        });
    } catch (err) {
        console.error('Failed to send post-verification emails:', err.message);
    }

    // Redirect to confirmation page
    res.redirect(`/booking-confirmed?id=${booking.id}`);
});

// Verification page HTML helper
function verifyPage(title, message, type, bookingId) {
    const color = type === 'success' ? '#059669' : '#dc2626';
    const icon = type === 'success' ? '&#10003;' : '&#10007;';
    const link = bookingId ? `<a href="/booking-confirmed?id=${bookingId}" style="color:#E8186D;text-decoration:none;font-weight:600;">View booking details &rarr;</a>` : '<a href="/" style="color:#E8186D;text-decoration:none;font-weight:600;">&larr; Back to Mr. Bike</a>';
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Mr. Bike</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#F5F5F7;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:32px}.card{background:#fff;border-radius:16px;padding:48px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}.icon{font-size:48px;color:${color}}h1{font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;color:#1A1A2E;margin:16px 0 8px}p{color:#555;font-size:15px;line-height:1.6;margin-bottom:16px}</style>
</head><body><div class="card"><div class="icon">${icon}</div><h1>${title}</h1><p>${message}</p>${link}</div></body></html>`;
}

// ==================== GDPR DATA DELETION ====================

// POST /api/gdpr/delete-request — request data deletion (sends confirmation email)
router.post('/gdpr/delete-request', async (req, res) => {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if any bookings exist for this email
    const bookings = db.prepare('SELECT id FROM bookings WHERE LOWER(email) = ?').all(cleanEmail);
    if (bookings.length === 0) {
        // Don't reveal whether the email exists — always show success
        return res.json({ success: true, message: 'If we have data associated with this email, you will receive a confirmation link shortly.' });
    }

    // Generate deletion token
    const deleteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    // Store token in audit log for verification
    db.prepare('INSERT INTO audit_log (action, details, performed_by) VALUES (?, ?, ?)').run(
        'gdpr_delete_requested',
        JSON.stringify({ email: cleanEmail, token: deleteToken, expires_at: expiresAt }),
        'customer'
    );

    // Send confirmation email
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const confirmLink = `${baseUrl}/api/gdpr/confirm-delete/${deleteToken}?email=${encodeURIComponent(cleanEmail)}`;

    try {
        await transporter.sendMail({
            from: getFromAddress(),
            to: cleanEmail,
            subject: 'Confirm Data Deletion Request — Mr. Bike',
            html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
        <p style="margin:0;color:#E8186D;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:26px;font-weight:700;">Data Deletion Request</h1>
      </td></tr>
      <tr><td style="background:#ffffff;padding:40px;">
        <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hello,</p>
        <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.7;">
          We received a request to delete all personal data associated with <strong>${esc(cleanEmail)}</strong>. This will permanently remove all your booking history and personal information.
        </p>
        <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;padding:20px 24px;margin-bottom:28px;text-align:center;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#92400E;">This action cannot be undone</p>
          <p style="margin:6px 0 0;font-size:13px;color:#78350F;">All bookings and personal data will be permanently deleted.</p>
        </div>
        <div style="text-align:center;margin-bottom:28px;">
          <a href="${confirmLink}" style="background:#dc2626;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;">Confirm Deletion</a>
        </div>
        <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;text-align:center;">This link expires in 24 hours.</p>
        <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">If you did not make this request, you can safely ignore this email.</p>
      </td></tr>
      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;color:#E8186D;font-size:15px;font-weight:700;">Mr. Bike</p>
        <p style="margin:0;color:#475569;font-size:13px;">Mobile Bike Repair Copenhagen &nbsp;·&nbsp; +45 91 61 00 13</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
        });
    } catch (err) {
        console.error('GDPR email error:', err.message);
    }

    res.json({ success: true, message: 'If we have data associated with this email, you will receive a confirmation link shortly.' });
});

// GET /api/gdpr/confirm-delete/:token — actually delete the data
router.get('/gdpr/confirm-delete/:token', (req, res) => {
    const { token } = req.params;
    const { email } = req.query;

    if (!token || !email) {
        return res.status(400).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1>Invalid Request</h1><p>Missing token or email.</p><a href="/">Back to Mr. Bike</a></body></html>');
    }

    // Find the deletion request in audit log
    const request = db.prepare(
        "SELECT * FROM audit_log WHERE action = 'gdpr_delete_requested' AND details LIKE ? ORDER BY created_at DESC LIMIT 1"
    ).get(`%${token}%`);

    if (!request) {
        return res.status(404).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1>Link Expired</h1><p>This deletion link is no longer valid. Please submit a new request.</p><a href="/privacy">Back to Privacy Policy</a></body></html>');
    }

    const details = JSON.parse(request.details);
    if (details.token !== token || details.email !== email.trim().toLowerCase()) {
        return res.status(400).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1>Invalid Request</h1><p>Token does not match.</p><a href="/">Back to Mr. Bike</a></body></html>');
    }

    // Check expiry
    if (new Date(details.expires_at) < new Date()) {
        return res.status(410).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1>Link Expired</h1><p>This link has expired. Please submit a new deletion request.</p><a href="/privacy">Back to Privacy Policy</a></body></html>');
    }

    // Delete all data for this email
    const cleanEmail = email.trim().toLowerCase();
    const deleted = db.prepare('DELETE FROM bookings WHERE LOWER(email) = ?').run(cleanEmail);
    db.prepare('DELETE FROM promo_usage WHERE LOWER(email) = ?').run(cleanEmail);

    // Audit log
    db.prepare('INSERT INTO audit_log (action, details, performed_by) VALUES (?, ?, ?)').run(
        'gdpr_data_deleted',
        `Deleted ${deleted.changes} booking(s) for ${cleanEmail}`,
        'customer'
    );

    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Data Deleted — Mr. Bike</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#F5F5F7;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:32px}.card{background:#fff;border-radius:16px;padding:48px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}h1{font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;color:#1A1A2E;margin:16px 0 8px}p{color:#555;font-size:15px;line-height:1.6;margin-bottom:16px}.icon{font-size:48px}a{color:#E8186D;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}</style>
</head>
<body>
<div class="card">
  <div class="icon">&#10003;</div>
  <h1>Data Deleted</h1>
  <p>All personal data associated with <strong>${esc(cleanEmail)}</strong> has been permanently deleted (${deleted.changes} booking${deleted.changes !== 1 ? 's' : ''} removed).</p>
  <a href="/">&larr; Back to Mr. Bike</a>
</div>
</body></html>`);
});

module.exports = router;
