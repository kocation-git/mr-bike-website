const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'bookings.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create bookings table
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    service TEXT NOT NULL,
    date TEXT NOT NULL,
    time_slot TEXT DEFAULT '',
    address TEXT NOT NULL,
    details TEXT,
    admin_notes TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migration: add columns if they don't exist (for existing databases)
try { db.exec("ALTER TABLE bookings ADD COLUMN time_slot TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN admin_notes TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN photo TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN price REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN promo_code TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN discount REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN subtotal REAL DEFAULT 0"); } catch (e) {}
// New columns for enhanced features
try { db.exec("ALTER TABLE bookings ADD COLUMN modification_token TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN duration_minutes INTEGER DEFAULT 120"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN zone TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN zone_surcharge REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN checklist_sent INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN report_sent INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN email_verified INTEGER DEFAULT 1"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN verification_token TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN token_expires_at TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN invoice_number TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN reminder_sent INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN review_sent INTEGER DEFAULT 0"); } catch (e) {}

// Services catalog table
db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    emoji TEXT DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    duration TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
  )
`);

// Migration: add duration_minutes to services
try { db.exec("ALTER TABLE services ADD COLUMN duration_minutes INTEGER DEFAULT 120"); } catch (e) {}

// Seed default services if table is empty
const serviceCount = db.prepare('SELECT COUNT(*) as c FROM services').get().c;
if (serviceCount === 0) {
  const seed = db.prepare('INSERT INTO services (name, emoji, price, duration, duration_minutes, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  const defaults = [
    ['Flat Tire Repair', '🛞', 199, '~30 min', 30, 1],
    ['Brake Adjustment', '🛑', 149, '~20 min', 20, 2],
    ['Gear & Derailleur Tuning', '⚙️', 249, '~35 min', 35, 3],
    ['Chain Service', '⛓️', 179, '~25 min', 25, 4],
    ['Full Bike Tune-Up', '🔧', 599, '~90 min', 90, 5],
    ['Wheel Truing', '☸️', 199, '~40 min', 40, 6],
    ['Bike Assembly', '🔩', 399, '~60 min', 60, 7],
    ['General Inspection', '🔍', 149, '~30 min', 30, 8],
  ];
  for (const s of defaults) seed.run(...s);
} else {
  // Update existing services with duration_minutes if they have 0/default
  const svcs = db.prepare('SELECT id, duration, duration_minutes FROM services').all();
  const updateDur = db.prepare('UPDATE services SET duration_minutes = ? WHERE id = ?');
  for (const s of svcs) {
    if (!s.duration_minutes || s.duration_minutes === 120) {
      const match = String(s.duration).match(/(\d+)/);
      if (match) updateDur.run(parseInt(match[1], 10), s.id);
    }
  }
}

// Promo codes table
db.exec(`
  CREATE TABLE IF NOT EXISTS promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value REAL NOT NULL DEFAULT 0,
    max_uses INTEGER DEFAULT NULL,
    used_count INTEGER DEFAULT 0,
    min_order REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    expires_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Promo usage tracking (one use per email or phone)
db.exec(`
  CREATE TABLE IF NOT EXISTS promo_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    promo_code TEXT NOT NULL,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    booking_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Audit log table
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    booking_id INTEGER,
    details TEXT,
    performed_by TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Blocked time slots (admin can block specific slots)
db.exec(`
  CREATE TABLE IF NOT EXISTS blocked_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrations for service_reports
try { db.exec("ALTER TABLE service_reports ADD COLUMN extra_charges TEXT DEFAULT '[]'"); } catch (e) {}
try { db.exec("ALTER TABLE service_reports ADD COLUMN final_total REAL DEFAULT 0"); } catch (e) {}

// Service zones for distance-based pricing
db.exec(`
  CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL,
    surcharge REAL DEFAULT 0,
    active INTEGER DEFAULT 1
  )
`);

// Seed default zones
const zoneCount = db.prepare('SELECT COUNT(*) as c FROM zones').get().c;
if (zoneCount === 0) {
  const seedZone = db.prepare('INSERT INTO zones (name, keywords, surcharge) VALUES (?, ?, ?)');
  seedZone.run('Central', 'indre by,vesterbro,frederiksberg,østerbro,amager,christianshavn,sundby,city center,centrum,København K,København S,1000,1050,1100,1150,1200,1250,1300,1350,1400,1450,1500,1550,1600,1650,1700,1750,1800,1850,1900,1950,2000,2100,2300,2450,2500', 0);
  seedZone.run('Inner Ring', 'nørrebro,valby,vanløse,brønshøj,2200,2400,2720,2860', 50);
  seedZone.run('Outer Ring', 'hellerup,gentofte,hvidovre,rødovre,glostrup,2600,2700,2800,2820,2900,2920', 100);
}

// Customers table (maps email to a persistent customer ID for invoice storage)
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Service reports (post-service documentation)
db.exec(`
  CREATE TABLE IF NOT EXISTS service_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL UNIQUE,
    work_done TEXT NOT NULL DEFAULT '[]',
    parts_replaced TEXT DEFAULT '[]',
    recommendations TEXT DEFAULT '[]',
    mechanic_notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
  )
`);

module.exports = db;
