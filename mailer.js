const { Resend } = require('resend');
const DOMPurify = require('isomorphic-dompurify');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendMail({ from, to, subject, html, attachments }) {
    const payload = { from, to, subject, html };
    if (attachments && attachments.length > 0) {
        payload.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
    }
    const { error } = await resend.emails.send(payload);
    if (error) throw new Error(error.message || JSON.stringify(error));
}

// Sanitize user input: strip all HTML tags via DOMPurify, then HTML-escape for safe embedding in emails
const esc = (s) => {
    const clean = DOMPurify.sanitize(String(s || ''), { ALLOWED_TAGS: [] });
    return clean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

function getFromAddress() {
    return `"${process.env.FROM_NAME || 'Mr. Bike'}" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`;
}

function formatDate(date) {
    return new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// Status change email to customer
async function sendStatusEmail(booking) {
    const safeName = esc(booking.name);
    const safeService = esc(booking.service);
    const formattedDate = formatDate(booking.date);
    const timeSlot = booking.time_slot ? ` (${esc(booking.time_slot)})` : '';

    const statusConfig = {
        confirmed: {
            subject: `Booking Confirmed — ${safeService} | Mr. Bike`,
            color: '#059669',
            bgColor: '#D1FAE5',
            heading: 'Booking Confirmed!',
            message: `Great news! Your booking has been confirmed. We'll see you on <strong>${formattedDate}${timeSlot}</strong>.`,
            icon: '✓',
        },
        completed: {
            subject: `Service Completed — ${safeService} | Mr. Bike`,
            color: '#1E40AF',
            bgColor: '#DBEAFE',
            heading: 'Service Completed!',
            message: `Your <strong>${safeService}</strong> has been completed. We hope your bike rides like new! If you have any issues, don't hesitate to contact us.`,
            icon: '★',
        },
        cancelled: {
            subject: `Booking Cancelled — ${safeService} | Mr. Bike`,
            color: '#991B1B',
            bgColor: '#FEE2E2',
            heading: 'Booking Cancelled',
            message: `Your booking for <strong>${safeService}</strong> on ${formattedDate} has been cancelled. If this was a mistake or you'd like to rebook, please don't hesitate to reach out.`,
            icon: '✕',
        },
    };

    const cfg = statusConfig[booking.status];
    if (!cfg) return;

    await sendMail({
        from: getFromAddress(),
        to: booking.email,
        subject: cfg.subject,
        html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
        <p style="margin:0;color:#E8186D;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:26px;font-weight:700;">${cfg.heading}</h1>
      </td></tr>

      <tr><td style="background:#ffffff;padding:40px;">
        <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.7;">${cfg.message}</p>

        <div style="background:${cfg.bgColor};border-radius:10px;padding:20px 24px;margin-bottom:28px;text-align:center;">
          <p style="margin:0;font-size:13px;font-weight:700;color:${cfg.color};text-transform:uppercase;letter-spacing:1px;">Status</p>
          <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:${cfg.color};">${cfg.icon} ${booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}</p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:28px;">
          <tr><td style="padding:24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;width:90px;border-bottom:1px solid #f1f5f9;">Reference</td>
                <td style="padding:7px 0;color:#E8186D;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9;">#${booking.id}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Service</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${safeService}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;">Date</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;">${formattedDate}${timeSlot}</td>
              </tr>
            </table>
          </td></tr>
        </table>

        <div style="text-align:center;margin-bottom:20px;">
          <a href="https://wa.me/4591610013" style="background:#25d366;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;">WhatsApp Us</a>
        </div>

        <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">This is an automated message. Please do not reply to this email.</p>
      </td></tr>

      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;color:#E8186D;font-size:15px;font-weight:700;">Mr. Bike</p>
        <p style="margin:0;color:#475569;font-size:13px;">Mobile Bike Repair Copenhagen &nbsp;·&nbsp; +45 91 61 00 13</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
    });
    console.log(`Status email (${booking.status}) sent to ${booking.email}`);
}

// Reminder email — sent day before appointment
async function sendReminderEmail(booking) {
    const safeName = esc(booking.name);
    const safeService = esc(booking.service);
    const formattedDate = formatDate(booking.date);
    const timeSlot = booking.time_slot ? ` (${esc(booking.time_slot)})` : '';

    await sendMail({
        from: getFromAddress(),
        to: booking.email,
        subject: `Reminder: ${safeService} Tomorrow | Mr. Bike`,
        html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
        <p style="margin:0;color:#E8186D;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:26px;font-weight:700;">See You Tomorrow!</h1>
      </td></tr>

      <tr><td style="background:#ffffff;padding:40px;">
        <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.7;">
          Just a friendly reminder that your <strong>${safeService}</strong> is scheduled for tomorrow, <strong>${formattedDate}${timeSlot}</strong>. Please make sure your bike is accessible at your location.
        </p>

        <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;padding:20px 24px;margin-bottom:28px;text-align:center;">
          <p style="margin:0;font-size:28px;">🔔</p>
          <p style="margin:8px 0 0;font-size:15px;font-weight:700;color:#92400E;">Tomorrow — ${formattedDate}${timeSlot}</p>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:28px;">
          <tr><td style="padding:24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;width:90px;border-bottom:1px solid #f1f5f9;">Service</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${safeService}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;">Address</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;">${esc(booking.address)}</td>
              </tr>
            </table>
          </td></tr>
        </table>

        <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.7;">Need to reschedule? Contact us as soon as possible:</p>
        <div style="text-align:center;">
          <a href="https://wa.me/4591610013" style="background:#25d366;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;">WhatsApp Us</a>
        </div>
      </td></tr>

      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;color:#E8186D;font-size:15px;font-weight:700;">Mr. Bike</p>
        <p style="margin:0;color:#475569;font-size:13px;">Mobile Bike Repair Copenhagen &nbsp;·&nbsp; +45 91 61 00 13</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
    });
    console.log(`Reminder email sent to ${booking.email} for booking #${booking.id}`);
}

// Pre-appointment checklist email — sent when booking is confirmed
async function sendChecklistEmail(booking) {
    const safeName = esc(booking.name);
    const safeService = esc(booking.service);
    const formattedDate = formatDate(booking.date);
    const timeSlot = booking.time_slot ? ` (${esc(booking.time_slot)})` : '';
    const modifyLink = booking.modification_token
        ? `${process.env.BASE_URL || 'http://localhost:3000'}/modify?token=${booking.modification_token}`
        : '';

    const serviceChecklist = [];
    const svc = (booking.service || '').toLowerCase();
    serviceChecklist.push('Have your bike accessible and unlocked at the address provided');
    serviceChecklist.push('Remove personal accessories (bags, lights, phone mounts, locks)');
    if (svc.includes('tire') || svc.includes('flat')) {
        serviceChecklist.push('Identify which tire has the issue (front or rear)');
    }
    if (svc.includes('tune') || svc.includes('inspection')) {
        serviceChecklist.push('Note any specific issues or noises you\'ve noticed');
    }
    serviceChecklist.push('Ensure adequate space for the mechanic to work (ideally outdoors or in a garage)');
    serviceChecklist.push('Have your preferred payment method ready (MobilePay, card, or cash)');
    serviceChecklist.push('If possible, be present during the repair to approve any additional work');

    const checklistHtml = serviceChecklist.map(item =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#475569;font-size:14px;line-height:1.6;">
          <span style="color:#059669;font-weight:700;margin-right:10px;">&#9744;</span>${item}
        </td></tr>`
    ).join('');

    const modifyButton = modifyLink ? `
        <div style="text-align:center;margin-bottom:20px;">
          <a href="${modifyLink}" style="background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;">Reschedule or Cancel</a>
        </div>` : '';

    await sendMail({
        from: getFromAddress(),
        to: booking.email,
        subject: `Checklist for Your Appointment — ${safeService} | Mr. Bike`,
        html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
        <p style="margin:0;color:#E8186D;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:26px;font-weight:700;">Prepare for Your Repair</h1>
      </td></tr>

      <tr><td style="background:#ffffff;padding:40px;">
        <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.7;">
          Your <strong>${safeService}</strong> is confirmed for <strong>${formattedDate}${timeSlot}</strong>. Here's a quick checklist to help everything go smoothly:
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:28px;">
          <tr><td style="padding:24px;">
            <p style="margin:0 0 16px;color:#0f172a;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Pre-Appointment Checklist</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${checklistHtml}
            </table>
          </td></tr>
        </table>

        <div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:10px;padding:20px 24px;margin-bottom:28px;text-align:center;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#065F46;">Life is short. Your chain shouldn't be.</p>
          <p style="margin:6px 0 0;font-size:13px;color:#047857;">We keep your ride smooth — always.</p>
        </div>

        ${modifyButton}

        <div style="text-align:center;margin-bottom:20px;">
          <a href="https://wa.me/4591610013" style="background:#25d366;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;">WhatsApp Us</a>
        </div>

        <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">This is an automated message. Please do not reply to this email.</p>
      </td></tr>

      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;color:#E8186D;font-size:15px;font-weight:700;">Mr. Bike</p>
        <p style="margin:0;color:#475569;font-size:13px;">Mobile Bike Repair Copenhagen &nbsp;·&nbsp; +45 91 61 00 13</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
    });
    console.log(`Checklist email sent to ${booking.email} for booking #${booking.id}`);
}

// Post-service digital report email (with optional PDF invoice attachment)
async function sendServiceReport(booking, report, pdfBuffer) {
    const safeName = esc(booking.name);
    const safeService = esc(booking.service);
    const formattedDate = formatDate(booking.date);

    const workDone = JSON.parse(report.work_done || '[]');
    const partsReplaced = JSON.parse(report.parts_replaced || '[]');
    const recommendations = JSON.parse(report.recommendations || '[]');

    const itemDesc = (item) => typeof item === 'string' ? item : (item.description || item.name || String(item));
    const itemAmt = (item) => typeof item === 'object' && item.amount != null ? parseFloat(item.amount) : 0;

    const workHtml = workDone.map(item => {
        const desc = esc(itemDesc(item));
        const amt = itemAmt(item);
        const priceTag = amt > 0 ? `<span style="color:#64748b;font-size:13px;float:right;">${amt.toFixed(0)} DKK</span>` : '';
        return `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#1e293b;font-size:14px;">
          <span style="color:#059669;margin-right:8px;">&#10003;</span>${desc}${priceTag}
        </td></tr>`;
    }).join('') || '<tr><td style="padding:8px 0;color:#94a3b8;font-size:14px;">No items recorded</td></tr>';

    const partsHtml = partsReplaced.length > 0 ? `
        <div style="margin-bottom:24px;">
          <p style="margin:0 0 12px;color:#0f172a;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Parts Replaced</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${partsReplaced.map(p => {
                const desc = esc(itemDesc(p));
                const amt = itemAmt(p);
                const priceTag = amt > 0 ? `<span style="color:#64748b;font-size:13px;float:right;">${amt.toFixed(0)} DKK</span>` : '';
                return `<tr><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;color:#475569;font-size:14px;">&#8226; ${desc}${priceTag}</td></tr>`;
            }).join('')}
          </table>
        </div>` : '';

    const recsHtml = recommendations.length > 0 ? `
        <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
          <p style="margin:0 0 12px;color:#92400E;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Recommendations for Next Time</p>
          ${recommendations.map(r => `<p style="margin:0 0 6px;color:#78350F;font-size:14px;line-height:1.6;">&#8594; ${esc(itemDesc(r))}</p>`).join('')}
        </div>` : '';

    const notesHtml = report.mechanic_notes ? `
        <div style="background:#f8fafc;border-left:4px solid #E8186D;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 6px;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;">Mechanic's Notes</p>
          <p style="margin:0;color:#1e293b;font-size:14px;line-height:1.7;">${esc(report.mechanic_notes)}</p>
        </div>` : '';

    const invoiceNum = booking.invoice_number || `MRB-${booking.id}`;
    const attachments = pdfBuffer ? [{
        filename: `invoice-${invoiceNum}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
    }] : [];

    await sendMail({
        from: getFromAddress(),
        to: booking.email,
        subject: `Service Report & Invoice ${invoiceNum} — ${safeService} | Mr. Bike`,
        attachments,
        html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
        <p style="margin:0;color:#E8186D;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:26px;font-weight:700;">Your Service Report</h1>
      </td></tr>

      <tr><td style="background:#ffffff;padding:40px;">
        <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.7;">
          Here's a detailed report of the work performed on your bike on <strong>${formattedDate}</strong>.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:24px;">
          <tr><td style="padding:24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;width:90px;border-bottom:1px solid #f1f5f9;">Reference</td>
                <td style="padding:7px 0;color:#E8186D;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9;">#${booking.id}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">Service</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${safeService}</td>
              </tr>
              <tr>
                <td style="padding:7px 0;color:#64748b;font-size:13px;">Date</td>
                <td style="padding:7px 0;color:#0f172a;font-size:14px;font-weight:600;">${formattedDate}</td>
              </tr>
            </table>
          </td></tr>
        </table>

        <div style="margin-bottom:24px;">
          <p style="margin:0 0 12px;color:#0f172a;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Work Performed</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;">
            <tr><td style="padding:16px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">${workHtml}</table>
            </td></tr>
          </table>
        </div>

        ${partsHtml}

        ${(() => {
            let sub = 0;
            [...workDone, ...partsReplaced].forEach(i => { sub += itemAmt(i); });
            const zoneSurcharge = parseFloat(booking.zone_surcharge) || 0;
            const disc = parseFloat(booking.discount) || 0;
            const total = report.final_total != null ? parseFloat(report.final_total) : (sub + zoneSurcharge - disc);
            const exclVat = total / 1.25;
            const vatAmt = total - exclVat;
            if (total <= 0) return '';
            return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
                ${zoneSurcharge > 0 ? `<tr><td style="padding:4px 0;color:#64748b;">Zone surcharge (${esc(booking.zone || '')})</td><td style="padding:4px 0;text-align:right;color:#1e293b;">+${zoneSurcharge.toFixed(0)} DKK</td></tr>` : ''}
                ${disc > 0 ? `<tr><td style="padding:4px 0;color:#059669;">Discount${booking.promo_code ? ' (' + esc(booking.promo_code) + ')' : ''}</td><td style="padding:4px 0;text-align:right;color:#059669;">-${disc.toFixed(0)} DKK</td></tr>` : ''}
                <tr><td style="padding:4px 0;color:#64748b;">Excl. VAT</td><td style="padding:4px 0;text-align:right;color:#1e293b;">${exclVat.toFixed(0)} DKK</td></tr>
                <tr><td style="padding:4px 0;color:#64748b;">VAT (25%)</td><td style="padding:4px 0;text-align:right;color:#1e293b;">${vatAmt.toFixed(0)} DKK</td></tr>
                <tr><td style="padding:8px 0 4px;border-top:2px solid #0f172a;font-size:15px;font-weight:700;color:#0f172a;">Total incl. VAT</td><td style="padding:8px 0 4px;border-top:2px solid #0f172a;text-align:right;font-size:15px;font-weight:700;color:#0f172a;">${total.toFixed(0)} DKK</td></tr>
              </table>
            </div>`;
        })()}

        ${recsHtml}
        ${notesHtml}

        <div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:10px;padding:20px 24px;margin-bottom:28px;text-align:center;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#065F46;">Life is short. Your chain shouldn't be.</p>
          <p style="margin:6px 0 0;font-size:13px;color:#047857;">We keep your ride smooth — always.</p>
        </div>

        <div style="text-align:center;margin-bottom:20px;">
          <a href="https://g.page/mrbike-cph/review" style="background:#E8186D;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;">Leave a Review</a>
        </div>

        <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">Thank you for choosing Mr. Bike!</p>
      </td></tr>

      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;color:#E8186D;font-size:15px;font-weight:700;">Mr. Bike</p>
        <p style="margin:0;color:#475569;font-size:13px;">Mobile Bike Repair Copenhagen &nbsp;·&nbsp; +45 91 61 00 13</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
    });
    console.log(`Service report email sent to ${booking.email} for booking #${booking.id}`);
}

// Post-service review request email — sent 2 days after completion
async function sendReviewRequestEmail(booking) {
    const safeName = esc(booking.name);
    const safeService = esc(booking.service);
    const googleReviewUrl = process.env.GOOGLE_REVIEW_URL || 'https://g.page/r/YOUR_GOOGLE_REVIEW_LINK';

    await sendMail({
        from: getFromAddress(),
        to: booking.email,
        subject: `How was your repair? — Mr. Bike`,
        html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center;">
        <p style="margin:0;color:#E8186D;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Mr. Bike</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:26px;font-weight:700;">How Did We Do?</h1>
      </td></tr>

      <tr><td style="background:#ffffff;padding:40px;">
        <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi <strong>${safeName}</strong>,</p>
        <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.7;">
          We hope your bike is running great after your <strong>${safeService}</strong>! We'd love to hear how it went.
        </p>

        <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.7;">
          Your feedback helps other cyclists in Copenhagen find reliable bike repair. If you have 30 seconds, a quick review would mean the world to us:
        </p>

        <div style="text-align:center;margin-bottom:28px;">
          <a href="${googleReviewUrl}" style="background:#E8186D;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:16px;font-weight:700;display:inline-block;">Leave a Review</a>
        </div>

        <div style="text-align:center;margin-bottom:24px;font-size:32px;">
          &#11088;&#11088;&#11088;&#11088;&#11088;
        </div>

        <div style="background:#D1FAE5;border:1px solid #6EE7B7;border-radius:10px;padding:16px 20px;margin-bottom:24px;text-align:center;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#065F46;">Life is short. Your chain shouldn't be.</p>
          <p style="margin:4px 0 0;font-size:12px;color:#047857;">If anything isn't right with your repair, contact us and we'll fix it free of charge.</p>
        </div>

        <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.7;">Need another repair? Book anytime:</p>
        <div style="text-align:center;">
          <a href="${process.env.BASE_URL || 'https://mrbike.dk'}/#book" style="background:#00897B;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;">Book Another Repair</a>
        </div>
      </td></tr>

      <tr><td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;color:#E8186D;font-size:15px;font-weight:700;">Mr. Bike</p>
        <p style="margin:0;color:#475569;font-size:13px;">Mobile Bike Repair Copenhagen &nbsp;&middot;&nbsp; +45 91 61 00 13</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
    });
    console.log(`Review request email sent to ${booking.email} for booking #${booking.id}`);
}

module.exports = { sendMail, esc, getFromAddress, formatDate, sendStatusEmail, sendReminderEmail, sendChecklistEmail, sendServiceReport, sendReviewRequestEmail };
