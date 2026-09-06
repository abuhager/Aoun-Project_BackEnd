import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

// Read-only, bounded smoke load. This does not determine a maximum user count.
const SCENARIOS = {
  items: { path: '/api/items?page=1&limit=12', field: 'items' },
  requests: { path: '/api/donation-requests?page=1&limit=10', field: 'requests' },
  health: { path: '/health/live', field: 'status' },
} as const;
type Scenario = keyof typeof SCENARIOS;

export type LoadConfig = {
  origin: string;
  scenario: Scenario;
  stages: number[];
  rounds: number;
  pauseMs: number;
  timeoutMs: number;
  maxP95Ms: number;
};

type Sample = {
  status: number;
  durationMs: number;
  valid: boolean;
  retryAfter: string | null;
};

const integerOption = (value: string | undefined, fallback: number, max: number): number => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new Error(`خيارات القياس العددية يجب أن تكون أعدادًا صحيحة بين 1 و${max}`);
  }
  return Number(value);
};

export function readLoadConfig(env: NodeJS.ProcessEnv = process.env): LoadConfig {
  let url: URL;
  try { url = new URL(env.LOAD_TEST_BASE_URL ?? 'http://127.0.0.1:5000'); }
  catch { throw new Error('LOAD_TEST_BASE_URL يجب أن يكون Origin صالحًا دون بيانات اعتماد'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('LOAD_TEST_BASE_URL يجب أن يحتوي Origin فقط، دون مسار أو أسرار');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || (!local && url.protocol !== 'https:')) {
    throw new Error('الخادم الخارجي يجب أن يستخدم HTTPS');
  }
  if (!local && env.LOAD_TEST_CONFIRM_ORIGIN !== url.origin) {
    throw new Error('لتأكيد فحص خادم تملكه، اجعل LOAD_TEST_CONFIRM_ORIGIN مساويًا للـOrigin المقصود');
  }
  const scenario = env.LOAD_TEST_SCENARIO ?? 'items';
  if (!Object.hasOwn(SCENARIOS, scenario)) throw new Error('LOAD_TEST_SCENARIO: items أو requests أو health فقط');
  const stages = (env.LOAD_TEST_STAGES ?? '1,5,10,20')
    .split(',').map((value) => integerOption(value.trim(), 1, 30));
  if (!stages.length || stages.some((value, index) => index > 0 && value <= stages[index - 1])) {
    throw new Error('مراحل التزامن يجب أن تكون متزايدة، وبحد أقصى 30');
  }
  const rounds = integerOption(env.LOAD_TEST_ROUNDS, 2, 5);
  if (1 + stages.reduce((sum, value) => sum + value, 0) * rounds > 100) {
    throw new Error('الحد الأقصى لهذا الفحص القصير هو 100 طلب بما فيها تهيئة الاتصال');
  }
  return {
    origin: url.origin,
    scenario: scenario as Scenario,
    stages,
    rounds,
    pauseMs: integerOption(env.LOAD_TEST_PAUSE_MS, 500, 5_000),
    timeoutMs: integerOption(env.LOAD_TEST_TIMEOUT_MS, 10_000, 30_000),
    maxP95Ms: integerOption(env.LOAD_TEST_MAX_P95_MS, 2_000, 10_000),
  };
}

export function summarizeSamples(samples: Sample[], elapsedMs: number) {
  const times = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const percentile = (fraction: number) => times[Math.ceil(times.length * fraction) - 1] ?? 0;
  const successful = samples.filter((sample) => sample.status === 200 && sample.valid).length;
  return {
    completed: samples.length,
    successful,
    failed: samples.length - successful,
    retryAfter: samples.find((sample) => sample.status === 429)?.retryAfter ?? null,
    statusCounts: samples.reduce<Record<string, number>>((counts, sample) => {
      const key = String(sample.status);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    p50Ms: Math.round(percentile(0.5)),
    p95Ms: Math.round(percentile(0.95)),
    maxMs: Math.round(times.at(-1) ?? 0),
    // Includes think time/round pacing, and must not be called maximum throughput.
    observedRequestsPerSecond: Number((successful / (Math.max(1, elapsedMs) / 1000)).toFixed(2)),
  };
}

export async function runLoadSmoke(
  config: LoadConfig,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const scenario = SCENARIOS[config.scenario];
  const samplesByStage: Array<ReturnType<typeof summarizeSamples> & { concurrency: number }> = [];
  let stopReason: string | null = null;

  const sample = async (): Promise<Sample> => {
    const started = performance.now();
    const controller = new AbortController();
    const abort = () => controller.abort();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timer = setTimeout(abort, config.timeoutMs);
    let status = 0;
    let valid = false;
    let retryAfter: string | null = null;
    try {
      const response = await fetcher(`${config.origin}${scenario.path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: requestSignal,
      });
      status = response.status;
      retryAfter = response.headers.get('retry-after');
      if (status === 200) {
        const payload: unknown = await response.json();
        if (payload && typeof payload === 'object') {
          const value = (payload as Record<string, unknown>)[scenario.field];
          valid = config.scenario === 'health' ? value === 'ok' : Array.isArray(value);
        }
      } else {
        await response.body?.cancel();
      }
    } catch {
      // Do not log URLs with credentials, response bodies, or tokens.
    } finally {
      clearTimeout(timer);
    }
    return { status, durationMs: performance.now() - started, valid, retryAfter };
  };

  const reasonFor = (rows: Sample[]) => {
    if (signal?.aborted) return 'interrupted';
    if (rows.some((row) => row.status === 429)) return 'rate_limited';
    if (rows.some((row) => row.status !== 200 || !row.valid)) return 'request_failed';
    if (summarizeSamples(rows, 1).p95Ms > config.maxP95Ms) return 'latency_threshold';
    return null;
  };

  // Kept separately: a cold connection is not included in warm-stage percentiles.
  const warmup = await sample();
  if (warmup.status !== 200 || !warmup.valid || signal?.aborted) stopReason = reasonFor([warmup]);
  if (!stopReason) {
    for (const concurrency of config.stages) {
      const rows: Sample[] = [];
      const started = performance.now();
      for (let round = 0; round < config.rounds; round += 1) {
        if (signal?.aborted) { stopReason = 'interrupted'; break; }
        const batch = await Promise.all(Array.from({ length: concurrency }, sample));
        rows.push(...batch);
        stopReason = reasonFor(batch);
        if (stopReason) break;
        if (round + 1 < config.rounds) await new Promise((resolve) => setTimeout(resolve, config.pauseMs));
      }
      samplesByStage.push({ concurrency, ...summarizeSamples(rows, performance.now() - started) });
      if (stopReason) break;
    }
  }
  return {
    measuredAt: new Date().toISOString(),
    origin: config.origin,
    scenario: config.scenario,
    methodology: 'GET-only short bursts; one outstanding request per worker; no login, Socket, writes or capacity claim',
    config,
    warmup,
    stages: samplesByStage,
    stopReason,
    maximumUsers: null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  try {
    const report = await runLoadSmoke(readLoadConfig(), fetch, controller.signal);
    console.log(JSON.stringify(report, null, 2));
    if (report.stopReason) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'تعذر تجهيز الفحص');
    process.exitCode = 1;
  }
}
