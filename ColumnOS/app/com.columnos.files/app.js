(async function waitForVApp() {
    // 等待 window.vapp 和 globalVfs 可用
    function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    while (!window.vapp || !window.vapp.globalVfs) {
        await sleep(100);
    }

    const vfs = window.vapp.globalVfs;
    const utils = window.vapp.globalUtils;

    const fileListEl = document.getElementById("file-list");
    const currentPathEl = document.getElementById("current-path");
    const btnUp = document.getElementById("btn-up");
    const btnNewFolder = document.getElementById("btn-new-folder");
    const btnRefresh = document.getElementById("btn-refresh");
    const btnImport = document.getElementById("btn-import");

    const importModal = document.getElementById("import-modal");
    const importSelect = document.getElementById("import-select");
    const importCancel = document.getElementById("import-cancel");
    const importStatus = document.getElementById("import-status");

    let currentPath = "/";

    async function refreshDir(path) {
        currentPath = path;
        currentPathEl.innerText = path;
        fileListEl.innerHTML = "";
        const items = await vfs.dir(path);
        items.forEach(item => {
            const row = document.createElement("div");
            row.className = "file-item";

            const nameEl = document.createElement("div");
            nameEl.className = "file-name";
            nameEl.innerText = item.name + (item.isDir ? "/" : "");
            row.appendChild(nameEl);

            const actions = document.createElement("div");
            actions.className = "file-actions";

            const btnRename = document.createElement("button");
            btnRename.className = "fm-btn";
            btnRename.innerText = "重命名";
            btnRename.onclick = async (e) => {
                e.stopPropagation();
                const newName = prompt("新名称：", item.name);
                if (!newName) return;
                if (item.isDir) await vfs.renameDir(path + "/" + item.name, newName);
                else await vfs.renameFile(path + "/" + item.name, newName);
                refreshDir(currentPath);
            };
            actions.appendChild(btnRename);

            const btnDelete = document.createElement("button");
            btnDelete.className = "fm-btn";
            btnDelete.innerText = "删除";
            btnDelete.onclick = async (e) => {
                e.stopPropagation();
                if (item.isDir) await vfs.deleteDir(path + "/" + item.name);
                else await vfs.deleteFile(path + "/" + item.name);
                refreshDir(currentPath);
            };
            actions.appendChild(btnDelete);

            row.appendChild(actions);

            row.onclick = async () => {
                Array.from(fileListEl.children).forEach(c => c.classList.remove("selected"));
                row.classList.add("selected");

                if (item.isDir) {
                    // 如果是文件夹，进入目录
                    refreshDir(path + (path.endsWith("/") ? "" : "/") + item.name);
                } else {
                    // 如果是文件，根据后缀判断类型
                    const filePath = path + (path.endsWith("/") ? "" : "/") + item.name;
                    const ext = item.name.split(".").pop().toLowerCase();

                    if (ext === "pdf") {
                        // 打开 PDF
                        window.parent.createVApp("com.columnos.reader.pdf", { file: filePath });
                    } else if (["mp4", "mkv", "webm", "avi"].includes(ext)) {
                        // 打开视频
                        window.parent.createVApp("com.columnos.reader.video", { file: filePath });
                    } else if (["update"].includes(ext)) {
                        // 打开更新
                        window.parent.createVApp("com.columnos.update", { file: filePath });
                    } else if (["app"].includes(ext)) {
                        // 打开应用安装器
                        window.parent.createVApp("com.columnos.appinstaller", { file: filePath });
                    } else {
                        // 其他文件类型可选择提示或忽略
                        console.warn("不支持的文件类型:", ext);
                    }
                }
            };


            fileListEl.appendChild(row);
        });
    }

    btnUp.onclick = () => {
        if (currentPath === "/") return;
        const parts = currentPath.split("/").filter(p => p);
        parts.pop();
        refreshDir("/" + parts.join("/") || "/");
    };

    btnNewFolder.onclick = async () => {
        const folderName = prompt("新建文件夹名称：");
        if (!folderName) return;
        await vfs.createDirIfNotExist(currentPath + (currentPath.endsWith("/") ? "" : "/") + folderName);
        refreshDir(currentPath);
    };

    btnRefresh.onclick = () => refreshDir(currentPath);

    // 初始化
    refreshDir(currentPath);

    // =================== 导入按钮 ===================
    btnImport.onclick = () => {
        importModal.classList.remove("modal-hidden");
        importModal.classList.add("modal-visible");
        importStatus.innerText = "";
    };

    importCancel.onclick = () => {
        importModal.classList.remove("modal-visible");
        importModal.classList.add("modal-hidden");
    };


    importSelect.onclick = async () => {
        const serverIp = document.getElementById("import-server-ip").value.trim();
        if (!serverIp) {
            importStatus.innerText = "请填写服务器 IP 地址";
            return;
        }

        importStatus.innerText = "请选择文件并等待导入完成";
        try {
            const ws = new WebSocket(`ws://${serverIp}:8765`);

            ws.onopen = () => ws.send("select_file");

            ws.onmessage = async (event) => {
                try {
                    // 假设服务端返回 JSON { name: "example.pdf", data: "<base64>" }
                    const msg = JSON.parse(event.data);
                    const base64 = msg.data;
                    const fileName = msg.name;

                    const binaryStr = atob(base64);
                    const len = binaryStr.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);

                    const blob = new Blob([bytes], { type: "application/octet-stream" });

                    // 保留原始文件名导入
                    await vfs.setFile(
                        currentPath + (currentPath.endsWith("/") ? "" : "/") + fileName,
                        blob
                    );

                    importStatus.innerText = `文件 "${fileName}" 导入成功！`;
                    refreshDir(currentPath);
                    ws.close();
                } catch (err) {
                    importStatus.innerText = "文件导入失败：" + err.message;
                }
            };

            ws.onerror = (err) => {
                importStatus.innerText = "连接失败";
            };
        } catch (err) {
            importStatus.innerText = "错误：" + err.message;
        }
    };
    let lastBackTime = 0; // 上一次返回键触发时间
    const backTimeout = 2000; // 1.5 秒内再次触发算退出

    window.addEventListener('OnVappReturn', (e) => {
        console.log('收到返回事件');

        // 阻止默认关闭行为
        e.preventDefault();

        if (currentPath !== "/") {
            // 当前不在根目录，返回上一级
            const parts = currentPath.split("/").filter(p => p);
            parts.pop();
            refreshDir("/" + parts.join("/") || "/");
        } else {
            // 当前在根目录
            const now = Date.now();
            if (now - lastBackTime < backTimeout) {
                // 1.5 秒内再次按返回，允许退出
                console.log("退出应用或关闭页面");
                vapp.exit(); // 或其他退出逻辑
            } else {
                alert("2s内再次返回退出");
                lastBackTime = now;
            }
        }
    });
    const btnCloudImport = document.getElementById("btn-cloud-import");
    const cloudModal = document.getElementById("cloud-import-modal");
    const cloudClose = document.getElementById("cloud-import-close");
    const cloudStatus = document.getElementById("cloud-import-status");

    let cloudImportStop = false;
    let cloudImportTask = null;

    btnCloudImport.onclick = () => {
        cloudModal.classList.remove("modal-hidden");
        cloudModal.classList.add("modal-visible");
        cloudStatus.innerText = "开始搜索 chunkStore ...";

        cloudImportStop = false;

        // 启动云导入任务
        if (!cloudImportTask) {
            cloudImportTask = startCloudImport();
        }
    };

    cloudClose.onclick = () => {
        cloudImportStop = true;  // 停止循环
        cloudModal.classList.remove("modal-visible");
        cloudModal.classList.add("modal-hidden");
    };

    // ================== 云导入逻辑 ==================
    async function startCloudImport() {
        const identifier = "FILE00"; // 6位标识符

        while (!cloudImportStop) {
            const items = await window.vapp.chunkStore.search(identifier);
            console.debug("云导入搜索结果:", items);

            if (items && items.length > 0) {
                for (const itemStr of items) {
                    if (cloudImportStop) break;  // 关闭时立即退出
                    try {
                        const item = JSON.parse(itemStr);
                        const fileName = item.fileName;
                        const base64 = item.base64;

                        // 显示保存进度动画
                        cloudStatus.innerHTML = `<span class="cloud-loading"></span>正在导入：${fileName}`;

                        const binaryStr = atob(base64);
                        const len = binaryStr.length;
                        const bytes = new Uint8Array(len);
                        for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);

                        const blob = new Blob([bytes], { type: "application/octet-stream" });

                        await vapp.globalVfs.setFile(
                            currentPath + (currentPath.endsWith("/") ? "" : "/") + fileName,
                            blob
                        );

                        cloudStatus.innerText = `文件 "${fileName}" 导入成功！`;
                        await refreshDir(currentPath);

                        // 间隔 0.5 秒再导入下一条
                        await new Promise(r => setTimeout(r, 500));
                    } catch (err) {
                        cloudStatus.innerText = "导入失败：" + err.message;
                        console.error("云导入失败", err);
                    }
                }
            } else {
                cloudStatus.innerText = "chunkStore 没有新文件，继续搜索...";
            }

            await new Promise(r => setTimeout(r, 500));
        }

        cloudImportTask = null; // 完成或关闭后清理
    }


})();
