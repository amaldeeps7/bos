import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, JobsOptions, Queue, Worker } from 'bullmq';

type Handler = (data: any, job: Job) => Promise<unknown>;

/** BullMQ wants plain connection options (and no per-command retry limit, since workers block on Redis). */
function connection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname, port: Number(u.port || 6379), username: decodeURIComponent(u.username) || undefined, password: decodeURIComponent(u.password) || undefined,
    db: Number(u.pathname.slice(1) || 0), tls: u.protocol === 'rediss:' ? {} : undefined, maxRetriesPerRequest: null,
  };
}

/**
 * Background work on Redis (BullMQ): the once-a-minute scheduler and data exports.
 * - Every API instance can run workers; each job runs once, on one of them, and survives restarts.
 * - The scheduler is a repeating job, so with several instances it still runs once a minute, not once per instance.
 * - WORKERS=off runs an instance that only queues work (e.g. web-facing nodes when workers run separately).
 * - Without REDIS_URL, jobs run in-process right away (development without Redis).
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('Queue');
  private queue?: Queue;
  private worker?: Worker;
  private handlers = new Map<string, Handler>();
  private schedules: [string, number][] = [];
  static readonly NAME = 'bos';

  constructor() {
    if (process.env.REDIS_URL) this.queue = new Queue(QueueService.NAME, { connection: connection(process.env.REDIS_URL), prefix: 'bos:q',
      defaultJobOptions: { removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 7 * 86400, count: 1000 } } });
  }

  /** Registers what a job name does. Call from a service's constructor or onModuleInit. */
  handle(name: string, fn: Handler) { this.handlers.set(name, fn); }

  /** Queues a job. `jobId` makes it idempotent (a second add with the same id is ignored). */
  async add(name: string, data: object, opts: JobsOptions = {}) {
    if (!this.queue) { setImmediate(() => void this.run(name, data).catch(e => this.log.error(`${name}: ${(e as Error).message}`))); return; }
    await this.queue.add(name, data, { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, ...opts });
  }

  /** Runs `name` every `ms`, once across all instances. */
  every(name: string, ms: number) { this.schedules.push([name, ms]); }

  private run(name: string, data: any, job?: Job) {
    const fn = this.handlers.get(name);
    if (!fn) throw new Error(`No handler for job "${name}"`);
    return fn(data, job as Job);
  }

  async onApplicationBootstrap() {
    if (!this.queue) {
      if (this.schedules.length) this.log.warn('REDIS_URL not set — scheduled jobs are off');
      return;
    }
    for (const [name, ms] of this.schedules) await this.queue.upsertJobScheduler(name, { every: ms }, { name, data: {}, opts: { attempts: 1 } });
    if (process.env.WORKERS === 'off') return;
    this.worker = new Worker(QueueService.NAME, job => this.run(job.name, job.data, job), {
      connection: connection(process.env.REDIS_URL!), prefix: 'bos:q', concurrency: Number(process.env.WORKER_CONCURRENCY || 4),
    });
    this.worker.on('failed', (job, e) => this.log.warn(`${job?.name} ${job?.id} failed (attempt ${job?.attemptsMade}): ${e.message}`));
    this.worker.on('error', e => this.log.warn(`worker: ${e.message}`));
  }

  /** Lets running jobs finish before the process exits. */
  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
