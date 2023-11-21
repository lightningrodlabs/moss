import path from 'path';
import { app } from 'electron';

export const ICONS_DIRECTORY = app.isPackaged
  ? path.join(app.getAppPath(), '../app.asar.unpacked/resources/icons')
  : path.join(app.getAppPath(), './resources/icons')