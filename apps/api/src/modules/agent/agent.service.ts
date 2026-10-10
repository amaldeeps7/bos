import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { fmtD, weekday } from '@bos/shared';
import { PrismaService } from '../../core/prisma.service';
import { RedisService } from '../../core/redis.service';
import { OrgService } from '../../core/org.service';
import { orgId } from '../../core/tenant';
import type { AuthUser } from '../../core/auth.types';
import { FinanceService } from '../finance.service';
import { SearchController } from '../search.controller';
import { AgentTools, Proposal, toolsFor, validate } from './agent.tools';

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const MAX_STEPS = 10;         // model calls per question
const MAX_HISTORY = 80;       // messages kept per conversation before starting fresh
const TTL = 4 * 3600;         // conversations expire after 4 idle hours

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'status'; text: string }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'done'; conversationId: string; reset?: boolean }
  | { type: 'error'; text: string };

/** Stable across requests so the prompt cache can reuse it; the date and page context go in the user turn. */
const SYSTEM = `You are the assistant inside Business OS, the operating system of a services company (projects, tasks, meetings, customers, quotations, GST invoices, payments). You work for the signed-in person and can see only what their role allows.

Use the tools to look things up rather than guessing; look before you answer anything about records. Never invent numbers, names or dates.

You can't change anything yourself. To do something (create or update a task, schedule a meeting, send a payment reminder, comment on a task), call the matching propose_ tool: the person sees a Confirm button and nothing happens unless they press it. Never say an action is done; say it's ready to confirm. Propose only what they asked for or clearly agreed to.

Keep replies short and plain: a sentence or two, then a short list if useful. No markdown headings or tables. Amounts are in Indian rupees as the tools give them. Dates like "Mon 12 Oct". If something isn't in the records, say so.`;

/** A per-person, per-organisation agent conversation. History is append-only (thinking blocks must be replayed unchanged). */
@Injectable()
export class AgentService {
  private log = new Logger('Agent');
  /** Replaced in tests with a scripted client. */
  client: Pick<Anthropic, 'beta'> | null = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  constructor(private prisma: PrismaService, private redis: RedisService, private orgs: OrgService, private fin: FinanceService, private search: SearchController) {}

  get enabled() { return !!this.client; }
  private key(me: AuthUser, conv: string) { return `bos:${orgId()}:agent:${me.id}:${conv}`; }

  async run(me: AuthUser, conversationId: string, question: string, page: string, emit: (e: AgentEvent) => void, signal: AbortSignal) {
    if (!this.client) throw new Error('agent not configured');
    const { org, today } = await this.orgs.ctx();
    let conv = /^[a-z0-9-]{8,64}$/i.test(conversationId) ? conversationId : crypto.randomUUID();
    let history = (await this.redis.getJSON<Anthropic.Beta.BetaMessageParam[]>(this.key(me, conv))) || [];
    let reset = false;
    if (history.length > MAX_HISTORY) { history = []; conv = crypto.randomUUID(); reset = true; }

    // Volatile context rides in the new user turn, so the system prompt and earlier turns stay cacheable.
    const context = `[${weekday(today)} ${fmtD(today)}, ${org.tz}. I'm ${me.name} (${me.roleName}) in ${org.name}.${page ? ` I'm looking at: ${page}.` : ''}]`;
    history.push({ role: 'user', content: `${context}\n\n${question}` });

    const tools = toolsFor(me);
    const exec = new AgentTools(this.prisma, this.fin, this.search, me, today, org.tz);
    let badJson = 0;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (signal.aborted) break;
        const stream = this.client.beta.messages.stream({
          model: MODEL, max_tokens: 16000, system: SYSTEM, tools, messages: history,
          thinking: { type: 'adaptive' }, output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          // Refusal fallback: if the model declines, the API re-runs the turn on a fallback model in the same call.
          betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        } as any, { signal });
        stream.on('text', (delta: string) => emit({ type: 'text', delta }));

        let msg: Anthropic.Beta.BetaMessage;
        try { msg = await stream.finalMessage(); badJson = 0; }
        catch (e) {
          // A tool input that couldn't be parsed at all: re-issue the turn (a few times). API errors go up.
          if (e instanceof Anthropic.APIError || signal.aborted || badJson++ >= 2) throw e;
          this.log.warn('tool input was not parseable JSON; re-issuing the turn');
          continue;
        }
        history.push({ role: 'assistant', content: msg.content as any });

        if (msg.stop_reason === 'refusal') { emit({ type: 'text', delta: '\n\nI can’t help with that one.' }); break; }
        if (msg.stop_reason === 'pause_turn') continue;
        const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (!uses.length) break;
        if (msg.stop_reason === 'max_tokens') { emit({ type: 'error', text: 'That answer ran too long. Try a narrower question.' }); break; }

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const u of uses) {
          const problem = validate(u.name, u.input);
          if (problem) { results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(u.input), problem }) }); continue; }
          const out = await exec.run(u.name, u.input, u.id);
          emit({ type: 'status', text: out.status });
          if (out.proposal) emit({ type: 'proposal', proposal: out.proposal });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
        }
        // Every result in one user message (keeps parallel tool use working).
        history.push({ role: 'user', content: results });
        if (step === MAX_STEPS - 1) emit({ type: 'text', delta: '\n\nI stopped there — ask me to keep going if you need more.' });
      }
    } finally {
      // An unanswered tool_use can't be replayed; drop a dangling turn so the next question starts cleanly.
      const last = history[history.length - 1];
      if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.some((b: any) => b.type === 'tool_use')) history.pop();
      if (history[history.length - 1]?.role === 'user' && typeof history[history.length - 1].content === 'string') history.pop();
      if (history.length) await this.redis.setJSON(this.key(me, conv), history, TTL);
    }
    emit({ type: 'done', conversationId: conv, ...(reset ? { reset } : {}) });
  }

  async forget(me: AuthUser, conversationId: string) { await this.redis.del(this.key(me, conversationId)); }
}
