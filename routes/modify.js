const express = require('express');
const router = express.Router();
const db = require('../db');
const { esc, getFromAddress, formatDate, sendStatusEmail } = require('../mailer');
const { getAvailableSlots } = require('../utils/slots');

// GET /api/modify/:token — get booking details for modification
router.get('/modify/:token', (req, res) => {
  const { token } = req.params;
  if (!token || token.length < 32) {
    return res.status(400).json({ success: false, message: 'Invalid token' });
  }

  const booking = db.prepare(
    "SELECT id, name, service, date, time_slot, address, status, token_expires_at FROM bookings WHERE modification_token = ? AND modification_token != ''"
  ).get(token);

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found or link has expired.' });
  }

  // Check token expiration
  if (booking.token_expires_at && new Date(booking.token_expires_at) < new Date()) {
    return res.json({ success: false, message: 'This modification link has expired. Please contact us directly at +45 91 61 00 13 or via WhatsApp.' });
  }

  if (booking.status === 'completed') {
    return res.json({ success: false, message: 'This booking has already been completed and cannot be modified.' });
  }

  if (booking.status === 'cancelled') {
    return res.json({ success: false, message: 'This booking has already been cancelled.' });
  }

  res.json({ success: true, booking });
});

// GET /api/modify/:token/availability?date=YYYY-MM-DD — check available slots for rescheduling
router.get('/modify/:token/availability', (req, res) => {
  const { token } = req.params;
  const { date } = req.query;

  const booking = db.prepare(
    "SELECT id, duration_minutes, token_expires_at FROM bookings WHERE modification_token = ? AND modification_token != '' AND status IN ('pending', 'confirmed')"
  ).get(token);

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found' });
  }

  if (booking.token_expires_at && new Date(booking.token_expires_at) < new Date()) {
    return res.status(410).json({ success: false, message: 'This modification link has expired.' });
  }

  if (!date) {
    return res.status(400).json({ success: false, message: 'Date required' });
  }

  const available = getAvailableSlots(date, booking.duration_minutes || 120);
  res.json({ success: true, available });
});

// PATCH /api/modify/:token — reschedule booking
router.patch('/modify/:token', async (req, res) => {
  const { token } = req.params;
  const { date, timeSlot } = req.body;

  const booking = db.prepare(
    "SELECT * FROM bookings WHERE modification_token = ? AND modification_token != '' AND status IN ('pending', 'confirmed')"
  ).get(token);

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found or cannot be modified.' });
  }

  if (booking.token_expires_at && new Date(booking.token_expires_at) < new Date()) {
    return res.status(410).json({ success: false, message: 'This modification link has expired. Please contact us directly.' });
  }

  if (!date) {
    return res.status(400).json({ success: false, message: 'Please select a new date.' });
  }

  // Check minimum date (tomorrow)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  if (new Date(date + 'T00:00:00') < tomorrow) {
    return res.status(400).json({ success: false, message: 'Date must be at least tomorrow.' });
  }

  // Check slot availability if a time slot was selected
  if (timeSlot) {
    const available = getAvailableSlots(date, booking.duration_minutes || 120);
    const slotLabels = Array.isArray(available) ? available.map(s => typeof s === 'string' ? s : s.value) : [];
    if (!slotLabels.includes(timeSlot)) {
      return res.status(409).json({ success: false, message: 'That time slot is no longer available.' });
    }
  }

  // Update booking
  db.prepare(`
    UPDATE bookings SET date = ?, time_slot = ?, updated_at = datetime('now') WHERE id = ?
  `).run(date, timeSlot || '', booking.id);

  // Audit log
  db.prepare('INSERT INTO audit_log (action, booking_id, details, performed_by) VALUES (?, ?, ?, ?)').run(
    'booking_rescheduled', booking.id,
    `Rescheduled from ${booking.date} ${booking.time_slot} to ${date} ${timeSlot || 'flexible'}`,
    'customer'
  );

  // Send confirmation email with new date
  try {
    const updatedBooking = { ...booking, date, time_slot: timeSlot || '', status: 'confirmed' };
    await sendStatusEmail(updatedBooking);
  } catch (err) {
    console.error('Failed to send reschedule email:', err.message);
  }

  res.json({ success: true, message: 'Booking rescheduled successfully!' });
});

// DELETE /api/modify/:token — cancel booking
router.delete('/modify/:token', async (req, res) => {
  const { token } = req.params;

  const booking = db.prepare(
    "SELECT * FROM bookings WHERE modification_token = ? AND modification_token != '' AND status IN ('pending', 'confirmed')"
  ).get(token);

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found or cannot be cancelled.' });
  }

  if (booking.token_expires_at && new Date(booking.token_expires_at) < new Date()) {
    return res.status(410).json({ success: false, message: 'This modification link has expired. Please contact us directly.' });
  }

  // Check cancellation policy: at least 24 hours before
  const bookingDate = new Date(booking.date + 'T00:00:00');
  const now = new Date();
  const hoursUntil = (bookingDate - now) / (1000 * 60 * 60);
  if (hoursUntil < 24) {
    return res.status(400).json({
      success: false,
      message: 'Cancellations must be made at least 24 hours before the appointment. Please contact us directly.'
    });
  }

  // Cancel booking
  db.prepare("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(booking.id);

  // Audit log
  db.prepare('INSERT INTO audit_log (action, booking_id, details, performed_by) VALUES (?, ?, ?, ?)').run(
    'booking_cancelled', booking.id, 'Cancelled by customer via modification link', 'customer'
  );

  // Send cancellation email
  try {
    await sendStatusEmail({ ...booking, status: 'cancelled' });
  } catch (err) {
    console.error('Failed to send cancellation email:', err.message);
  }

  res.json({ success: true, message: 'Booking cancelled successfully.' });
});

module.exports = router;
