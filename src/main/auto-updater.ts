import { autoUpdater } from 'electron-updater';
import { dialog, app } from 'electron';
import { updateReducer, type UpdateState, type UpdateAction } from './update-reducer.js';

export class AutoUpdaterManager {
  private state: UpdateState = { phase: 'idle' };

  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => {
      this.dispatch({ type: 'CHECK_STARTED' });
    });

    autoUpdater.on('update-available', (info) => {
      this.dispatch({
        type: 'UPDATE_AVAILABLE',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
      });
      void this.promptDownload(info.version);
    });

    autoUpdater.on('update-not-available', () => {
      this.dispatch({ type: 'UP_TO_DATE' });
    });

    autoUpdater.on('download-progress', (p) => {
      this.dispatch({
        type: 'DOWNLOAD_PROGRESS',
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.dispatch({ type: 'DOWNLOAD_COMPLETE', version: info.version });
      void this.promptInstall(info.version);
    });

    autoUpdater.on('error', (err) => {
      this.dispatch({ type: 'ERROR', message: err.message });
    });
  }

  checkForUpdates(): void {
    if (!app.isPackaged) return;
    void autoUpdater.checkForUpdates();
  }

  getState(): UpdateState {
    return this.state;
  }

  private dispatch(action: UpdateAction): void {
    this.state = updateReducer(this.state, action);
  }

  private async promptDownload(version: string): Promise<void> {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Mimir ${version} is available`,
      detail: 'Would you like to download it in the background?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      void autoUpdater.downloadUpdate();
    } else {
      this.dispatch({ type: 'DISMISS' });
    }
  }

  private async promptInstall(version: string): Promise<void> {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Mimir ${version} is ready to install`,
      detail: 'Restart Mimir now to apply the update?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      this.dispatch({ type: 'INSTALL_NOW' });
      autoUpdater.quitAndInstall();
    } else {
      this.dispatch({ type: 'DISMISS' });
    }
  }
}
