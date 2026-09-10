export interface JobExecutionContext {
  jobId: string;
  jobType: string;
  queue: string;
  correlationId?: string;
  clinicId?: string;
  attempt: number;
}

export type JobHandler = (
  payload: Record<string, unknown>,
  context: JobExecutionContext,
) => Promise<void>;

export interface JobRegistry {
  register(jobType: string, handler: JobHandler): void;
  getHandler(jobType: string): JobHandler | undefined;
  getRegisteredJobTypes(): string[];
}

export interface WorkerBootstrap {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}
