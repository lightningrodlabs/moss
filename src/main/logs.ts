import winston, { createLogger, transports, format } from 'winston';
import path from 'path';
import fs from 'fs';
import { WeFileSystem } from './filesystem';
import {
  HOLOCHAIN_ERROR,
  HOLOCHAIN_LOG,
  HolochainData,
  HolochainVersion,
  LAIR_ERROR,
  LAIR_LOG,
  WeEmitter,
  WASM_LOG,
} from './weEmitter';

const { combine, timestamp } = format;

const HOLOCHAIN_LOGGERS: Record<HolochainVersion, winston.Logger> = {};

// TODO define class LauncherLogger that can log all lair, holochain and launcher-specific stuff
// with methods logLair, logHolochain, logLauncher, logHapp, ...

export function setupLogs(weEmitter: WeEmitter, launcherFileSystem: WeFileSystem) {
  // Old log file created too much output so it should be deleted to free up disk space
  const oldLogFilePath = path.join(launcherFileSystem.appLogsDir, 'we.log');
  if (fs.existsSync(oldLogFilePath)) {
    fs.rmSync(oldLogFilePath);
  }
  const logFilePath = path.join(launcherFileSystem.appLogsDir, 'We.log');
  // with file rotation set maxsize. But then we require logic to garbage collect old files...
  // const logFileTransport = new transports.File({ filename: logFilePath, maxsize: 50_000_000, maxfiles: 5 });
  const logFileTransport = new transports.File({ filename: logFilePath });
  const lairLogger = createLairLogger(logFileTransport);

  weEmitter.on(LAIR_LOG, (log) => {
    const logLine = `[LAIR] ${log}`;
    console.log(logLine);
    lairLogger.log('info', logLine);
  });
  weEmitter.on(LAIR_ERROR, (log) => {
    const logLine = `[LAIR] ERROR: ${log}`;
    console.log(logLine);
    lairLogger.log('info', logLine);
  });
  weEmitter.on(HOLOCHAIN_LOG, (holochainData) => {
    logHolochain(holochainData as HolochainData, logFileTransport);
  });
  weEmitter.on(HOLOCHAIN_ERROR, (holochainData) => {
    logHolochain(holochainData as HolochainData, logFileTransport);
  });
  weEmitter.on(WASM_LOG, (holochainData) => {
    logHolochain(holochainData as HolochainData, logFileTransport);
  });
}

function logHolochain(
  holochainData: HolochainData,
  logFileTransport: winston.transports.FileTransportInstance,
) {
  const holochainVersion = (holochainData as HolochainData).version;
  const line = (holochainData as HolochainData).data;
  // const logLine = `[HOLOCHAIN ${holochainVersion}]: ${line}`;
  // console.log(logLine);
  let logger = HOLOCHAIN_LOGGERS[holochainVersion];
  if (logger) {
    logger.log('info', line);
  } else {
    logger = createHolochainLogger(holochainVersion, logFileTransport);
    HOLOCHAIN_LOGGERS[holochainVersion] = logger;
    logger.log('info', line);
  }
}

function createHolochainLogger(
  holochainVersion: HolochainVersion,
  logFileTransport: winston.transports.FileTransportInstance,
): winston.Logger {
  return createLogger({
    transports: [logFileTransport],
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

function createLairLogger(
  logFileTransport: winston.transports.FileTransportInstance,
): winston.Logger {
  return createLogger({
    transports: [logFileTransport],
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
