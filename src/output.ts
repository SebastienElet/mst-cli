export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  metadata: { timestamp: string; duration_ms: number };
}

export interface ErrorEnvelope {
  success: false;
  error: string;
  data?: unknown;
  metadata: { timestamp: string; duration_ms: number };
}

export function successEnvelope<T>(data: T, durationMs: number): SuccessEnvelope<T> {
  return {
    success: true,
    data,
    metadata: { timestamp: new Date().toISOString(), duration_ms: durationMs },
  };
}

export function errorEnvelope(error: string, durationMs: number, data?: unknown): ErrorEnvelope {
  return {
    success: false,
    error,
    ...(data !== undefined && { data }),
    metadata: { timestamp: new Date().toISOString(), duration_ms: durationMs },
  };
}
