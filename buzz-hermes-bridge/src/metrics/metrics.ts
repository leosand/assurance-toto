import { Gauge, Histogram, Registry } from 'prom-client';

export interface Metrics {
  registry: Registry;
  commandsProcessed: Histogram<'result'>;
  activeApprovals: Gauge;
}

export function makeMetrics(): Metrics {
  const registry = new Registry();
  const commandsProcessed = new Histogram({
    name: 'bridge_commands_processed_seconds',
    help: 'End-to-end duration of a command',
    labelNames: ['result'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1],
    registers: [registry],
  });
  const activeApprovals = new Gauge({
    name: 'bridge_approvals_pending',
    help: 'Number of pending approvals (statut=en_attente)',
    registers: [registry],
  });
  return { registry, commandsProcessed, activeApprovals };
}
