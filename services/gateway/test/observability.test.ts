import { describe, expect, it } from 'vitest';
import { GatewayMetrics, requestIdFromHeader } from '../src/observability.js';

describe('gateway observability', () => {
  it('accepts safe correlation ids and replaces unsafe values', () => {
    expect(requestIdFromHeader('trace-123')).toBe('trace-123');
    expect(requestIdFromHeader(['trace-123'])).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFromHeader('bad\nheader')).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFromHeader('x'.repeat(129))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exports request counters without unbounded URL labels', () => {
    const metrics = new GatewayMetrics();
    metrics.beginRequest();
    metrics.endRequest('GET', '/v1/auth/me', 200, 12.5);
    expect(metrics.renderPrometheus(42)).toContain('route="/v1/auth/me"');
    expect(metrics.renderPrometheus(42)).toContain('status_code="200"} 1');
    expect(metrics.renderPrometheus(42)).toContain('nova_gateway_http_active_requests 0');
    expect(metrics.renderPrometheus(42)).toContain('nova_gateway_process_uptime_seconds 42.000');
  });
});
