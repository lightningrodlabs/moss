import * as childProcess from 'child_process';
import split from 'split';
import { LauncherEmitter, WRONG_PASSWORD } from './launcherEmitter';

export async function initializeLairKeystore(
  lairBinary: string,
  keystoreDir: string,
  launcherEmitter: LauncherEmitter,
  password: string
): Promise<void> {
  const lairHandle = childProcess.spawn(lairBinary, ["init", "-p"], { cwd: keystoreDir });
  lairHandle.stdin.write(password);
  lairHandle.stdin.end();
  return new Promise((resolve) => {
    let killAfterNextLine = false;
    lairHandle.stdout.pipe(split()).on("data", (line: string) => {
      launcherEmitter.emitLairLog(line);
      if (killAfterNextLine) {
        lairHandle.kill();
        resolve()
      }
      if (line.includes("# lair-keystore init config")) {
        killAfterNextLine = true;
      }
  })
  })
}

export async function launchLairKeystore(
  lairBinary: string,
  keystoreDir: string,
  launcherEmitter: LauncherEmitter,
  password: string
): Promise<[childProcess.ChildProcessWithoutNullStreams, string]> {

  const lairHandle = childProcess.spawn(lairBinary, ["server", "-p"], { cwd: keystoreDir });
  lairHandle.stdin.write(password);
  lairHandle.stdin.end();
  // Wait for connection url or internal sodium error and return error or EventEmitter
  lairHandle.stderr.pipe(split()).on("data", (line: string) => {
    launcherEmitter.emitLairError(line);
    if (line.includes("InternalSodium")) {
      launcherEmitter.emit(WRONG_PASSWORD);
    }
  });
  lairHandle.stdout.pipe(split()).on("data", (line: string) => {
    launcherEmitter.emitLairLog(line);
    if (line.includes("# lair-keystore connection_url #")) {
      const connectionUrl = line.split("#")[2].trim();
      launcherEmitter.emitLairReady(connectionUrl)
    }
  });

  return new Promise((resolve, reject) => {
    launcherEmitter.on("wrong-password", () => reject("Wrong password."));
    launcherEmitter.on("lair-ready", (url: string) => resolve([lairHandle, url]));
  });
}

