// Seeded randomness with independent per-channel substreams.
// Each channel ("pace", "hr-sensor", "gps-bias", …) gets its own sfc32 generator seeded from
// hash(seed, channel), so changing how many numbers one channel consumes (e.g. GPS noise level)
// never reshuffles another channel.

export interface Random {
  /** Uniform in [0, 1). */
  uniform(): number;
  /** Standard normal N(0, 1). */
  normal(): number;
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix32(x: number): number {
  let z = x | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** 32-bit seed for a named channel; any finite number is accepted as the user seed. */
export function channelSeed(seed: number, channel: string): number {
  const n = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  const lo = n >>> 0;
  const hi = Math.floor(n / 4294967296) >>> 0;
  let h = fnv1a(channel);
  h = mix32(h ^ lo);
  h = mix32((h + 0x9e3779b9) ^ hi);
  return h;
}

export function createRandom(seed: number, channel: string): Random {
  let state = channelSeed(seed, channel);
  const splitmix = (): number => {
    state = (state + 0x9e3779b9) | 0;
    return mix32(state);
  };
  let a = splitmix();
  let b = splitmix();
  let c = splitmix();
  let d = splitmix();

  const uniform = (): number => {
    // sfc32 (Chris Doty-Humphrey), period ≥ 2^32, passes PractRand to multi-GB.
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) uniform();

  let spare = 0;
  let hasSpare = false;
  const normal = (): number => {
    if (hasSpare) {
      hasSpare = false;
      return spare;
    }
    const u1 = 1 - uniform();
    const u2 = uniform();
    const r = Math.sqrt(-2 * Math.log(u1));
    spare = r * Math.sin(2 * Math.PI * u2);
    hasSpare = true;
    return r * Math.cos(2 * Math.PI * u2);
  };

  return { uniform, normal };
}

/** [time constant s, stationary σ] of one Ornstein–Uhlenbeck component. */
export type OuComponent = readonly [tau: number, sigma: number];

/**
 * Sum of independent OU processes sampled at 1 Hz, generated lazily and sequentially so the value at
 * index i never depends on how far other code has read. Exact discretisation:
 * x' = ρx + σ√(1−ρ²)·N, ρ = e^(−1/τ); started from the stationary distribution.
 */
export class OuTrack {
  private buf: Float64Array;
  private filled = 0;
  private readonly rho: Float64Array;
  private readonly kick: Float64Array;
  private readonly state: Float64Array;

  constructor(
    private readonly random: Random,
    components: ReadonlyArray<OuComponent>,
    scale: number,
    capacity = 4096,
  ) {
    const m = components.length;
    this.rho = new Float64Array(m);
    this.kick = new Float64Array(m);
    this.state = new Float64Array(m);
    for (let c = 0; c < m; c++) {
      const [tau, sigma] = components[c];
      const s = sigma * scale;
      const rho = Math.exp(-1 / Math.max(tau, 1e-6));
      this.rho[c] = rho;
      this.kick[c] = s * Math.sqrt(1 - rho * rho);
      this.state[c] = s * random.normal();
    }
    this.buf = new Float64Array(Math.max(16, capacity));
  }

  at(i: number): number {
    if (i >= this.filled) this.extend(i + 1);
    return this.buf[i];
  }

  private extend(n: number): void {
    if (n > this.buf.length) {
      const next = new Float64Array(Math.max(n, Math.ceil(this.buf.length * 1.5)));
      next.set(this.buf.subarray(0, this.filled));
      this.buf = next;
    }
    const { rho, kick, state, random } = this;
    const m = state.length;
    for (let i = this.filled; i < n; i++) {
      let sum = 0;
      for (let c = 0; c < m; c++) {
        state[c] = state[c] * rho[c] + kick[c] * random.normal();
        sum += state[c];
      }
      this.buf[i] = sum;
    }
    this.filled = n;
  }
}

/** Single OU process stepped by the caller (for channels generated in one pass). */
export function ouStepper(random: Random, tau: number, sigma: number): () => number {
  const rho = Math.exp(-1 / Math.max(tau, 1e-6));
  const kick = sigma * Math.sqrt(1 - rho * rho);
  let x = sigma * random.normal();
  return () => {
    x = x * rho + kick * random.normal();
    return x;
  };
}
