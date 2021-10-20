const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow () {
    const win = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            enableRemoteModule: true,
            preload: path.join(__dirname, 'preload.js')
        },
        frame:false,
        autoHideMenuBar: true
    })

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
    win.loadFile('index.html');
    win.webContents.openDevTools();
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