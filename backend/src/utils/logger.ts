import pino from 'pino';

/**
 * Structured logger using Pino
 * Provides production-ready logging with JSON output
 */
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Redact sensitive fields
  redact: {
    paths: ['password', 'passwordHash', 'token', 'auth_token', 'JWT_SECRET', 'IMPORT_SECRET', 'AIRLABS_API_KEY', 'OPENSKY_CLIENT_SECRET'],
    remove: true,
  },
});

export default logger;

/**
 * Log HTTP request/response
 */
export function logRequest(req: any, res: any, duration: number) {
  logger.info({
    type: 'http',
    method: req.method,
    url: req.url,
    status: res.statusCode,
    duration: `${duration}ms`,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
}

/**
 * Log database query
 */
export function logQuery(query: string, duration: number) {
  logger.debug({
    type: 'database',
    query,
    duration: `${duration}ms`,
  });
}

/**
 * Log external API call
 */
export function logApiCall(service: string, endpoint: string, duration: number, success: boolean) {
  logger.info({
    type: 'api_call',
    service,
    endpoint,
    duration: `${duration}ms`,
    success,
  });
}

/**
 * Log achievement unlock
 */
export function logAchievement(userId: string, achievementId: string, achievementName: string) {
  logger.info({
    type: 'achievement',
    userId,
    achievementId,
    achievementName,
  });
}

/**
 * Log security event
 */
export function logSecurityEvent(type: 'rate_limit' | 'auth_failure' | 'invalid_token', ip: string, details?: any) {
  logger.warn({
    type: 'security',
    event: type,
    ip,
    ...details,
  });
}
