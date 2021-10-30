const { ipcRenderer, crashReporter } = require('electron');
const storage = require('node-persist');
const fs = require("fs");
const os = require("os");
const path = require('path');
const archiver = require('archiver');
const exec = require('child_process').exec;
const SFTP = require('ssh2-sftp-client');
const progress = require('progress-stream');
const fastFolderSize = require('fast-folder-size');

window.addEventListener('DOMContentLoaded', async () => {
    await storage.init();
    let conn = new SFTP();

    var gotoUploadBtn = document.getElementById("gotoUploadBtn");
    var gotoConfigBtn = document.getElementById("gotoConfigBtn");
    var contentDiv = document.getElementById("contentDiv");

    gotoUploadBtn.addEventListener("click", () => {
        fetch("upload.html").then(content => content.text()).then(async (content) => {
            contentDiv.innerHTML = content;

            //Botones de la cabecera
            var headerCloseBtn = document.getElementById("headerCloseBtn");
            var headerMaximiceBtn = document.getElementById("headerMaximiceBtn");
            var headerMinimiceBtn = document.getElementById("headerMinimiceBtn");
            headerCloseBtn.addEventListener("click", () => ipcRenderer.send('header-action-close'));
            headerMaximiceBtn.addEventListener("click", () => ipcRenderer.send('header-action-maximize'));
            headerMinimiceBtn.addEventListener("click", () => ipcRenderer.send('header-action-minimize'));

            //Datos de conexion SFTP
            var confSftpHost = document.getElementById("confSftpHost");
            var confSftpPort = document.getElementById("confSftpPort");
            var confSftpUser = document.getElementById("confSftpUser");
            var confSftpPass = document.getElementById("confSftpPass");
            var confSftpDir = document.getElementById("confSftpDir");

            //Modal BD
            var modalBDname = document.getElementById("modalBDname");
            var modalBDfile = document.getElementById("modalBDfile");
            var modalBDuser = document.getElementById("modalBDuser");
            var modalBDpass = document.getElementById("modalBDpass");
            var modalBDbtn = document.getElementById("modalBDbtn");
            modalBDbtn.addEventListener("click", () => {
                if (modalBDfile.files.length > 0)
                    addNewElement({
                        type: "db",
                        name: modalBDname.value,
                        data: {
                            bin: modalBDfile.files[0].path,
                            user: modalBDuser.value,
                            pass: modalBDpass.value
                        }
                    });
            });

            //Modal Folder
            var modalFolderName = document.getElementById("modalFolderName");
            var modalFolderFolderBtn = document.getElementById("modalFolderFolderBtn");
            var modalFolderFolder = document.getElementById("modalFolderFolder");
            var modalFolderBtn = document.getElementById("modalFolderBtn");
            modalFolderFolderBtn.addEventListener("click", async () => {
                const result = await ipcRenderer.invoke('select-dir');
                if (!result.canceled) {
                    modalFolderFolder.value = result.filePaths[0];
                }
            });
            modalFolderBtn.addEventListener("click", () => {
                addNewElement({
                    type: "dir",
                    name: modalFolderName.value,
                    data: modalFolderFolder.value
                });
            });

            //Modal File
            var modalFileName = document.getElementById("modalFileName");
            var modalFileFile = document.getElementById("modalFileFile");
            var modalFileBtn = document.getElementById("modalFileBtn");
            modalFileBtn.addEventListener("click", () => {
                if (modalFileFile.files.length > 0)
                    addNewElement({
                        type: "file",
                        name: modalFileName.value,
                        data: modalFileFile.files[0].path
                    });
            });

            //Dibujado de los elementos
            var elementsDiv = document.getElementById("elementsDiv");
            function drawElement(element) {
                let mainDiv = newElement("li", "list-group-item d-flex flex-column justify-content-center align-items-stretch p-1");

                let mainLine = newElement("div", "d-flex flex-row justify-content-between align-items-center");
                mainLine.append(newElement("span", "unselectable", element.name));
                let deleteBtn = newElement("button", "btn btn-sm btn-outline-danger");
                deleteBtn.append(newElement("i", "fas fa-times"));
                deleteBtn.addEventListener("click", () => {
                    elements.splice(elements.indexOf(element), 1);
                    elementsDiv.removeChild(mainDiv);
                    saveElements();
                });
                mainLine.append(deleteBtn);

                mainDiv.append(mainLine);
                elementsDiv.append(mainDiv);
            }
            function addNewElement(element) {
                console.log(elements);
                drawElement(element);
                elements.push(element);
                saveElements();
            }
            function saveElements() {
                storage.set("elements", JSON.stringify(elements));
            }

            //Carga y dibujado de los elementos
            var elements = await storage.get("elements");
            if (elements == null) {
                elements = [];
                saveElements();
            } else elements = JSON.parse(elements);
            elements.forEach(drawElement);

            //Cargar los datos de SFTP
            sftpConf = await storage.get("sftp");
            if (sftpConf != null) {
                confSftpHost.value = sftpConf.host;
                confSftpPort.value = sftpConf.port;
                confSftpUser.value = sftpConf.user;
                confSftpPass.value = sftpConf.pass;
                confSftpDir.value = sftpConf.dir;
            }

            //Boton subir
            var backupBtn = document.getElementById("backupBtn");
            function stopLoading() {
                disableAllBtn(false);
                backupBtn.removeChild(backupBtn.firstChild);
            }
            backupBtn.addEventListener("click", () => {
                disableAllBtn(true);
                backupBtn.insertBefore(newElement("i", "fas fa-sync-alt fa-spin me-2"), backupBtn.firstChild);

                fs.mkdtemp(path.join(os.tmpdir(), 'backuppro-'), (error, tmpDir) => {
                    if (error) {
                        showMSG("Error inesperado", "No se ha podido obtener una carpeta temporal", error);
                        return;
                    }
                    console.log(tmpDir);

                    //Probar la conexion y crear la carpeta o vaciarla
                    let remoteDir = confSftpDir.value;
                    if (!remoteDir.endsWith("/")) remoteDir += "/";
                    remoteDir += (new Date()).toISOString().substring(0, 10);
                    conn.connect({
                        host: confSftpHost.value,
                        port: confSftpPort.value,
                        username: confSftpUser.value,
                        password: confSftpPass.value
                    }).then(() => {
                        return conn.exists(remoteDir);
                    }).then(data => {
                        if (data) return conn.rmdir(remoteDir, true);
                    }).then(data => {
                        return conn.mkdir(remoteDir, true);
                    }).then(data => {
                        //Comprimir cada elemento
                        elements.forEach((element, i) => {
                            //Mostrar un progreso, en principio indefinido
                            let progressLine = newElement("div", "d-flex flex-row justify-content-between align-items-center");
                            let progressIcon = newElement("i", "fas fa-file-archive fs-3 me-2");
                            let progressBar = newElement("progress", "w-100");
                            progressBar.max = 100;
                            progressBar.min = 0;
                            progressLine.append(progressIcon);
                            progressLine.append(progressBar);
                            elementsDiv.children.item(i).append(progressLine);

                            let zipFile = path.join(tmpDir, element.name.replace(" ", "_") + ".zip");
                            let output = fs.createWriteStream(zipFile);
                            let archive = archiver('zip', { store: true });
                            archive.pipe(output);

                            output.on('close', function () {
                                //Subir el fichero comprimido
                                if (updateInterval != null) clearInterval(updateInterval);
                                progressIcon.classList.remove("fa-file-archive");
                                progressIcon.classList.add("fa-upload");
                                progressBar.value = 0;

                                const progressStream = progress({ length: archive.pointer(), time: 100 });
                                progressStream.on('progress', (progress) => {
                                    progressBar.value = progress.percentage;
                                });
                                const outStream = fs.createReadStream(zipFile);
                                outStream.pipe(progressStream);

                                conn.put(progressStream, remoteDir + "/" + path.basename(zipFile))
                                    .then(res => {
                                        //Borrar la barra de progreso y el archivo comprimido
                                        fs.unlinkSync(zipFile);
                                        progressLine.parentElement.removeChild(progressLine);
                                        //Si no hay más procesos pendientes, se ha terminado la copia
                                        if (document.querySelectorAll("progress").length == 0) {
                                            stopLoading();
                                            fs.rmdirSync(tmpDir);
                                            conn.end();
                                        }
                                    })
                                    .catch(error => {
                                        showMSG("Error al subir fichero", "No se ha podido subir el fichero. Revisa los permisos, quotas y espacio disponible.");
                                        stopLoading();
                                        console.log("Error al conectar subir fichero", error);
                                    });
                            });

                            let updateInterval = null;
                            switch (element.type) {
                                case "db":
                                    let command = `${element.data.bin} -u ${element.data.user} ${element.data.pass == "" ? "" : `-p${element.data.pass}`} --all-databases`;
                                    let dump = exec(command, { maxBuffer: 1024 * 1024 * 400 });
                                    archive.append(dump.stdout, { name: element.name + ".sql" });
                                    break;
                                case "dir":
                                    fastFolderSize(element.data, (error, bytes) => {
                                        if (error) throw error;
                                        updateInterval = setInterval(() => {
                                            let percent = (archive.pointer() / bytes) * 100;
                                            progressBar.value = percent;
                                        }, 100);
                                    });
                                    archive.directory(element.data, false);
                                    break;
                                case "file":
                                    let fileSize = fs.statSync(element.data).size;
                                    updateInterval = setInterval(() => {
                                        let percent = (archive.pointer() / fileSize) * 100;
                                        progressBar.value = percent;
                                    }, 100);
                                    archive.file(element.data, { name: path.basename(element.data) });
                                    break;
                            }

                            archive.finalize();
                        });
                    }).catch(error => {
                        showMSG("Error al conectar con SFTP", "No se ha podido conectar con el servidor SFTP. Revisa las credenciales y los permisos.");
                        stopLoading();
                        console.log("Error al conectar con SFTP", error);
                        conn.end();
                    });
                });

                //Guardar los datos de conexion
                storage.set("sftp", {
                    host: confSftpHost.value,
                    port: confSftpPort.value,
                    user: confSftpUser.value,
                    pass: confSftpPass.value,
                    dir: confSftpDir.value
                });

            });
        });
        gotoUploadBtn.firstChild.classList.add("selected");
        gotoConfigBtn.firstChild.classList.remove("selected");
    });

    gotoConfigBtn.addEventListener("click", () => {
        fetch("config.html").then(content => content.text()).then(async (content) => {
            contentDiv.innerHTML = content;

            //Cargar los datos de SFTP
            var confSftp = await storage.get("sftp");

            //Cargar los datos de limpiado
            var confClearMonth = document.getElementById("confClearMonth");
            var confClearYear = document.getElementById("confClearYear");
            var confClearNothing = document.getElementById("confClearNothing");
            var conf = await storage.get("clearConf");
            if (conf != null) {
                confClearMonth.checked = conf.clearMonth;
                confClearYear.checked = conf.clearYear;
                confClearNothing.checked = !(conf.clearMonth || conf.clearYear);
            }
            var saveConf = async () => {
                storage.set("clearConf", {
                    clearMonth: confClearMonth.checked,
                    clearYear: confClearYear.checked
                });
            };
            confClearMonth.addEventListener("change", saveConf);
            confClearYear.addEventListener("change", saveConf);
            confClearNothing.addEventListener("change", saveConf);

            //Botones de accion
            var elementsDiv = document.getElementById("elementsDiv");
            var actualizarBtn = document.getElementById("actualizarBtn");
            var limpiarBtn = document.getElementById("limpiarBtn");
            actualizarBtn.addEventListener("click", actualizar);
            limpiarBtn.addEventListener("click", limpiar);

            function stopLoadingActualizar() {
                disableAllBtn(false);
                actualizarBtn.removeChild(actualizarBtn.firstChild);
            }
            function stopLoadingLimpiar() {
                disableAllBtn(false);
                limpiarBtn.removeChild(limpiarBtn.firstChild);
            }
            function actualizar() {
                if(confSftp == null) return;
                disableAllBtn(true);
                actualizarBtn.insertBefore(newElement("i", "fas fa-sync-alt fa-spin me-2"), actualizarBtn.firstChild);

                conn.connect({
                    host: confSftp.host,
                    port: confSftp.port,
                    username: confSftp.user,
                    password: confSftp.pass
                }).then(() => conn.list(sftpConf.dir)).then(dirs => {
                    while (elementsDiv.firstChild) elementsDiv.removeChild(elementsDiv.lastChild);
                    var nDirs = dirs.length;
                    if (nDirs == 0) {
                        stopLoadingActualizar();
                        conn.end();
                    }
                    dirs.forEach(dir => {
                        let folder = sftpConf.dir + "/" + dir.name;
                        conn.list(folder).then(files => {
                            let size = 0;
                            files.forEach(file => size += file.size);

                            let item = newElement("li", "list-group-item d-flex flex-column align-items-stretch justify-content-stretch");
                            elementsDiv.append(item);
                            let container = newElement("div", "d-flex flex-row justify-content-between align-items-center");
                            item.append(container);
                            let safeSection = newElement("div", "d-flex flex-row");
                            container.append(safeSection);
                            let downloadBtn = newElement("button", "btn btn-sm btn-outline-secondary me-3");
                            downloadBtn.append(newElement("i", "fas fa-file-download"));
                            safeSection.append(downloadBtn);
                            let nombre = newElement("span", null, dir.name);
                            nombre.append(newElement("b", "ms-2", hBytes(size)));
                            safeSection.append(nombre);
                            let deleteBtn = newElement("button", "btn btn-sm btn-outline-danger");
                            deleteBtn.append(newElement("i", "fas fa-times"));
                            container.append(deleteBtn);

                            deleteBtn.addEventListener("click", () => {
                                disableAllBtn(true);
                                conn.connect({
                                    host: confSftp.host,
                                    port: confSftp.port,
                                    username: confSftp.user,
                                    password: confSftp.pass
                                }).then(() => conn.rmdir(folder, true)).then(() => {
                                    disableAllBtn(false);
                                    elementsDiv.removeChild(item);
                                    conn.end();
                                }).catch(err => {
                                    disableAllBtn(false);
                                    showMSG("Error al eliminar copia", "No se ha podido eliminar la copia de seguridad", err);
                                    conn.end();
                                });
                            });

                            downloadBtn.addEventListener("click", () => {
                                disableAllBtn(true);
                                let progressBarTotal = newElement("progress");
                                let progressBarItem = newElement("progress");
                                progressBarTotal.max = 100;
                                progressBarItem.max = 100;
                                progressBarTotal.style.width = "100%";
                                progressBarItem.style.width = "100%";
                                item.append(progressBarTotal);
                                item.append(progressBarItem);
                                let downloadFolder = process.env.USERPROFILE + "/Downloads/" + dir.name;
                                if (!fs.existsSync(downloadFolder)) {
                                    fs.mkdirSync(downloadFolder);
                                }
                                let totalTransfer = 0;
                                //TODO: Descargar uno por uno los ficheros de file con progreso al estilo de la subida, sabiendo cual es el size

                                let stopLoading = (stopConn = true) => {
                                    disableAllBtn(false);
                                    item.removeChild(progressBarItem);
                                    item.removeChild(progressBarTotal);
                                    if(stopConn) conn.end();
                                };
                                let downloadFile = i => {
                                    if (i < files.length) {
                                        conn.connect({
                                            host: confSftp.host,
                                            port: confSftp.port,
                                            username: confSftp.user,
                                            password: confSftp.pass
                                        }).then(() => {
                                            //Descargar cada fichero

                                            let localFile = downloadFolder + "/" + files[i].name;
                                            const progressStream = progress({ length: files[i].size, time: 100 });
                                            progressStream.on('progress', (progress) => {
                                                totalTransfer += progress.delta;
                                                progressBarTotal.value = (totalTransfer/size)*100;
                                                progressBarItem.value = progress.percentage;
                                            });
                                            const inputStream = fs.createWriteStream(localFile);
                                            progressStream.pipe(inputStream);

                                            conn.get(folder + "/" + files[i].name, progressStream)
                                                .then(res => {
                                                    //Pasar al siguiente fichero
                                                    conn.end().then(() => downloadFile(++i));
                                                })
                                                .catch(error => {
                                                    showMSG("Error al subir fichero", "No se ha podido subir el fichero. Revisa los permisos, quotas y espacio disponible.");
                                                    stopLoading();
                                                    console.log("Error al conectar subir fichero", error);
                                                });
                                        }).catch(error => {
                                            showMSG("Error al conectar con SFTP", "No se ha podido conectar con el servidor SFTP. Revisa las credenciales y los permisos.");
                                            stopLoading();
                                            console.log("Error al conectar con SFTP", error);
                                        });
                                    } else {
                                        stopLoading(false);
                                        require('child_process').exec('start "" "' + downloadFolder + '"');
                                    }
                                };
                                downloadFile(0);
                            });

                            if (--nDirs == 0) {
                                stopLoadingActualizar();
                                conn.end();
                            }
                        }).catch(err => {
                            console.log(err);
                        });
                    });
                }).catch(err => {
                    stopLoadingActualizar();
                    showMSG("Error de conexion", "Se ha producido un error en la conexion SFTP", err);
                    conn.end();
                });
            }
            function limpiar() {
                if(confSftp == null) return;
                disableAllBtn(true);
                limpiarBtn.insertBefore(newElement("i", "fas fa-sync-alt fa-spin me-2"), limpiarBtn.firstChild);

                conn.connect({
                    host: confSftp.host,
                    port: confSftp.port,
                    username: confSftp.user,
                    password: confSftp.pass
                }).then(() => conn.list(sftpConf.dir)).then(dirs => {
                    let clearMonth = confClearMonth.checked, clearYear = confClearYear.checked;
                    let toDelete = [];
                    if (!clearMonth && !clearYear) {
                        dirs.forEach(dir => toDelete.push(dir.name));
                    } else {
                        let days = {};
                        dirs.forEach(dir => {
                            let parts = dir.name.split("-");
                            if (days[parts[0]] === undefined) days[parts[0]] = {};
                            if (days[parts[0]][[parts[1]]] === undefined) days[parts[0]][[parts[1]]] = [dir.name];
                            else days[parts[0]][[parts[1]]].push(dir.name);
                        });
                        if (clearYear) {
                            let yearly = {};
                            Object.entries(days).forEach(items => {
                                let year = items[0], months = items[1];
                                yearly[year] = [];
                                Object.entries(months).forEach(items => {
                                    let month = items[0], days = items[1];
                                    days.forEach(day => {
                                        yearly[year].push(day);
                                    });
                                });
                            });
                            console.log(yearly);
                            Object.entries(yearly).forEach(copies => {
                                let list = copies[1];
                                list.sort();
                                for (let i = 0; i < list.length - 1; i++) toDelete.push(list[i]);
                            });
                        }
                        if (clearMonth) {
                            Object.entries(days).forEach(monts => {
                                Object.entries(monts[1]).forEach(copies => {
                                    let list = copies[1];
                                    list.sort();
                                    for (let i = 0; i < list.length - 1; i++) toDelete.push(list[i]);
                                });
                            });
                        }
                    }

                    let promisses = [];
                    toDelete.forEach(folder => promisses.push(conn.rmdir(sftpConf.dir + "/" + folder, true)));
                    Promise.all(promisses).then(() => {
                        stopLoadingLimpiar();
                        conn.end().then(() => actualizar());
                    }).catch(err => {
                        stopLoadingLimpiar();
                        showMSG("Error de conexion", "Se ha producido un error en la conexion SFTP", err);
                        conn.end().then(() => actualizar());
                    });
                }).catch(err => {
                    stopLoadingLimpiar();
                    showMSG("Error de conexion", "Se ha producido un error en la conexion SFTP", err);
                    conn.end();
                });
            }
        });
        gotoUploadBtn.firstChild.classList.remove("selected");
        gotoConfigBtn.firstChild.classList.add("selected");
    });

    gotoUploadBtn.click();

    var modalMSGshowBtn = document.getElementById("modalMSGshowBtn");
    var modalMSGtitle = document.getElementById("modalMSGtitle");
    var modalMSGbody = document.getElementById("modalMSGbody");
    var modalMSGarea = document.getElementById("modalMSGarea");
    function showMSG(title, body, area = null) {
        modalMSGtitle.innerText = title;
        modalMSGbody.innerText = body;
        if (area !== null) {
            modalMSGarea.classList.remove("visually-hidden");
            modalMSGarea.value = area;
        } else {
            modalMSGarea.classList.add("visually-hidden");
        }
        modalMSGshowBtn.click();
    }

});


function hBytes(x) {
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    let l = 0, n = parseInt(x, 10) || 0;
    while (n >= 1024 && ++l) {
        n = n / 1024;
    }
    return (n.toFixed(n < 10 && l > 0 ? 1 : 0) + ' ' + units[l]);
}

function newElement(type, clases = null, data = null, id = null, foor = null) {
    let e = document.createElement(type);
    if (id !== null) e.id = id;
    if (foor !== null) e.htmlFor = foor;
    if (type == "button") e.type = "button";
    if (clases !== null) addClases(e, clases);
    if (data !== null) {
        switch (type) {
            case "img":
            case "video":
            case "audio":
                e.src = data;
            default:
                e.innerText = data;
        }
    }
    return e;
}
function addClases(element, clases) {
    clases.split(" ").forEach(clas => {
        element.classList.add(clas);
    });
}

function disableAllBtn(disabled) {
    [...document.querySelectorAll(".btn")].forEach(btn => btn.disabled = disabled);
}
