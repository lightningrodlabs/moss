import winston, { createLogger, transports, format } from 'winston';
import path from 'path';
import fs from 'fs';
import { MossFileSystem } from './filesystem';
import {
  HOLOCHAIN_ERROR,
  HOLOCHAIN_LOG,
  HolochainData,
  HolochainVersion,
  LAIR_ERROR,
  LAIR_LOG,
  WeEmitter,
  WASM_LOG,
  MOSS_ERROR,
} from './weEmitter';

const { combine, timestamp } = format;

const HOLOCHAIN_LOGGERS: Record<HolochainVersion, winston.Logger> = {};

// TODO define class LauncherLogger that can log all lair, holochain and launcher-specific stuff
// with methods logLair, logHolochain, logLauncher, logHapp, ...

export function setupLogs(
  weEmitter: WeEmitter,
  mossFileSystem: MossFileSystem,
  holochainLogsToTerminal: boolean,
) {
  const logFilePath = path.join(mossFileSystem.appLogsDir, 'we.log');
  if (fs.existsSync(logFilePath)) {
    const stats = fs.statSync(logFilePath);
    // If existing logfile is larger than 1GB, delete it
    if (stats.size > 1e9) {
      console.log("Found a log file that's larger than 1GB. Deleting it.");
      fs.rmSync(logFilePath);
    }
  }

  // Use log file rotation with max size of a single file of 50MB and max 5 total files
  const logFileTransport = new transports.File({
    filename: logFilePath,
    maxsize: 50_000_000,
    maxFiles: 5,
  });

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
  weEmitter.on(MOSS_ERROR, (log) => {
    const logLine = `[MOSS] ${log}`;
    console.log(logLine);
    lairLogger.log('info', logLine);
  });
  weEmitter.on(HOLOCHAIN_LOG, (holochainData) => {
    logHolochain(holochainData as HolochainData, logFileTransport, holochainLogsToTerminal);
  });
  weEmitter.on(HOLOCHAIN_ERROR, (holochainData) => {
    logHolochain(holochainData as HolochainData, logFileTransport, holochainLogsToTerminal);
  });
  weEmitter.on(WASM_LOG, (holochainData) => {
    logHolochain(holochainData as HolochainData, logFileTransport, holochainLogsToTerminal);
  });
}

function logHolochain(
  holochainData: HolochainData,
  logFileTransport: winston.transports.FileTransportInstance,
  printToTerminal: boolean,
) {
  const holochainVersion = (holochainData as HolochainData).version;
  const line = (holochainData as HolochainData).data;
  if (printToTerminal) {
    const logLine = `[HOLOCHAIN ${holochainVersion}]: ${line}`;
    console.log(logLine);
  }
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
