export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  database: 'connected' | 'disconnected' | 'not_configured';
  timestamp: string;
}
