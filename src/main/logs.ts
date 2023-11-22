import winston, { createLogger, transports, format } from 'winston';
import path from 'path';
import { LauncherFileSystem } from './filesystem';
import {
  HOLOCHAIN_ERROR,
  HOLOCHAIN_LOG,
  HolochainData,
  HolochainVersion,
  LAIR_ERROR,
  LAIR_LOG,
  LauncherEmitter,
  WASM_LOG,
} from './launcherEmitter';

const { combine, timestamp } = format;

const HOLOCHAIN_LOGGERS: Record<HolochainVersion, winston.Logger> = {};

export function setupLogs(
  launcherEmitter: LauncherEmitter,
  launcherFileSystem: LauncherFileSystem,
) {
  const logFilePath = path.join(launcherFileSystem.appLogsDir, 'launcher.log');
  const lairLogger = createLairLogger(logFilePath);

  launcherEmitter.on(LAIR_LOG, (log) => {
    const logLine = `[LAIR] ${log}`;
    console.log(logLine);
    lairLogger.log('info', logLine);
  });
  launcherEmitter.on(LAIR_ERROR, (log) => {
    const logLine = `[LAIR] ERROR: ${log}`;
    console.log(logLine);
    lairLogger.log('info', logLine);
  });
  launcherEmitter.on(HOLOCHAIN_LOG, (holochainData) => {
    logHolochain(holochainData as HolochainData, logFilePath);
  });
  launcherEmitter.on(HOLOCHAIN_ERROR, (holochainData) => {
    logHolochain(holochainData as HolochainData, logFilePath);
  });
  launcherEmitter.on(WASM_LOG, (holochainData) => {
    logHolochain(holochainData as HolochainData, logFilePath);
  });
}

function logHolochain(holochainData: HolochainData, logFilePath: string) {
  const holochainVersion = (holochainData as HolochainData).version;
  const line = (holochainData as HolochainData).data;
  const logLine = `[HOLOCHAIN ${holochainVersion}]: ${line}`;
  console.log(logLine);
  let logger = HOLOCHAIN_LOGGERS[holochainVersion];
  if (logger) {
    logger.log('info', line);
  } else {
    logger = createHolochainLogger(holochainVersion, logFilePath);
    HOLOCHAIN_LOGGERS[holochainVersion] = logger;
    logger.log('info', line);
  }
}

function createHolochainLogger(
  holochainVersion: HolochainVersion,
  logFilePath: string,
): winston.Logger {
  return createLogger({
    transports: [new transports.File({ filename: logFilePath })],
    format: combine(
      timestamp(),
      format.printf(({ level, message, timestamp }) => {
        return JSON.stringify({
          timestamp,
          label: `HOLOCHAIN ${holochainVersion}`,
          level,
          message,
        });
      }),
    ),
  });
}

function createLairLogger(logFilePath: string): winston.Logger {
  return createLogger({
    transports: [new transports.File({ filename: logFilePath })],
    format: combine(
      timestamp(),
      format.printf(({ level, message, timestamp }) => {
        return JSON.stringify({
          timestamp,
          label: 'LAIR',
          level,
          message,
        });
      }),
    ),
  });
}
