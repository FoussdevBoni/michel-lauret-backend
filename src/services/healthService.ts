import { getDatabaseStatus } from '../lib/database';
import type { HealthResponse } from '../types/features/Health';

export function getHealth(): HealthResponse {
  const database = getDatabaseStatus();

  return {
    status: database === 'disconnected' ? 'degraded' : 'ok',
    service: 'cpeg-michel-lauret-backend',
    database,
    timestamp: new Date().toISOString(),
  };
}
