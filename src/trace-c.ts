/**
 * TRACE-C — Copula-Calibrated Temporal Relational Anomaly Detection (v2).
 *
 * Multi-stream operational anomaly detection:
 *
 *   marginals   — regime-conditioned rolling robust-z (or rank-PIT legacy),
 *                 strictly prior same-regime history, so seasonal drift does
 *                 not masquerade as anomaly.
 *   G channel   — Gaussian copula-form dependence score on robust-z residuals,
 *                 with dependence fitted on the train segment; not an
 *                 independence assumption.
 *   T channel   — AR(1) innovation surprise per stream (order/temporal break).
 *   L channel   — max per-stream window aggregate |z| (two-sided).
 *   ranks       — each channel as a rank-p vs a trailing window of strictly
 *                 prior windows (drift-adaptive; no self-inclusion).
 *   combination — S = Fisher over channel rank-p's; conformal p vs the growing
 *                 set of all strictly-prior S values (exact finite-sample rank
 *                 formula, never rounded).
 *   selection   — BH FDR is attempted first; if it selects no windows, use the
 *                 record rule with expected_null_alerts under exchangeable
 *                 scores; then a hard per-day operator-attention budget.
 *                 Dropped alerts are counted.
 *
 * Deterministic, dependency-free TypeScript. Generic over any aligned
 * multi-stream matrix. Operational streams only — never person-risk scores.
 */

// ---------- numerics ----------

/** Acklam's inverse normal CDF approximation (|rel err| < 1.15e-9). */
export function invNormCdf(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`invNormCdf domain: ${p}`);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) return -invNormCdf(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Cholesky decomposition (lower L) with ridge added until PD. */
export function cholesky(m: number[][]): { L: number[][]; ridge: number } {
  const n = m.length;
  let ridge = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = m[i]![j]! + (i === j ? ridge : 0);
        for (let k = 0; k < j; k++) sum -= L[i]![k]! * L[j]![k]!;
        if (i === j) {
          if (sum <= 1e-12) {
            ok = false;
            break;
          }
          L[i]![j] = Math.sqrt(sum);
        } else {
          L[i]![j] = sum / L[j]![j]!;
        }
      }
    }
    if (ok) return { L: L!, ridge };
    ridge = ridge === 0 ? 1e-6 : ridge * 10;
  }
  throw new Error("cholesky: matrix not PD even with ridge");
}

function cholSolve(L: number[][], b: number[]): number[] {
  const n = L.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i]![k]! * y[k]!;
    y[i] = s / L[i]![i]!;
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k]![i]! * x[k]!;
    x[i] = s / L[i]![i]!;
  }
  return x;
}

function logDet(L: number[][]): number {
  let s = 0;
  for (let i = 0; i < L.length; i++) s += Math.log(L[i]![i]!);
  return 2 * s;
}

// ---------- marginals ----------

/**
 * Rolling regime-conditioned PIT: u_t = mid-rank of x_t among the LAST K
 * observations of the same regime (strictly before t). null during burn-in.
 */
export function rollingRegimePIT(
  vals: number[],
  regime: number[],
  K: number
): (number | null)[] {
  const hist = new Map<number, number[]>();
  const out: (number | null)[] = new Array(vals.length).fill(null);
  for (let t = 0; t < vals.length; t++) {
    const r = regime[t]!;
    const v = vals[t]!;
    let h = hist.get(r);
    if (!h) {
      h = [];
      hist.set(r, h);
    }
    if (h.length >= K) {
      const win = h.slice(-K);
      let less = 0;
      let eq = 0;
      for (const x of win) {
        if (x < v) less++;
        else if (x === v) eq++;
      }
      out[t] = (less + 0.5 * eq + 0.5) / (K + 1);
    }
    h.push(v);
    if (h.length > K * 2) h.splice(0, h.length - K); // bound memory
  }
  return out;
}

