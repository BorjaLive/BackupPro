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

window.addEventListener('DOMContentLoaded', () => {

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


    //Carga y dibujado de los elementos
    var elements;
    (async () => {
        await storage.init();
        elements = await storage.get("elements");
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
    })();

    var elementsDiv = document.getElementById("elementsDiv");
    function drawElement(element) {
        let mainDiv = newElement("li", "list-group-item d-flex flex-row justify-content-between align-items-center p-1");

        mainDiv.append(newElement("span", "unselectable", element.name));
        let deleteBtn = newElement("button", "btn btn-sm btn-outline-danger");
        deleteBtn.append(newElement("i", "fas fa-times"));
        deleteBtn.addEventListener("click", () => {
            elements.splice(elements.indexOf(element), 1);
            elementsDiv.removeChild(mainDiv);
            saveElements();
        });
        mainDiv.append(deleteBtn);

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

    //Boton subir
    var backupBtn = document.getElementById("backupBtn");
    backupBtn.addEventListener("click", () => {
        disableAllBtn(true);
        backupBtn.insertBefore(newElement("i", "fas fa-sync-alt fa-spin me-2"), backupBtn.firstChild);

        fs.mkdtemp(path.join(os.tmpdir(), 'backuppro-'), (err, tmpDir) => {
            console.log(tmpDir);

            //Probar la conexion y crear la carpeta o vaciarla
            let conn = new SFTP();
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
                //conn.end();

                //Comprimir cada elemento
                elements.forEach((element, i) => {
                    let zipFile = path.join(tmpDir, element.name.replace(" ", "_") + ".zip");
                    let output = fs.createWriteStream(zipFile);
                    let archive = archiver('zip', { store: true });
                    archive.pipe(output);

                    output.on('close', function () {
                        //Subir el fichero comprimido
                        console.log("Subir:", zipFile, archive.pointer(), remoteDir);

                        const progressStream = progress({length: archive.pointer(), time: 100});
                        progressStream.on('progress', (progress) => {
                            console.log(" [" + path.basename(zipFile) + "] uploaded [" + progress.percentage.toFixed(2) + "%]");
                        });
                        const outStream = fs.createReadStream(zipFile);
                        outStream.pipe(progressStream);
                        
                        conn.put(progressStream, remoteDir+"/"+path.basename(zipFile))
                        .then(res => console.log("Subido", res))
                        .catch(error => console.log("error al subir", error));
                    });

                    switch (element.type) {
                        case "db":
                            let command = `${element.data.bin} -u ${element.data.user} ${element.data.pass == "" ? "" : `-p${element.data.pass}`} --all-databases`;
                            let dump = exec(command, { maxBuffer: 1024 * 1024 * 400 });
                            archive.append(dump.stdout, { name: element.name + ".sql" });
                            break;
                        case "dir":
                            fastFolderSize(element.data, (error, bytes) => {
                                if (error) throw error;
                                let progressInterval = setInterval(() => {
                                    let percent = archive.pointer()/bytes;
                                    console.log("Comprimiendo", percent);
                                    if(percent > 0.99){
                                        clearInterval(progressInterval);
                                    }
                                }, 100);
                              });
                            archive.directory(element.data, false);
                            break;
                        case "file":
                            let fileSize = fs.statSync(element.data).size;
                            let progressInterval = setInterval(() => {
                                let percent = archive.pointer()/fileSize;
                                console.log("Comprimiendo", percent);
                                if(percent > 0.99){
                                    clearInterval(progressInterval);
                                }
                            }, 100);
                            archive.file(element.data, { name: path.basename(element.data) });
                            break;
                    }

                    archive.finalize();
                });

            }).catch(err => {
                console.log(err, 'catch error');
            });



            //fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        //Guardar los datos de conexion
        storage.set("sftp", {
            host: confSftpHost.value,
            port: confSftpPort.value,
            user: confSftpUser.value,
            pass: confSftpPass.value,
            dir: confSftpDir.value
        });

        disableAllBtn(false);
        backupBtn.removeChild(backupBtn.firstChild);
    });

});

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