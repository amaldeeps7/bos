import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PrismaService } from './prisma.service';
import { orgId } from './tenant';

export interface Mail {
  to: string | string[]; cc?: string[]; subject: string; text: string; html?: string;
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
  icalEvent?: { method: 'REQUEST' | 'CANCEL'; content: string };
  kind: string; ref?: string; userId?: string; replyTo?: string;
}

/**
 * Sends email over SMTP (SMTP_URL, e.g. smtp://user:pass@smtp.example.com:587). Every message is written to the
 * email log with its result. Without SMTP_URL nothing leaves the server and messages are logged as "not sent".
 */
@Injectable()
export class MailService {
  private log = new Logger('Mail');
  private transport: Transporter | null = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;

  constructor(private prisma: PrismaService) {
    if (!this.transport) this.log.warn('SMTP_URL is not set — emails are logged but not sent');
  }

  get configured() { return !!this.transport; }

  async send(m: Mail): Promise<{ ok: boolean; error?: string }> {
    const to = (Array.isArray(m.to) ? m.to : [m.to]).filter(Boolean);
    if (!to.length) return { ok: false, error: 'No recipient email address' };
    const org = await this.prisma.organization.findUnique({ where: { id: orgId() } });
    // Sent from the platform address, under the organisation's own name (spec §6).
    const env = process.env.EMAIL_FROM || '';
    const addr = env.match(/<([^>]+)>/)?.[1] || (env.includes('@') ? env.trim() : `no-reply@${(org?.security as any)?.domains?.split(',')[0]?.trim() || 'localhost'}`);
    const from = { name: org?.name || 'Business OS', address: addr };
    let ok = false; let error: string | undefined;
    if (!this.transport) error = 'Email is not configured (SMTP_URL)';
    else {
      try {
        await this.transport.sendMail({ from, to, cc: m.cc?.filter(Boolean), replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments, icalEvent: m.icalEvent });
        ok = true;
      } catch (e: any) { error = String(e?.message || e).slice(0, 500); this.log.error(`Failed to send "${m.subject}": ${error}`); }
    }
    await this.prisma.emailLog.create({ data: { to: [...to, ...(m.cc || [])].join(', '), subject: m.subject, kind: m.kind, ref: m.ref, status: ok ? 'sent' : 'failed', error, userId: m.userId } });
    return { ok, error };
  }
}

/** Fills {token} placeholders. */
export const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all));

/** A plain, readable HTML version of a text email. */
export const htmlOf = (text: string, accent = '#0052ff', footer = '') =>
  `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;max-width:560px">` +
  text.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>').replace(/(https?:\/\/\S+)/g, `<a href="$1" style="color:${accent}">$1</a>`)}</p>`).join('') +
  (footer ? `<p style="margin:24px 0 0;font-size:12px;color:#64748b">${footer}</p>` : '') + `</div>`;