/**
 * Rolling regime-conditioned robust z: (v − median) / (1.4826·MAD) over the
 * last K same-regime observations (strictly prior), clipped to ±Z_CLIP.
 *
 * This is the MARGINAL the channels consume. A rank-PIT marginal clips z at
 * ±Φ⁻¹((K+½)/(K+1)) (approximately ±2.2509 at K=40), so a 30σ physical excursion scores the
 * same as a barely-record reading — deep-tail power is destroyed by design.
 * The robust-z marginal preserves magnitude; VALIDITY is unaffected because
 * the downstream channel scores are rank-normalized against trailing windows
 * and conformalized — marginal choice only moves power.
 */
export function rollingRegimeZ(
  vals: number[],
  regime: number[],
  K: number,
  zClip = 10
): (number | null)[] {
  const hist = new Map<number, number[]>();
  const out: (number | null)[] = new Array(vals.length).fill(null);
  for (let t = 0; t < vals.length; t++) {
    const r = regime[t]!;
    const v = vals[t]!;
    let h = hist.get(r);
    if (!h) {
      h = [];
      hist.set(r, h);
    }
    if (h.length >= K) {
      const win = [...h.slice(-K)].sort((a, b) => a - b);
      const m = Math.floor(win.length / 2);
      const med = win.length % 2 ? win[m]! : (win[m - 1]! + win[m]!) / 2;
      const devs = win.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
      const madv = (devs.length % 2 ? devs[m]! : (devs[m - 1]! + devs[m]!) / 2) || 1e-9;
      const z = (v - med) / (1.4826 * madv);
      out[t] = Math.max(-zClip, Math.min(zClip, z));
    }
    h.push(v);
    if (h.length > K * 2) h.splice(0, h.length - K);
  }
  return out;
}

// ---------- core ----------

export const TRACE_C_CHANNEL_NAMES = ["local", "copula", "temporal"] as const;
export type TraceCChannel = (typeof TRACE_C_CHANNEL_NAMES)[number];

export function resolveEnabledChannels(
  enabled?: readonly string[]
): TraceCChannel[] {
  const requested = enabled ?? TRACE_C_CHANNEL_NAMES;
  if (requested.length === 0) {
    throw new Error("enabledChannels must be non-empty");
  }
  const allowed = new Set<string>(TRACE_C_CHANNEL_NAMES);
  const seen = new Set<string>();
  for (const name of requested) {
    if (!allowed.has(name)) throw new Error(`unknown channel ${name}`);
    if (seen.has(name)) throw new Error(`duplicate channel ${name}`);
    seen.add(name);
  }
  return TRACE_C_CHANNEL_NAMES.filter((name) => seen.has(name));
}

export type TraceCInput = {
  /** Aligned equal-length series, one per operational stream. */
  streams: Record<string, number[]>;
  /** Regime id per timestep (e.g. settlement period × day-type). */
  regime: number[];
  /** Timesteps per non-overlapping window. */
  windowSize: number;
  /** Exclusive t-index boundaries: [0,trainEnd) train · [trainEnd,calEnd) calibration · [calEnd,N) test. */
  splits: { trainEnd: number; calEnd: number };
  pitK?: number; // rolling PIT depth per regime (default 20)
  fdrQ?: number; // BH level across test windows (default 0.1)
  budgetPerDay?: number; // hard operator-attention budget (default 2)
  periodsPerDay?: number; // timesteps per day, for budget grouping
  rollingRefSize?: number; // trailing windows per channel rank reference (default 240)
  sRefMin?: number; // min prior S values before conformal p is emitted (default 40)
  /** Subset of built-in channels to rank and combine. Default: all three. */
  enabledChannels?: readonly TraceCChannel[];
  /** Fisher sum (default, frozen v2) or strongest single channel rank. */
  combine?: "fisher" | "max_channel";
  /** Frozen v2: BH then record, then budget. v3: budget scored test windows. */
  selectionMode?: "bh_then_record" | "daily_budget";
  /** With daily_budget, only consider windows with p ≤ pGate. Default: no gate. */
  pGate?: number;
  /** Optional extra per-WINDOW channel scores (e.g. discrete-sequence NLL). */
  extraChannels?: Record<string, (number | null)[]>;
};

