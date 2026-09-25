export interface LogData {
  [key: string]: unknown;
}

export function logInfo(message: string, data?: LogData): void {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[INFO] [${timestamp}] ${message}`, JSON.stringify(data));
  } else {
    console.log(`[INFO] [${timestamp}] ${message}`);
  }
}

export function logError(message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  console.error(`[ERROR] [${timestamp}] ${message}`, error);
}

export function logCronExecution(jobName: string, durationMs: number, status: 'success' | 'failed', details?: LogData): void {
  const timestamp = new Date().toISOString();
  console.log(`[CRON] [${timestamp}] Job "${jobName}" completed in ${durationMs}ms with status: ${status}`, details ? JSON.stringify(details) : '');
}
