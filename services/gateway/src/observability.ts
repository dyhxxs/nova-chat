import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Accept a bounded correlation id from a trusted caller and generate one for
 * every other request. The value is deliberately restricted before it reaches
 * response headers and structured logs.
 */
export function requestIdFromHeader(value: string | string[] | undefined): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return candidate && requestIdPattern.test(candidate) ? candidate : randomUUID();
}

type RequestMetric = {
  count: number;
  durationMs: number;
};

function label(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

/** Small dependency-free Prometheus exporter for the gateway process. */
export class GatewayMetrics {
  private readonly requests = new Map<string, RequestMetric>();
  private activeRequests = 0;

  beginRequest() {
    this.activeRequests += 1;
  }

  endRequest(method: string, route: string, statusCode: number, durationMs: number) {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const key = `${method}\u0000${route}\u0000${statusCode}`;
    const current = this.requests.get(key) ?? { count: 0, durationMs: 0 };
    current.count += 1;
    current.durationMs += Math.max(0, durationMs);
    this.requests.set(key, current);
  }

  renderPrometheus(uptimeSeconds = process.uptime()): string {
    const lines = [
      '# HELP nova_gateway_http_requests_total Total HTTP requests handled by the gateway.',
      '# TYPE nova_gateway_http_requests_total counter',
    ];
    for (const [key, metric] of this.requests) {
      const [method, route, statusCode] = key.split('\u0000');
      lines.push(`nova_gateway_http_requests_total{method="${label(method ?? 'UNKNOWN')}",route="${label(route ?? '/unknown')}",status_code="${label(statusCode ?? '0')}"} ${metric.count}`);
    }
    lines.push(
      '# HELP nova_gateway_http_request_duration_ms_sum Total HTTP request duration in milliseconds.',
      '# TYPE nova_gateway_http_request_duration_ms_sum counter',
    );
    for (const [key, metric] of this.requests) {
      const [method, route, statusCode] = key.split('\u0000');
      lines.push(`nova_gateway_http_request_duration_ms_sum{method="${label(method ?? 'UNKNOWN')}",route="${label(route ?? '/unknown')}",status_code="${label(statusCode ?? '0')}"} ${metric.durationMs.toFixed(3)}`);
    }
    lines.push(
      '# HELP nova_gateway_http_active_requests Current number of HTTP requests in progress.',
      '# TYPE nova_gateway_http_active_requests gauge',
      `nova_gateway_http_active_requests ${this.activeRequests}`,
      '# HELP nova_gateway_process_uptime_seconds Gateway process uptime in seconds.',
      '# TYPE nova_gateway_process_uptime_seconds gauge',
      `nova_gateway_process_uptime_seconds ${Math.max(0, uptimeSeconds).toFixed(3)}`,
    );
    return `${lines.join('\n')}\n`;
  }
}