export type TraceCWindow = {
  w: number;
  t0: number;
  segment: "burn_in" | "train" | "cal" | "test";
  channels: Record<string, number>; // raw channel scores
  channelsRz: Record<string, number> | null; // robust-z vs calibration
  streamZ: Record<string, number>; // per-stream window z (evidence)
  S: number | null; // combined score (Fisher over trailing channel rank-p's)
  p: number | null; // conformal p vs all strictly-prior S (exact, unrounded)
  pFloor?: number | null; // smallest achievable p at this window: 1/(n_prior+1)
};

export type TraceCAlert = {
  w: number;
  t0: number;
  p: number;
  S: number;
  channelsRz: Record<string, number>;
  lead_channel: string;
  streamZ: Record<string, number>;
  contributing_streams: { stream: string; zw: number }[];
};

export type TraceCResult = {
  windows: TraceCWindow[];
  alerts: TraceCAlert[]; // post-selection, post-budget, sorted by p then S
  selection: "bh" | "record_rule" | "daily_budget";
  fdr_pass_count: number;
  expected_null_alerts: number; // what the selection rule would fire on pure noise
  budget_dropped: number;
  n_cal: number; // prior-S reference count at the final window
  conformal_floor: number; // smallest achievable p at the final window
  copula: { streams: string[]; corr: number[][]; ridge: number };
  config: Required<
    Pick<TraceCInput, "windowSize" | "pitK" | "fdrQ" | "budgetPerDay" | "rollingRefSize" | "sRefMin">
  > & {
    trainEnd: number;
    calEnd: number;
    n: number;
  };
};

