import {
  CommPacketId,
  parseFwVersion,
  parseGetValues,
  payloadGetFwVersion,
  payloadGetMcconf,
  payloadGetValues,
  payloadPingCan,
  payloadSetMcconf,
  payloadSetMcconfTemp,
  McconfTempLimits,
  VescFirmwareInfo,
  VescTelemetry,
  wrapForwardCan,
} from './vescProtocol';
import { McconfParseResult, parseMcconfReply } from './mcconf';
import type { SendOptions, VescTransport } from './vescTransport';

export type ControllerKey = 'front' | 'rear';

interface Job {
  payload: Uint8Array;
  expect: number | null;
  match?: (p: Uint8Array) => boolean;
  timeoutMs: number;
  options?: SendOptions;
  resolve: (p: Uint8Array | null) => void;
}

/**
 * One physical link. Exactly one request is in flight at a time, so replies that carry
 * no controller id (FW_VERSION, MCCONF, ACKs) can never be attributed to the wrong VESC.
 */
export class VescPort {
  private queue: Job[] = [];
  private inflight: Job | null = null;
  private timer: number | null = null;
  private closed = false;

  constructor(
    readonly transport: VescTransport,
    private readonly onUnsolicited: (payload: Uint8Array) => void
  ) {}

  request(
    payload: Uint8Array,
    expect: number | null,
    timeoutMs = 400,
    extra?: { match?: (p: Uint8Array) => boolean; options?: SendOptions; priority?: boolean }
  ): Promise<Uint8Array | null> {
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const job: Job = { payload, expect, timeoutMs, match: extra?.match, options: extra?.options, resolve };
      if (extra?.priority) this.queue.unshift(job);
      else this.queue.push(job);
      this.pump();
    });
  }

  get pending(): number {
    return this.queue.length + (this.inflight ? 1 : 0);
  }

  handlePayload(payload: Uint8Array): void {
    const job = this.inflight;
    if (job && job.expect === payload[0] && (!job.match || job.match(payload))) {
      this.finish(payload);
      return;
    }
    this.onUnsolicited(payload);
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.inflight?.resolve(null);
    this.inflight = null;
    for (const j of this.queue) j.resolve(null);
    this.queue = [];
  }

  private finish(result: Uint8Array | null) {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const job = this.inflight;
    this.inflight = null;
    job?.resolve(result);
    this.pump();
  }

  private pump() {
    if (this.inflight || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inflight = job;
    this.transport.sendPayload(job.payload, job.options).then(
      () => {
        if (this.inflight !== job) return;
        if (job.expect === null) {
          this.finish(null);
          return;
        }
        this.timer = window.setTimeout(() => {
          if (this.inflight === job) this.finish(null);
        }, job.timeoutMs);
      },
      () => {
        if (this.inflight === job) this.finish(null);
      }
    );
  }
}

export interface ControllerRoute {
  port: VescPort;
  canId: number | null; // null = directly attached
}

export interface PollStats {
  ok: number;
  timeouts: number;
}

/** High-level operations on the scooter's controllers. */
export class VescBus {
  private routes: Partial<Record<ControllerKey, ControllerRoute>> = {};
  private pausedDepth = 0;
  private running = false;
  readonly stats: Record<ControllerKey, PollStats> = { front: { ok: 0, timeouts: 0 }, rear: { ok: 0, timeouts: 0 } };

  constructor(private readonly onTelemetry: (key: ControllerKey, t: VescTelemetry) => void) {}

  setRoute(key: ControllerKey, route: ControllerRoute | null): void {
    if (route) this.routes[key] = route;
    else delete this.routes[key];
  }

  route(key: ControllerKey): ControllerRoute | undefined {
    return this.routes[key];
  }

  has(key: ControllerKey): boolean {
    return Boolean(this.routes[key]);
  }

  private wrap(route: ControllerRoute, payload: Uint8Array): Uint8Array {
    return route.canId === null ? payload : wrapForwardCan(route.canId, payload);
  }

  async request(key: ControllerKey, payload: Uint8Array, expect: number | null, timeoutMs: number, options?: SendOptions) {
    const route = this.routes[key];
    if (!route) return null;
    return route.port.request(this.wrap(route, payload), expect, timeoutMs, { options });
  }

  async getValues(key: ControllerKey): Promise<VescTelemetry | null> {
    const route = this.routes[key];
    if (!route) return null;
    // Prefer the controller id byte (FW ≥ 5) to reject late replies from the other VESC.
    const other = key === 'front' ? this.routes.rear : this.routes.front;
    const match = (p: Uint8Array) => {
      if (p.length < 59) return true;
      const id = p[58];
      if (route.canId !== null) return id === route.canId;
      if (other && other.port === route.port && other.canId !== null) return id !== other.canId;
      return true;
    };
    const reply = await route.port.request(this.wrap(route, payloadGetValues()), CommPacketId.COMM_GET_VALUES, 350, { match });
    return reply ? parseGetValues(reply) : null;
  }

  async getFw(key: ControllerKey): Promise<VescFirmwareInfo | null> {
    const reply = await this.request(key, payloadGetFwVersion(), CommPacketId.COMM_FW_VERSION, 800);
    return reply ? parseFwVersion(reply) : null;
  }

  async getMcconf(key: ControllerKey): Promise<McconfParseResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await this.request(key, payloadGetMcconf(), CommPacketId.COMM_GET_MCCONF, 2500);
      if (reply) return parseMcconfReply(reply);
    }
    return { ok: false, reason: 'Контроллер не прислал конфигурацию (таймаут).' };
  }

  async setMcconf(key: ControllerKey, bytes: Uint8Array): Promise<boolean> {
    const reply = await this.request(key, payloadSetMcconf(bytes), CommPacketId.COMM_SET_MCCONF, 5000, { reliable: true });
    return reply !== null;
  }

  async setTempLimits(key: ControllerKey, limits: McconfTempLimits): Promise<boolean> {
    const reply = await this.request(key, payloadSetMcconfTemp(limits), CommPacketId.COMM_SET_MCCONF_TEMP, 1200, {
      reliable: true,
    });
    return reply !== null;
  }

  async pingCan(port: VescPort): Promise<number[] | null> {
    const reply = await port.request(payloadPingCan(), CommPacketId.COMM_PING_CAN, 2500);
    return reply ? Array.from(reply.slice(1)) : null;
  }

  /** Runs fn with telemetry polling paused (config transactions, flash writes). */
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.pausedDepth++;
    try {
      return await fn();
    } finally {
      this.pausedDepth--;
    }
  }

  get paused(): boolean {
    return this.pausedDepth > 0;
  }

  startPolling(): void {
    if (this.running) return;
    this.running = true;
    void this.pollLoop();
  }

  stopPolling(): void {
    this.running = false;
  }

  private async pollLoop() {
    const keys: ControllerKey[] = ['front', 'rear'];
    while (this.running) {
      const started = performance.now();
      if (!this.paused) {
        for (const key of keys) {
          if (!this.running || this.paused || !this.routes[key]) continue;
          const t = await this.getValues(key);
          if (t) {
            this.stats[key].ok++;
            this.onTelemetry(key, t);
          } else {
            this.stats[key].timeouts++;
          }
        }
      }
      const elapsed = performance.now() - started;
      await new Promise((r) => window.setTimeout(r, Math.max(15, 100 - elapsed)));
    }
  }
}
