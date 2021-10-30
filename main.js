const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow () {
    const loading = new BrowserWindow({show: false, frame: false});
    const win = new BrowserWindow({
        width: 600,
        height: 800,
        webPreferences: {
            enableRemoteModule: true,
            preload: path.join(__dirname, 'src/preload.js')
        },
        frame:false,
        autoHideMenuBar: true,
        show: false
    });

    win.webContents.once("dom-ready", () => {
        win.show();
        loading.hide();
        loading.close();
    });
    loading.loadURL('src/loding.html');
    //loading.show();

    win.on('page-title-updated', function(e) {
        e.preventDefault();
    });
    ipcMain.on('header-action-close', (evt, arg) => {
        app.quit();
    });
    ipcMain.on('header-action-maximize', (evt, arg) => {
        if(win.isMaximized())
            win.unmaximize();
        else
            win.maximize();
    });
    ipcMain.on('header-action-minimize', (evt, arg) => {
        win.minimize();
    });
    ipcMain.handle('select-dir', async (event, arg) => {
        return dialog.showOpenDialog({ properties: ['openDirectory'] });
    });
    win.loadFile('src/index.html');
    //win.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    })
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});