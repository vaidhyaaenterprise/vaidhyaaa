import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

@Injectable()
export class AppLogger implements NestLoggerService {
  private readonly minLevel: LogLevel;

  constructor(private readonly env: ApiEnv) {
    this.minLevel = env.LOG_LEVEL;
  }

  log(message: string, context?: string): void {
    this.write('info', message, context);
  }

  error(message: string, trace?: string, context?: string): void {
    this.write('error', trace ? `${message} ${trace}` : message, context);
  }

  warn(message: string, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: string, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: string, context?: string): void {
    this.write('debug', message, context);
  }

  child(context: string): AppLogger {
    const child = Object.create(this) as AppLogger;
    child.write = (level: LogLevel, message: string, childContext?: string) => {
      this.write(level, message, childContext ?? context);
    };
    return child;
  }

  private write(level: LogLevel, message: string, context?: string): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }

    const payload = {
      level,
      message,
      context: context ?? 'App',
      timestamp: new Date().toISOString(),
    };

    const line = JSON.stringify(payload);
    if (level === 'error') {
      console.error(line);
      return;
    }
    if (level === 'warn') {
      console.warn(line);
      return;
    }
    console.log(line);
  }
}
