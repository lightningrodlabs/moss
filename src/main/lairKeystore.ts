import * as childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import split from 'split';
import { LAIR_ERROR, WeEmitter, WRONG_PASSWORD } from './weEmitter';
import { nanoid } from 'nanoid';
import { LairFailure, classifyLairStderr } from './lairFailure';

export async function initializeLairKeystore(
  lairBinary: string,
  keystoreDir: string,
  weEmitter: WeEmitter,
  password: string,
): Promise<void> {
  const lairHandle = childProcess.spawn(lairBinary, ['init', '-p'], { cwd: keystoreDir });
  lairHandle.stdin.write(password);
  lairHandle.stdin.end();
  return new Promise((resolve) => {
    let killAfterNextLine = false;
    lairHandle.stdout.pipe(split()).on('data', (line: string) => {
      weEmitter.emitLairLog(line);
      if (killAfterNextLine) {
        lairHandle.kill();
        resolve();
      }
      if (line.includes('# lair-keystore init config')) {
        killAfterNextLine = true;
      }
    });
  });
}

export async function launchLairKeystore(
  lairBinary: string,
  keystoreDir: string,
  weEmitter: WeEmitter,
  password: string,
  rustLog?: string,
): Promise<[childProcess.ChildProcessWithoutNullStreams, string]> {
  // On Unix systems, there is a limit to the path length of a domain socket. Create a symlink to the lair directory from the tempdir
  // instead and overwrite the connectionUrl in the lair-keystore-config.yaml
  if (os.platform() === 'linux' || os.platform() === 'darwin') {
    try {
      const uid = nanoid(13);
      const srcPath = path.join(os.tmpdir(), `lair.${uid}`);
      fs.symlinkSync(keystoreDir, srcPath);
      keystoreDir = srcPath;
      const lairConfigPath = path.join(keystoreDir, 'lair-keystore-config.yaml');
      const lairConfigString = fs.readFileSync(lairConfigPath, 'utf-8');
      const lines = lairConfigString.split('\n');
      const idx = lines.findIndex((line) => line.includes('connectionUrl:'));
      if (idx === -1) {
        weEmitter.emitMossError('Failed to find connectionUrl line in lair-keystore-config.yaml.');
        throw new Error('Failed to find connectionUrl line in lair-keystore-config.yaml.');
      }
      const connectionUrlLine = lines[idx];
      if (!connectionUrlLine) {
        weEmitter.emitMossError('No connectionUrl line found in lair-keystore-config.yaml.');
        throw new Error('No connectionUrl line found in lair-keystore-config.yaml.');
      }
      const socket = connectionUrlLine.split('socket?')[1];
      if (!socket) {
        weEmitter.emitMossError('Failed to read socket from lair-keystore-config.yaml.');
        throw new Error('Failed to read socket from lair-keystore-config.yaml.');
      }
      const tmpDirConnectionUrl = `unix://${keystoreDir}/socket?${socket}`;
      weEmitter.emitMossLog(`Temp directory lair connection URL: ${tmpDirConnectionUrl}`);
      lines[idx] = `connectionUrl: ${tmpDirConnectionUrl}`;
      const newLairConfigString = lines.join('\n');
      fs.writeFileSync(lairConfigPath, newLairConfigString);
    } catch (e) {
      weEmitter.emitMossError(`Failed to create symlinked lair directory: ${e}`);
      return Promise.reject(`Failed to create symlinked lair directory: ${e}`);
    }
  }
  const lairHandle = childProcess.spawn(lairBinary, ['server', '-p'], {
    cwd: keystoreDir,
    env: {
      RUST_LOGS: rustLog ? rustLog : 'warn',
    },
  });
  weEmitter.emitMossLog(`Spawned lair-keystore pid ${lairHandle.pid}`);
  // A spawn failure surfaces on stdin before the process 'error' event; swallow
  // it so the rejection below is the one the caller sees.
  lairHandle.stdin.on('error', () => {});
  lairHandle.stdin.write(password);
  lairHandle.stdin.end();

  // Settles exactly once, from this child's own streams and exit, so that a
  // retried launch never sees the previous attempt's outcome. Rejects with a
  // LairFailure so the caller can decide whether a retry makes sense.
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (failure: LairFailure) => {
      if (settled) return;
      settled = true;
      lairHandle.kill();
      reject(failure);
    };
    lairHandle.on('error', (err) => {
      fail({ kind: 'other', detail: `failed to spawn lair-keystore: ${err}` });
    });
    lairHandle.on('exit', (code, signal) => {
      fail({
        kind: 'exited',
        detail: `lair-keystore exited (code ${code}, signal ${signal}) before it was ready`,
      });
    });
    lairHandle.stderr.pipe(split()).on('data', (line: string) => {
      const failure = classifyLairStderr(line);
      if (failure.kind === 'wrong-password') {
        weEmitter.emit(WRONG_PASSWORD);
      } else {
        weEmitter.emit(LAIR_ERROR, line);
      }
      // split() yields a trailing empty line when the stream closes; the exit
      // listener reports that case with the exit code instead.
      if (line.length > 0) fail(failure);
    });
    lairHandle.stdout.pipe(split()).on('data', (line: string) => {
      weEmitter.emitLairLog(line);
      if (line.includes('# lair-keystore connection_url #')) {
        const connectionUrl = line.split('#')[2].trim();
        weEmitter.emitLairReady(connectionUrl);
        if (!settled) {
          settled = true;
          resolve([lairHandle, connectionUrl]);
        }
      }
    });
  });
}
