const PDFDocument = require('pdfkit');

/**
 * Generate a PDF invoice for a completed booking.
 *
 * @param {Object} booking   – row from bookings table
 * @param {Object} report    – row from service_reports table
 * @param {Object} [opts]    – optional overrides (companyInfo, etc.)
 * @returns {Promise<Buffer>} – PDF file buffer
 */
function generateInvoice(booking, report, opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pink = '#E8186D';
    const dark = '#0f172a';
    const gray = '#64748b';
    const lightBg = '#f8fafc';

    // Parse JSON fields
    const workDone = JSON.parse(report.work_done || '[]');
    const partsReplaced = JSON.parse(report.parts_replaced || '[]');
    const extraCharges = JSON.parse(report.extra_charges || '[]');

    const invoiceNumber = booking.invoice_number || `MRB-${booking.id}`;
    const invoiceDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const serviceDate = new Date(booking.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    // ─── HEADER ───
    doc.fontSize(28).font('Helvetica-Bold').fillColor(pink).text('Mr. Bike', 50, 50);
    doc.fontSize(9).font('Helvetica').fillColor(gray)
      .text('Mobile Bike Repair · Copenhagen', 50, 82)
      .text('+45 91 61 00 13 · hello@mrbike.dk', 50, 94);

    // Invoice title — right side
    doc.fontSize(22).font('Helvetica-Bold').fillColor(dark).text('INVOICE', 350, 50, { align: 'right' });
    doc.fontSize(10).font('Helvetica').fillColor(gray)
      .text(`Invoice #: ${invoiceNumber}`, 350, 78, { align: 'right' })
      .text(`Date: ${invoiceDate}`, 350, 92, { align: 'right' })
      .text(`Booking Ref: #${booking.id}`, 350, 106, { align: 'right' });

    // Divider
    doc.moveTo(50, 130).lineTo(545, 130).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // ─── CUSTOMER & SERVICE INFO ───
    let y = 145;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(dark).text('Bill To:', 50, y);
    y += 16;
    doc.fontSize(10).font('Helvetica').fillColor('#1e293b')
      .text(booking.name, 50, y);
    y += 14;
    doc.fillColor(gray).text(booking.email, 50, y);
    if (booking.phone) { y += 14; doc.text(booking.phone, 50, y); }
    y += 14;
    doc.text(booking.address, 50, y);

    // Service info — right column
    let ry = 145;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(dark).text('Service Details:', 350, ry, { align: 'right' });
    ry += 16;
    doc.fontSize(10).font('Helvetica').fillColor('#1e293b').text(serviceDate, 350, ry, { align: 'right' });
    if (booking.time_slot) { ry += 14; doc.fillColor(gray).text(booking.time_slot, 350, ry, { align: 'right' }); }
    if (booking.zone) { ry += 14; doc.fillColor(gray).text(`Zone: ${booking.zone}`, 350, ry, { align: 'right' }); }

    y = Math.max(y, ry) + 35;

    // ─── LINE ITEMS TABLE ───
    // Table header
    const col1 = 50;   // Description
    const col2 = 430;  // Amount
    const tableWidth = 495;

    doc.rect(col1, y, tableWidth, 22).fill(dark);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
      .text('DESCRIPTION', col1 + 10, y + 6)
      .text('AMOUNT (DKK)', col2, y + 6, { width: 105, align: 'right' });
    y += 22;

    let lineItems = [];
    let subtotal = 0;

    // Services / Work done
    for (const item of workDone) {
      const desc = typeof item === 'string' ? item : (item.description || item);
      const amt = typeof item === 'object' && item.amount != null ? parseFloat(item.amount) : 0;
      lineItems.push({ description: desc, amount: amt, section: 'service' });
      subtotal += amt;
    }

    // Parts replaced
    for (const item of partsReplaced) {
      const desc = typeof item === 'string' ? item : (item.description || item);
      const amt = typeof item === 'object' && item.amount != null ? parseFloat(item.amount) : 0;
      lineItems.push({ description: `Part: ${desc}`, amount: amt, section: 'part' });
      subtotal += amt;
    }

    // Extra charges
    for (const item of extraCharges) {
      const desc = typeof item === 'string' ? item : (item.description || item);
      const amt = typeof item === 'object' && item.amount != null ? parseFloat(item.amount) : 0;
      lineItems.push({ description: desc, amount: amt, section: 'extra' });
      subtotal += amt;
    }

    // Draw rows
    let rowIdx = 0;
    for (const item of lineItems) {
      const rowBg = rowIdx % 2 === 0 ? '#ffffff' : lightBg;
      doc.rect(col1, y, tableWidth, 20).fill(rowBg);

      doc.fontSize(9).font('Helvetica').fillColor('#1e293b')
        .text(item.description, col1 + 10, y + 5, { width: 370, lineBreak: false });

      if (item.amount > 0) {
        doc.text(`${item.amount.toFixed(2)}`, col2, y + 5, { width: 105, align: 'right' });
      } else {
        doc.fillColor(gray).text('—', col2, y + 5, { width: 105, align: 'right' });
      }
      y += 20;
      rowIdx++;

      // Page break if needed
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
    }

    // Bottom line
    doc.moveTo(col1, y).lineTo(col1 + tableWidth, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    y += 12;

    // ─── TOTALS ───
    const totalsX = 350;
    const totalsValX = col2;
    const totalsW = 105;

    function totalRow(label, value, opts = {}) {
      doc.fontSize(opts.bold ? 11 : 9)
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(opts.color || gray)
        .text(label, totalsX, y, { width: 80, align: 'right' });
      doc.fontSize(opts.bold ? 11 : 9)
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(opts.color || '#1e293b')
        .text(`${value} DKK`, totalsValX, y, { width: totalsW, align: 'right' });
      y += opts.bold ? 20 : 16;
    }

    totalRow('Subtotal', subtotal.toFixed(2));

    const zoneSurcharge = parseFloat(booking.zone_surcharge) || 0;
    if (zoneSurcharge > 0) {
      totalRow(`Zone surcharge (${booking.zone})`, `+${zoneSurcharge.toFixed(2)}`);
    }

    const discount = parseFloat(booking.discount) || 0;
    if (discount > 0) {
      totalRow(`Discount${booking.promo_code ? ` (${booking.promo_code})` : ''}`, `-${discount.toFixed(2)}`, { color: '#059669' });
    }

    const grandTotal = subtotal + zoneSurcharge - discount;
    const vatRate = 0.25;
    const exclVat = grandTotal / (1 + vatRate);
    const vatAmount = grandTotal - exclVat;

    // Separator
    doc.moveTo(totalsX, y).lineTo(col1 + tableWidth, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    y += 8;

    totalRow('Excl. VAT', exclVat.toFixed(2));
    totalRow('VAT (25%)', vatAmount.toFixed(2));

    // Separator before grand total
    doc.moveTo(totalsX, y).lineTo(col1 + tableWidth, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    y += 8;

    totalRow('TOTAL incl. VAT', grandTotal.toFixed(2), { bold: true, color: dark });

    // ─── RECOMMENDATIONS ───
    const recommendations = JSON.parse(report.recommendations || '[]');
    if (recommendations.length > 0) {
      y += 10;
      if (y > 680) { doc.addPage(); y = 50; }
      doc.fontSize(10).font('Helvetica-Bold').fillColor(dark).text('Recommendations', 50, y);
      y += 16;
      for (const rec of recommendations) {
        const txt = typeof rec === 'string' ? rec : (rec.description || rec);
        doc.fontSize(9).font('Helvetica').fillColor(gray).text(`→  ${txt}`, 60, y, { width: 470 });
        y += 14;
      }
    }

    // ─── MECHANIC NOTES ───
    if (report.mechanic_notes) {
      y += 10;
      if (y > 680) { doc.addPage(); y = 50; }
      doc.fontSize(10).font('Helvetica-Bold').fillColor(dark).text("Mechanic's Notes", 50, y);
      y += 16;
      doc.fontSize(9).font('Helvetica').fillColor(gray).text(report.mechanic_notes, 60, y, { width: 470 });
      y += doc.heightOfString(report.mechanic_notes, { width: 470 }) + 10;
    }

    // ─── FOOTER ───
    const footerY = 760;
    doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    doc.fontSize(8).font('Helvetica').fillColor(gray)
      .text('Mr. Bike — Mobile Bike Repair Copenhagen', 50, footerY + 8)
      .text('+45 91 61 00 13 · hello@mrbike.dk · mrbike.dk', 50, footerY + 19);
    doc.text('All prices include 25% Danish VAT (moms)', 350, footerY + 8, { align: 'right' });
    doc.text(`Invoice ${invoiceNumber}`, 350, footerY + 19, { align: 'right' });

    doc.end();
  });
}

/**
 * Generate a sequential invoice number: MRB-YYYY-NNNN
 */
function generateInvoiceNumber(db) {
  const year = new Date().getFullYear();
  const prefix = `MRB-${year}-`;
  const last = db.prepare(
    "SELECT invoice_number FROM bookings WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1"
  ).get(`${prefix}%`);

  let seq = 1;
  if (last && last.invoice_number) {
    const num = parseInt(last.invoice_number.replace(prefix, ''), 10);
    if (!isNaN(num)) seq = num + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

module.exports = { generateInvoice, generateInvoiceNumber };
