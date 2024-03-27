import winston, { createLogger, transports, format } from 'winston';
import path from 'path';
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

export function setupLogs(
  weEmitter: WeEmitter,
  launcherFileSystem: WeFileSystem,
  holochainLogsToTerminal: boolean,
) {
  const logFilePath = path.join(launcherFileSystem.appLogsDir, 'we.log');
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
