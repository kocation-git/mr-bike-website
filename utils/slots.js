const db = require('../db');

// All available 2-hour slot definitions
const ALL_SLOTS = [
  '08:00 – 10:00',
  '10:00 – 12:00',
  '12:00 – 14:00',
  '14:00 – 16:00',
  '16:00 – 18:00',
  '18:00 – 20:00',
];

// Parse slot label to start/end minutes from midnight
function parseSlot(label) {
  const parts = label.split('–').map(s => s.trim());
  const [sh, sm] = parts[0].split(':').map(Number);
  const [eh, em] = parts[1].split(':').map(Number);
  return { start: sh * 60 + sm, end: eh * 60 + em };
}

// How many consecutive 2-hour slots are needed for a given duration
function slotsNeeded(durationMinutes) {
  return Math.ceil(durationMinutes / 120);
}

/**
 * Get available time slots for a given date, considering:
 * - Existing bookings and their durations
 * - Admin-blocked slots
 * - Temporary slot locks
 * - Required duration (may need consecutive slots)
 */
function getAvailableSlots(date, requiredDurationMinutes = 120) {
  // Get all occupied slots for this date
  const occupiedSlots = new Set();

  // 1. Booked slots (with duration awareness)
  const bookings = db.prepare(
    "SELECT time_slot, duration_minutes FROM bookings WHERE date = ? AND status IN ('pending', 'confirmed') AND time_slot != ''"
  ).all(date);

  for (const b of bookings) {
    const slotIdx = ALL_SLOTS.indexOf(b.time_slot);
    if (slotIdx === -1) continue;
    const needed = slotsNeeded(b.duration_minutes || 120);
    for (let i = 0; i < needed && (slotIdx + i) < ALL_SLOTS.length; i++) {
      occupiedSlots.add(ALL_SLOTS[slotIdx + i]);
    }
  }

  // 2. Blocked slots
  const blocked = db.prepare(
    "SELECT time_slot FROM blocked_slots WHERE date = ?"
  ).all(date);
  for (const b of blocked) {
    occupiedSlots.add(b.time_slot);
  }

  // Determine how many consecutive slots the new booking needs
  const needed = slotsNeeded(requiredDurationMinutes);

  if (needed <= 1) {
    // Simple case: just return unoccupied slots
    return ALL_SLOTS.filter(s => !occupiedSlots.has(s));
  }

  // Multi-slot case: find starting slots where N consecutive slots are all free
  const available = [];
  for (let i = 0; i <= ALL_SLOTS.length - needed; i++) {
    let allFree = true;
    for (let j = 0; j < needed; j++) {
      if (occupiedSlots.has(ALL_SLOTS[i + j])) {
        allFree = false;
        break;
      }
    }
    if (allFree) {
      // Label shows the full time range
      const startSlot = parseSlot(ALL_SLOTS[i]);
      const endSlot = parseSlot(ALL_SLOTS[i + needed - 1]);
      const startH = String(Math.floor(startSlot.start / 60)).padStart(2, '0');
      const startM = String(startSlot.start % 60).padStart(2, '0');
      const endH = String(Math.floor(endSlot.end / 60)).padStart(2, '0');
      const endM = String(endSlot.end % 60).padStart(2, '0');
      available.push({
        value: ALL_SLOTS[i], // Store first slot as the booking slot
        label: `${startH}:${startM} – ${endH}:${endM}`,
        slots: needed,
      });
    }
  }
  return available;
}

/**
 * Get availability summary for an entire month (for calendar view)
 * Returns { 'YYYY-MM-DD': { total: N, booked: N, blocked: N, status: 'open'|'limited'|'full' } }
 */
function getMonthAvailability(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

  // Count bookings per date
  const bookingCounts = db.prepare(`
    SELECT date, COUNT(*) as count FROM bookings
    WHERE date >= ? AND date <= ? AND status IN ('pending', 'confirmed') AND time_slot != ''
    GROUP BY date
  `).all(startDate, endDate);

  // Count blocked slots per date
  const blockedCounts = db.prepare(`
    SELECT date, COUNT(*) as count FROM blocked_slots
    WHERE date >= ? AND date <= ?
    GROUP BY date
  `).all(startDate, endDate);

  const bookingMap = {};
  for (const b of bookingCounts) bookingMap[b.date] = b.count;
  const blockedMap = {};
  for (const b of blockedCounts) blockedMap[b.date] = b.count;

  const totalSlots = ALL_SLOTS.length; // 6
  const result = {};

  // Generate all dates in the month
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const booked = (bookingMap[dateStr] || 0) + (blockedMap[dateStr] || 0);
    const available = Math.max(0, totalSlots - booked);

    let status = 'open';
    if (available === 0) status = 'full';
    else if (booked > 0) status = 'limited';

    result[dateStr] = { total: totalSlots, booked, available, status };
  }

  return result;
}

/**
 * Count remaining slots for the current week
 */
function getWeekSlotsRemaining() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const startDate = monday.toISOString().split('T')[0];
  const endDate = sunday.toISOString().split('T')[0];

  const totalPossible = 7 * ALL_SLOTS.length; // 42 slots per week

  const booked = db.prepare(`
    SELECT COUNT(*) as count FROM bookings
    WHERE date >= ? AND date <= ? AND status IN ('pending', 'confirmed') AND time_slot != ''
  `).get(startDate, endDate).count;

  const blocked = db.prepare(`
    SELECT COUNT(*) as count FROM blocked_slots
    WHERE date >= ? AND date <= ?
  `).get(startDate, endDate).count;

  const remaining = Math.max(0, totalPossible - booked - blocked);

  return { remaining, total: totalPossible, startDate, endDate };
}

module.exports = {
  ALL_SLOTS,
  parseSlot,
  slotsNeeded,
  getAvailableSlots,
  getMonthAvailability,
  getWeekSlotsRemaining,
};