export function runTraceC(input: TraceCInput): TraceCResult {
  const names = Object.keys(input.streams);
  if (!names.length) throw new Error("no streams");
  const N = input.streams[names[0]!]!.length;
  for (const s of names) {
    if (input.streams[s]!.length !== N) throw new Error(`stream ${s} length mismatch`);
  }
  const K = input.pitK ?? 20;
  const W = input.windowSize;
  const q = input.fdrQ ?? 0.1;
  const budget = input.budgetPerDay ?? 2;
  const perDay = input.periodsPerDay ?? W;
  const enabled = resolveEnabledChannels(input.enabledChannels);
  const enabledSet = new Set<string>(enabled);
  const combine = input.combine ?? "fisher";
  if (combine !== "fisher" && combine !== "max_channel") {
    throw new Error(`unknown combine ${combine}`);
  }
  const selectionMode = input.selectionMode ?? "bh_then_record";
  if (selectionMode !== "bh_then_record" && selectionMode !== "daily_budget") {
    throw new Error(`unknown selectionMode ${selectionMode}`);
  }
  const { trainEnd, calEnd } = input.splits;
  if (!(trainEnd > 0 && calEnd > trainEnd && calEnd < N)) {
    throw new Error("bad splits");
  }

  // 1) Marginals → z (magnitude-preserving rolling robust-z; see rollingRegimeZ)
  const z: Record<string, (number | null)[]> = {};
  for (const s of names) {
    z[s] = rollingRegimeZ(input.streams[s]!, input.regime, K);
  }

  // 2) Gaussian copula fit on train z (complete rows only), if G is enabled
  const trainRows: number[][] = [];
  for (let t = 0; t < trainEnd; t++) {
    const row = names.map((s) => z[s]![t]);
    if (row.every((v) => v != null)) trainRows.push(row as number[]);
  }
  if (trainRows.length < 50) throw new Error("too few complete train rows after burn-in");
  const dim = names.length;
  const corr: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
  let ridge = 0;
  let negLogCopula = (_row: number[]): number => 0;
  if (enabledSet.has("copula")) {
    for (let i = 0; i < dim; i++) {
      for (let j = i; j < dim; j++) {
        let s = 0;
        for (const row of trainRows) s += row[i]! * row[j]!;
        const v = s / trainRows.length;
        corr[i]![j] = v;
        corr[j]![i] = v;
      }
    }
    // normalize to unit diagonal (PIT z's are ~N(0,1) but finite-K shrinks tails)
    const diag = names.map((_, i) => Math.sqrt(Math.max(corr[i]![i]!, 1e-9)));
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) corr[i]![j] = corr[i]![j]! / (diag[i]! * diag[j]!);
    }
    const chol = cholesky(corr);
    ridge = chol.ridge;
    const ld = logDet(chol.L);
    /** Gaussian copula-form dependence score on robust-z residuals (high = joint surprise). */
    negLogCopula = (row: number[]): number => {
      const solved = cholSolve(chol.L, row);
      let quad = 0;
      let sq = 0;
      for (let i = 0; i < dim; i++) {
        quad += row[i]! * solved[i]!;
        sq += row[i]! * row[i]!;
      }
      return 0.5 * (quad - sq) + 0.5 * ld;
    };
  }

  // 3) AR(1) innovations per stream (φ and innovation scale from train)
  const phi: Record<string, number> = {};
  const innovSd: Record<string, number> = {};
  if (enabledSet.has("temporal")) {
    for (const s of names) {
      let sxy = 0;
      let sxx = 0;
      const innovs: number[] = [];
      for (let t = 1; t < trainEnd; t++) {
        const a = z[s]![t - 1];
        const b = z[s]![t];
        if (a == null || b == null) continue;
        sxy += a * b;
        sxx += a * a;
      }
      const f = sxx > 0 ? Math.max(-0.99, Math.min(0.99, sxy / sxx)) : 0;
      phi[s] = f;
      for (let t = 1; t < trainEnd; t++) {
        const a = z[s]![t - 1];
        const b = z[s]![t];
        if (a == null || b == null) continue;
        innovs.push(b - f * a);
      }
      const m = innovs.reduce((x, y) => x + y, 0) / Math.max(innovs.length, 1);
      innovSd[s] =
        Math.sqrt(innovs.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(innovs.length, 1)) || 1e-9;
    }
  }

  // 4) Window channel scores
  const nWindows = Math.floor(N / W);
  const extraNames = Object.keys(input.extraChannels ?? {});
  const windows: TraceCWindow[] = [];
  for (let w = 0; w < nWindows; w++) {
    const t0 = w * W;
    const t1 = t0 + W;
    const complete = names.every((s) => {
      for (let t = t0; t < t1; t++) if (z[s]![t] == null) return false;
      return true;
    });
    // Boundary windows (straddling calEnd) stay in "cal" so no pre-boundary
    // data ever appears inside a window labelled test.
    const segment: TraceCWindow["segment"] = !complete
      ? "burn_in"
      : t1 <= trainEnd
        ? "train"
        : t0 >= calEnd
          ? "test"
          : "cal";
    const streamZ: Record<string, number> = {};
    const channels: Record<string, number> = {};
    if (complete) {
      let sL = 0;
      for (const s of names) {
        let sum = 0;
        for (let t = t0; t < t1; t++) sum += z[s]![t]!;
        const zw = sum / Math.sqrt(W);
        streamZ[s] = Number(zw.toFixed(3));
        sL = Math.max(sL, Math.abs(zw));
      }
      if (enabledSet.has("local")) channels.local = sL;
      if (enabledSet.has("copula")) {
        let g = 0;
        for (let t = t0; t < t1; t++) g += negLogCopula(names.map((s) => z[s]![t]!) as number[]);
        channels.copula = g / W;
      }
      if (enabledSet.has("temporal")) {
        // Temporal = WORST single transition in the window (sharp breaks are
        // point events; a mean would dilute them across quiet periods).
        let sT = 0;
        for (const s of names) {
          for (let t = Math.max(t0, 1); t < t1; t++) {
            const a = z[s]![t - 1];
            const b = z[s]![t];
            if (a == null || b == null) continue;
            sT = Math.max(sT, Math.abs(b - phi[s]! * a) / innovSd[s]!);
          }
        }
        channels.temporal = sT;
      }
      for (const en of extraNames) {
        const v = input.extraChannels![en]![w];
        if (v != null && Number.isFinite(v)) channels[en] = v;
      }
    }
    windows.push({ w, t0, segment, channels, channelsRz: null, streamZ, S: null, p: null });
  }

  // 5) Rank-normalize each channel against a TRAILING window of strictly
  // PRIOR windows (rolling reference). A fixed calibration block is not
  // exchangeable with a drifting test period (seasonality masquerades as
  // anomaly), and ranking a window against a set containing itself biases
  // its p upward relative to fresh windows — the rolling, strictly-prior
  // reference removes both problems at once. Combined S = Fisher over the
  // channel rank-p's: rank-based, so its null distribution is approximately
  // pivotal over time, which is what makes step 6's growing reference valid.
  const chanNames = [...enabled, ...extraNames];
  const C = input.rollingRefSize ?? 240;
  const refSorted: Record<string, number[]> = {};
  const refQueue: Record<string, number[]> = {};
  for (const cn of chanNames) {
    refSorted[cn] = [];
    refQueue[cn] = [];
  }
  const binInsert = (arr: number[], v: number) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, v);
  };
  const binRemove = (arr: number[], v: number) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    if (arr[lo] === v) arr.splice(lo, 1);
  };
  const countGE = (arr: number[], v: number): number => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return arr.length - lo;
  };

  // 6) S conformalized against ALL strictly-prior S values (growing
  // reference; valid to good approximation because S is rank-based and
  // near-pivotal). p is kept EXACT — rounding a p that must be compared to
  // the conformal floor can silently deselect everything.
  const S_REF_MIN = input.sRefMin ?? 40;
  const priorS: number[] = []; // ascending
  let sRefFinal = 0;

  for (const x of windows) {
    if (x.segment === "burn_in") continue;
    // score (strictly-prior references only)
    const chansReady = chanNames.every(
      (cn) => x.channels[cn] == null || refSorted[cn]!.length >= C
    );
    const anyChan = chanNames.some(
      (cn) => x.channels[cn] != null && refSorted[cn]!.length >= C
    );
    if (chansReady && anyChan) {
      const rz: Record<string, number> = {};
      let fisher = 0;
      let maxTerm = 0;
      for (const cn of chanNames) {
        const v = x.channels[cn];
        if (v == null) continue;
        const arr = refSorted[cn]!;
        const pc = (1 + countGE(arr, v)) / (arr.length + 1);
        rz[cn] = Number((-Math.log10(pc)).toFixed(3)); // display: −log10 rank-p
        const term = -2 * Math.log(pc);
        fisher += term;
        if (term > maxTerm) maxTerm = term;
      }
      x.channelsRz = rz;
      x.S = Number((combine === "max_channel" ? maxTerm : fisher).toFixed(4));
      if (priorS.length >= S_REF_MIN) {
        x.p = (1 + countGE(priorS, x.S)) / (priorS.length + 1); // exact
        x.pFloor = 1 / (priorS.length + 1);
      }
    }
    // then admit this window into the references (keeps them strictly prior)
    for (const cn of chanNames) {
      const v = x.channels[cn];
      if (v == null) continue;
      refQueue[cn]!.push(v);
      binInsert(refSorted[cn]!, v);
      if (refQueue[cn]!.length > C) binRemove(refSorted[cn]!, refQueue[cn]!.shift()!);
    }
    if (x.S != null) {
      binInsert(priorS, x.S);
      sRefFinal = priorS.length;
    }
  }
  const testWins = windows.filter((x) => x.segment === "test" && x.p != null);
  const nCal = sRefFinal;

  // 7) Selection. BH is attempted first. If BH selects no windows (often
  // because conformal granularity makes its threshold unreachable), the
  // fallback is the RECORD rule: alert when S exceeds every
  // strictly-prior window (p at its own floor). Its null expectation is
  // Σ 1/(n_prior+1) over test windows — reported as expected_null_alerts so
  // the observed count can be judged against it. Never silent about which
  // rule ran.
  const byP = [...testWins].sort((a, b) => a.p! - b.p! || b.S! - a.S!);
  const m = byP.length;
  let fdrPass: TraceCWindow[] = [];
  let selection: "bh" | "record_rule" | "daily_budget" = "bh";
  let expectedNullAlerts = 0;
  if (selectionMode === "daily_budget") {
    selection = "daily_budget";
    const gate = input.pGate;
    if (gate != null && !(gate > 0 && gate <= 1)) {
      throw new Error("pGate must be in (0, 1]");
    }
    fdrPass = gate == null ? byP : byP.filter((x) => x.p! <= gate);
    const testDays = new Set(fdrPass.map((x) => Math.floor(x.t0 / perDay))).size;
    expectedNullAlerts = budget * testDays;
  } else {
    let cut = -1;
    for (let k = m - 1; k >= 0; k--) {
      if (byP[k]!.p! <= (q * (k + 1)) / m) {
        cut = k;
        break;
      }
    }
    fdrPass = cut >= 0 ? byP.slice(0, cut + 1) : [];
    if (!fdrPass.length) {
      fdrPass = byP.filter((x) => x.p! <= x.pFloor! + 1e-15);
      selection = "record_rule";
    }
    expectedNullAlerts =
      selection === "record_rule"
        ? testWins.reduce((acc, x) => acc + (x.pFloor ?? 0), 0)
        : q * fdrPass.length;
  }

  // Hard operator-attention budget per day (keep lowest-p per day; count drops)
  const byDay = new Map<number, TraceCWindow[]>();
  for (const x of fdrPass) {
    const day = Math.floor(x.t0 / perDay);
    const arr = byDay.get(day) ?? [];
    arr.push(x);
    byDay.set(day, arr);
  }
  let dropped = 0;
  const kept: TraceCWindow[] = [];
  for (const arr of byDay.values()) {
    arr.sort((a, b) => a.p! - b.p! || b.S! - a.S!);
    kept.push(...arr.slice(0, budget));
    dropped += Math.max(0, arr.length - budget);
  }
  kept.sort((a, b) => a.p! - b.p! || b.S! - a.S!);

  const alerts: TraceCAlert[] = kept.map((x) => {
    const rz = x.channelsRz!;
    const lead = Object.entries(rz).sort((a, b) => b[1] - a[1])[0]![0];
    const contributing = Object.entries(x.streamZ)
      .filter(([, zw]) => Math.abs(zw) >= 1.5)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([stream, zw]) => ({ stream, zw }));
    return {
      w: x.w,
      t0: x.t0,
      p: x.p!,
      S: x.S!,
      channelsRz: rz,
      lead_channel: lead,
      streamZ: x.streamZ,
      contributing_streams: contributing,
    };
  });

  return {
    windows,
    alerts,
    selection,
    fdr_pass_count: fdrPass.length,
    expected_null_alerts: Number(expectedNullAlerts.toFixed(2)),
    budget_dropped: dropped,
    n_cal: nCal,
    conformal_floor: Number((1 / (nCal + 1)).toFixed(6)),
    copula: {
      streams: names,
      corr: corr.map((r) => r.map((v) => Number(v.toFixed(3)))),
      ridge,
    },
    config: {
      windowSize: W,
      pitK: K,
      fdrQ: q,
      budgetPerDay: budget,
      rollingRefSize: C,
      sRefMin: S_REF_MIN,
      trainEnd,
      calEnd,
      n: N,
    },
  };
}
