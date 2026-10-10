import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { join, dirname } from 'path';
import { Calc, fmtDLong, inr, rupeesInWords } from '@bos/shared';

const FONT_DIR = join(dirname(require.resolve('inter-ui/package.json')), 'Inter (web)');

export interface Template { layout: 'Classic' | 'Modern' | 'Compact'; accent: string; title: string; show: Record<string, boolean>; terms: string }
export interface Party { name: string; gstin: string; lines: string[] }
export interface DocInput {
  template: Template; no: string; entity: Party & { bank: string; upi: string; initials: string };
  to: Party; toLabel: string; meta: [string, string][]; calc: Calc; notes?: string; supplyNote: string;
  extraTotals?: [string, string][]; balance?: number; reference?: string;
}

/** Renders quotations, invoices and credit notes as A4 PDFs, following the template settings. */
@Injectable()
export class PdfService {
  async render(d: DocInput): Promise<Buffer> {
    const t = d.template; const compact = t.layout === 'Compact', modern = t.layout === 'Modern';
    const M = compact ? 32 : 44; const base = compact ? 8.5 : 9.5;
    const doc = new PDFDocument({ size: 'A4', margin: M, info: { Title: `${t.title} ${d.no}`, Author: d.entity.name } });
    doc.registerFont('R', join(FONT_DIR, 'Inter-Regular.woff')); doc.registerFont('B', join(FONT_DIR, 'Inter-SemiBold.woff'));
    const chunks: Buffer[] = []; doc.on('data', c => chunks.push(c));
    const done = new Promise<Buffer>(res => doc.on('end', () => res(Buffer.concat(chunks))));
    const W = doc.page.width, right = W - M, width = W - 2 * M;
    const ink = '#0f172a', muted = '#64748b', soft = '#475569', line = '#e2e8f0';
    let y = M;

    // header
    if (modern) {
      doc.rect(0, 0, W, compact ? 46 : 58).fill(t.accent);
      doc.fillColor('#fff').font('B').fontSize(compact ? 13 : 15).text(t.title, M, compact ? 16 : 20, { lineBreak: false });
      doc.font('R').fontSize(base + 1).text(d.no, M, compact ? 18 : 23, { width, align: 'right' });
      y = (compact ? 46 : 58) + (compact ? 16 : 24);
    } else {
      doc.rect(0, 0, W, 4).fill(t.accent);
      y = M;
    }
    let x = M;
    if (t.show.logo) {
      doc.roundedRect(M, y, 34, 34, 7).fill(t.accent);
      doc.fillColor('#fff').font('B').fontSize(11).text(d.entity.initials, M, y + 11, { width: 34, align: 'center' });
      x = M + 46;
    }
    doc.fillColor(ink).font('B').fontSize(base + 3).text(d.entity.name, x, y, { width: 300 });
    doc.font('R').fontSize(base).fillColor(soft);
    for (const l of [...d.entity.lines, ...(d.entity.gstin ? [`GSTIN ${d.entity.gstin}`] : [])]) doc.text(l, x, doc.y + 1, { width: 300 });
    const headBottom = doc.y;
    if (!modern) {
      doc.fillColor(t.accent).font('B').fontSize(compact ? 15 : 18).text(t.title, M, y, { width, align: 'right' });
      doc.fillColor(soft).font('R').fontSize(base + 0.5).text(d.no, M, doc.y + 2, { width, align: 'right' });
    }
    y = Math.max(headBottom, doc.y) + (compact ? 12 : 18);

    // parties & dates
    doc.moveTo(M, y).lineTo(right, y).lineWidth(0.75).strokeColor(line).stroke();
    const top = y + 10;
    doc.fillColor(muted).font('R').fontSize(base).text(d.toLabel, M, top);
    doc.fillColor(ink).font('B').fontSize(base + 1.5).text(d.to.name, M, doc.y + 1, { width: 280 });
    doc.font('R').fontSize(base).fillColor(soft); if (d.to.gstin) doc.text(`GSTIN ${d.to.gstin}`, M, doc.y + 1, { width: 280 });
    for (const l of d.to.lines) doc.text(l, M, doc.y, { width: 280 });
    let leftBottom = doc.y;
    let my = top;
    for (const [k, v] of d.meta) {
      doc.fillColor(muted).font('R').fontSize(base).text(k, right - 220, my, { width: 110 });
      doc.fillColor(ink).font('B').text(v, right - 110, my, { width: 110, align: 'right' }); my += base + 6;
    }
    y = Math.max(leftBottom, my) + 10;
    doc.moveTo(M, y).lineTo(right, y).strokeColor(line).stroke();
    y += 8;
    const note = [d.supplyNote, d.reference].filter(Boolean).join(' · ');
    if (note) { doc.fillColor(muted).font('R').fontSize(base - 0.5).text(note, M, y, { width, align: 'right' }); y = doc.y + 8; }

    // lines
    const showDisc = d.calc.rows.some(r => +r.disc);
    type Col = { k: string; label: string; w: number; align: 'left' | 'right' };
    const cols: Col[] = [{ k: 'd', label: 'Description', w: 0, align: 'left' }, ...(t.show.sac && d.calc.gst ? [{ k: 'sac', label: 'SAC', w: 48, align: 'left' as const }] : []),
      { k: 'qty', label: 'Qty', w: 62, align: 'right' }, { k: 'rate', label: 'Rate', w: 70, align: 'right' }, ...(showDisc ? [{ k: 'disc', label: 'Disc.', w: 38, align: 'right' as const }] : []),
      { k: 'amt', label: 'Amount', w: 78, align: 'right' }];
    cols[0].w = width - cols.slice(1).reduce((a, c) => a + c.w + 8, 0);
    const pos = (i: number) => M + cols.slice(0, i).reduce((a, c) => a + c.w + 8, 0);
    const pad = compact ? 4 : 6;
    doc.fillColor(t.accent).font('B').fontSize(base);
    cols.forEach((c, i) => doc.text(c.label, pos(i), y, { width: c.w, align: c.align }));
    y = doc.y + pad; doc.moveTo(M, y).lineTo(right, y).lineWidth(1.25).strokeColor(t.accent).stroke(); y += pad;
    doc.font('R').fillColor(ink).fontSize(base);
    for (const r of d.calc.rows) {
      const vals: Record<string, string> = { d: r.d, sac: r.sac, qty: `${r.qty} ${r.unit}`, rate: inr(r.rate), disc: +r.disc ? `${r.disc}%` : '—', amt: inr(r.taxable) };
      const h = Math.max(...cols.map(c => doc.heightOfString(vals[c.k], { width: c.w })));
      if (y + h > doc.page.height - M - 140) { doc.addPage(); y = M; }
      cols.forEach((c, i) => doc.fillColor(c.k === 'sac' ? muted : ink).text(vals[c.k], pos(i), y, { width: c.w, align: c.align }));
      y += h + pad; doc.moveTo(M, y).lineTo(right, y).lineWidth(0.5).strokeColor(line).stroke(); y += pad;
    }

    // totals
    const tx = right - 230; y += 4;
    const totals: [string, string, boolean?][] = [['Subtotal', inr(d.calc.sub)], ...(d.calc.disc ? [['Discount', '−' + inr(d.calc.disc)] as [string, string]] : []), ...(d.calc.gst ? [['Taxable value', inr(d.calc.taxable)] as [string, string]] : []),
      ...d.calc.taxRows.map(([l, v]) => [l, inr(v), true] as [string, string, boolean])];
    for (const [l, v, m] of totals) { doc.fillColor(m ? muted : ink).font('R').fontSize(base).text(l, tx, y, { width: 130 }); doc.text(v, tx + 130, y, { width: 100, align: 'right' }); y += base + 6; }
    doc.moveTo(tx, y).lineTo(right, y).lineWidth(0.75).strokeColor('#cbd5e1').stroke(); y += 6;
    doc.fillColor(ink).font('B').fontSize(base + 2.5).text('Total (INR)', tx, y, { width: 130 }); doc.fillColor(t.accent).text(inr(d.calc.grand), tx + 100, y, { width: 130, align: 'right' }); y = doc.y + 4;
    for (const [l, v] of d.extraTotals || []) { doc.fillColor(soft).font('R').fontSize(base).text(l, tx, y, { width: 130 }); doc.text(v, tx + 130, y, { width: 100, align: 'right' }); y += base + 6; }
    if (d.balance !== undefined) { doc.fillColor(ink).font('B').fontSize(base + 1).text('Balance due', tx, y, { width: 130 }); doc.text(inr(d.balance), tx + 130, y, { width: 100, align: 'right' }); y = doc.y + 4; }
    y += 6;
    if (t.show.words) { doc.fillColor(muted).font('R').fontSize(base).text('In words: ', M, y, { continued: true }).fillColor(soft).text(rupeesInWords(d.calc.grand), { width }); y = doc.y + 8; }
    if (d.notes) { doc.fillColor(muted).font('R').fontSize(base).text('Notes', M, y); doc.fillColor(ink).text(d.notes, M, doc.y + 2, { width: width * 0.65 }); y = doc.y + 10; }

    // footer block: bank, UPI, signatory
    const fy = Math.max(y + 10, doc.page.height - M - (t.terms ? 150 : 110));
    if (fy + 90 > doc.page.height - M) { doc.addPage(); y = M; }
    const foot = Math.max(y + 10, Math.min(fy, doc.page.height - M - 140));
    if (t.show.bank) { doc.fillColor(muted).font('R').fontSize(base).text('Bank details', M, foot); doc.fillColor(ink).text(d.entity.bank, M, doc.y + 2, { width: 230 }); }
    if (t.show.upi && d.entity.upi) {
      const amt = d.balance !== undefined ? d.balance : d.calc.grand;
      const url = `upi://pay?pa=${encodeURIComponent(d.entity.upi)}&pn=${encodeURIComponent(d.entity.name)}&am=${amt.toFixed(2)}&cu=INR&tn=${encodeURIComponent(d.no)}`;
      const png = await QRCode.toBuffer(url, { margin: 0, width: 220, color: { dark: '#0f172a' } });
      const qx = M + width / 2 - 32; doc.image(png, qx, foot, { width: 64 });
      doc.fillColor(muted).fontSize(base - 1).text(`UPI ${d.entity.upi}`, qx - 40, foot + 68, { width: 144, align: 'center' });
    }
    if (t.show.sign) {
      doc.moveTo(right - 140, foot + 46).lineTo(right, foot + 46).lineWidth(0.75).strokeColor('#94a3b8').stroke();
      doc.fillColor(muted).font('R').fontSize(base).text(`For ${d.entity.name}`, right - 200, foot + 22, { width: 200, align: 'right' });
      doc.text('Authorised signatory', right - 200, foot + 52, { width: 200, align: 'right' });
    }
    if (t.terms?.trim()) {
      const ty = foot + 92; doc.moveTo(M, ty).lineTo(right, ty).lineWidth(0.5).strokeColor(line).stroke();
      doc.fillColor(muted).font('R').fontSize(base - 1).text(t.terms, M, ty + 8, { width });
    }
    doc.end();
    return done;
  }
}

export const dateLong = (iso: string) => fmtDLong(iso);
