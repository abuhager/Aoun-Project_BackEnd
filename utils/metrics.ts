import type { Request, RequestHandler } from 'express';

const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1_000, 2_500, 5_000] as const;
const API_GROUPS = new Set([
  'admin',
  'auth',
  'conversations',
  'donation-requests',
  'hubs',
  'items',
  'notifications',
  'phone',
  'profile',
  'ratings',
  'reports',
  'settings',
  'users',
]);

type HttpMetric = {
  method: string;
  route: string;
  status: string;
};

const requestCounts = new Map<string, number>();
const durationCounts = new Map<string, number[]>();
const durationSums = new Map<string, number>();

const metricKey = ({ method, route, status }: HttpMetric) => (
  `${method}\u0000${route}\u0000${status}`
);

const metricFromKey = (key: string): HttpMetric => {
  const [method, route, status] = key.split('\u0000');
  return { method, route, status };
};

const labelValue = (value: string): string => value
  .replaceAll('\\', '\\\\')
  .replaceAll('\n', '\\n')
  .replaceAll('"', '\\"');

const labels = ({ method, route, status }: HttpMetric): string => (
  `{method="${labelValue(method)}",route="${labelValue(route)}",status="${labelValue(status)}"}`
);

const routeGroup = (req: Request): string => {
  const pathname = (req.originalUrl || req.path || '/').split('?')[0];
  if (pathname === '/health' || pathname.startsWith('/health/')) return '/health';
  if (pathname === '/metrics') return '/metrics';

  const match = pathname.match(/^\/api\/([^/]+)/);
  if (!match) return '/other';
  const group = API_GROUPS.has(match[1]) ? match[1] : 'other';
  return `/api/${group}`;
};

export const recordHttpMetrics: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const metric: HttpMetric = {
      method: req.method.toUpperCase(),
      route: routeGroup(req),
      status: `${Math.floor(res.statusCode / 100)}xx`,
    };
    const key = metricKey(metric);
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
    durationSums.set(key, (durationSums.get(key) ?? 0) + durationMs);

    const buckets = durationCounts.get(key) ?? DURATION_BUCKETS_MS.map(() => 0);
    DURATION_BUCKETS_MS.forEach((upperBound, index) => {
      if (durationMs <= upperBound) buckets[index] += 1;
    });
    durationCounts.set(key, buckets);
  });

  next();
};

export const renderPrometheusMetrics = (): string => {
  const output = [
    '# HELP aoun_http_requests_total Total HTTP responses.',
    '# TYPE aoun_http_requests_total counter',
  ];

  [...requestCounts.entries()].sort().forEach(([key, value]) => {
    output.push(`aoun_http_requests_total${labels(metricFromKey(key))} ${value}`);
  });

  output.push(
    '# HELP aoun_http_request_duration_ms HTTP response duration in milliseconds.',
    '# TYPE aoun_http_request_duration_ms histogram'
  );
  [...durationCounts.entries()].sort().forEach(([key, buckets]) => {
    const metric = metricFromKey(key);
    DURATION_BUCKETS_MS.forEach((upperBound, index) => {
      output.push(
        `aoun_http_request_duration_ms_bucket${labels(metric).replace('}', `,le="${upperBound}"}`)} ${buckets[index]}`
      );
    });
    const count = requestCounts.get(key) ?? 0;
    output.push(
      `aoun_http_request_duration_ms_bucket${labels(metric).replace('}', ',le="+Inf"}')} ${count}`,
      `aoun_http_request_duration_ms_sum${labels(metric)} ${durationSums.get(key) ?? 0}`,
      `aoun_http_request_duration_ms_count${labels(metric)} ${count}`
    );
  });

  output.push(
    '# HELP process_uptime_seconds Process uptime in seconds.',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${process.uptime()}`,
    '# HELP process_resident_memory_bytes Resident memory size in bytes.',
    '# TYPE process_resident_memory_bytes gauge',
    `process_resident_memory_bytes ${process.memoryUsage().rss}`,
    ''
  );
  return output.join('\n');
};

export const resetMetricsForTests = () => {
  requestCounts.clear();
  durationCounts.clear();
  durationSums.clear();
};

export default { recordHttpMetrics, renderPrometheusMetrics, resetMetricsForTests };
