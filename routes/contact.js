const express = require('express');
const router = express.Router();
const { Resend } = require('resend');

let resend;
if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
} else {
    console.warn('⚠️  RESEND_API_KEY not configured.');
}

const SERVICES = [
    'Flat Tire Repair & Tube Replacement',
    'Brake Adjustment & Cable Replacement',
    'Gear & Derailleur Tuning',
    'Chain Cleaning, Lubrication & Replacement',
    'Full Bike Service & Tune-Up',
    'Wheel Truing & Spoke Adjustment',
    'Bike Assembly & Fitting',
    'General Inspection & Diagnostics',
    'Other'
];

router.post('/booking', async (req, res) => {
    try {
        const { name, email, phone, service, date, address, details } = req.body;

        // Basic validation
        if (!name || name.trim().length < 2) return res.status(400).json({ success: false, message: 'Please enter your full name.' });
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Please enter a valid email.' });
        if (!service) return res.status(400).json({ success: false, message: 'Please select a service.' });
        if (!date) return res.status(400).json({ success: false, message: 'Please select a preferred date.' });
        if (!address || address.trim().length < 5) return res.status(400).json({ success: false, message: 'Please enter your address.' });

        const formattedDate = new Date(date).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const receivedAt = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });

        console.log(`📅 New booking from ${name} — ${service} on ${formattedDate}`);

        if (resend) {
            const ownerEmail = process.env.OWNER_EMAIL || 'fernando.pcn@gmail.com';

            // --- Email to owner ---
            await resend.emails.send({
                from: 'onboarding@resend.dev',
                to: ownerEmail,
                subject: `New Booking: ${service} — ${name}`,
                html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0;color:#f97316;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike</p>
              <h1 style="margin:6px 0 0;color:#ffffff;font-size:24px;font-weight:700;">New Booking Request 🚲</h1>
            </td>
            <td align="right">
              <div style="background:#f97316;border-radius:50%;width:52px;height:52px;text-align:center;line-height:52px;font-size:26px;">🔧</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#ffffff;padding:40px;">
        <p style="margin:0 0 24px;color:#475569;font-size:15px;">You have a new booking request received on <strong>${receivedAt}</strong>.</p>

        <!-- Service highlight -->
        <div style="background:#fff7ed;border:2px solid #f97316;border-radius:10px;padding:16px 24px;margin-bottom:28px;text-align:center;">
          <p style="margin:0;color:#9a3412;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Requested Service</p>
          <p style="margin:6px 0 0;color:#c2410c;font-size:20px;font-weight:700;">${service}</p>
        </div>

        <!-- Customer details -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:24px;">
          <tr><td style="padding:24px;">
            <p style="margin:0 0 16px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Customer Details</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;width:90px;vertical-align:top;">Name</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;">${name}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;vertical-align:top;">Email</td>
                <td style="padding:7px 0;"><a href="mailto:${email}" style="color:#3b82f6;font-size:14px;text-decoration:none;">${email}</a></td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;vertical-align:top;">Phone</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;">${phone || '—'}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;vertical-align:top;">Date</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;vertical-align:top;">Address</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;">${address}</td>
              </tr>
            </table>
          </td></tr>
        </table>

        ${details ? `
        <!-- Additional details -->
        <p style="margin:0 0 10px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Additional Details</p>
        <div style="background:#f8fafc;border-left:4px solid #f97316;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:28px;">
          <p style="margin:0;color:#1e293b;font-size:14px;line-height:1.7;">${details.replace(/\n/g, '<br>')}</p>
        </div>` : ''}

        <!-- Action buttons -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-right:8px;">
              <a href="mailto:${email}?subject=Your Mr. Bike Booking — ${service}" style="display:block;background:#0f172a;color:#ffffff;text-decoration:none;padding:13px 0;border-radius:8px;font-size:14px;font-weight:600;text-align:center;">Reply by Email</a>
            </td>
            <td style="padding-left:8px;">
              <a href="https://wa.me/4591610013?text=Hi ${encodeURIComponent(name)}, this is Mr. Bike regarding your booking for ${encodeURIComponent(service)}" style="display:block;background:#25d366;color:#ffffff;text-decoration:none;padding:13px 0;border-radius:8px;font-size:14px;font-weight:600;text-align:center;">Reply on WhatsApp</a>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
        <p style="margin:0;color:#475569;font-size:13px;">Mr. Bike — Bike Repair Delivery Service</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
            });

            // --- Confirmation email to customer ---
            await resend.emails.send({
                from: 'onboarding@resend.dev',
                to: email,
                subject: `Booking Received — ${service} | Mr. Bike`,
                html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
        <p style="margin:0;color:#f97316;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike 🚲</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:26px;font-weight:700;">Booking Confirmed!</h1>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:15px;">We'll be at your door ready to fix your ride.</p>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#ffffff;padding:40px;">
        <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi <strong>${name}</strong>,</p>
        <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.7;">
          Thanks for booking with <strong>Mr. Bike</strong>! We've received your request and will confirm your appointment shortly. If you need anything urgently, don't hesitate to contact us on WhatsApp.
        </p>

        <!-- Booking summary -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:28px;">
          <tr><td style="padding:24px;">
            <p style="margin:0 0 16px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Booking Summary</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;width:90px;border-bottom:1px solid #f1f5f9;">Service</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${service}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Date</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;">Address</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;">${address}</td>
              </tr>
            </table>
          </td></tr>
        </table>

        <!-- WhatsApp CTA -->
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px 24px;margin-bottom:28px;text-align:center;">
          <p style="margin:0 0 6px;color:#166534;font-size:14px;font-weight:600;">Need to reach us faster?</p>
          <p style="margin:0 0 14px;color:#4ade80;font-size:13px;">Chat with us directly on WhatsApp</p>
          <a href="https://wa.me/4591610013" style="background:#25d366;color:#ffffff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;">💬 WhatsApp Us</a>
        </div>

        <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">This is an automated confirmation. Please do not reply to this email.</p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;color:#f97316;font-size:15px;font-weight:700;">Mr. Bike</p>
        <p style="margin:0;color:#475569;font-size:13px;">Bike Repair Delivery Service &nbsp;·&nbsp; +45 91 61 00 13</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
            });

            console.log(`✅ Booking emails sent for ${name}`);
        }

        res.status(200).json({ success: true, message: 'Booking received! Check your email for confirmation.' });

    } catch (error) {
        console.error('❌ Booking error:', error);
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again or contact us on WhatsApp.' });
    }
});

module.exports = router;
