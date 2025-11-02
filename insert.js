(function (global) {

    // ------------------- 配置 -------------------
    const debug = false; // debug 模式
    const DEP_DIR = "/dependence/";
    const DEPENDENCIES = [
        { name: "jszip.min.js", url: "dependence/jszip.min.js" }
        // 可拓展更多依赖
    ];

    // ------------------- 工具函数 -------------------
    async function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.onload = () => resolve();
            s.onerror = e => reject(e);
            document.head.appendChild(s);
        });
    }

    function joinPaths(base, name) {
        if (base.endsWith("/")) return base + name;
        return base + "/" + name;
    }

    async function ws2blob(filePath, wsUrl = "ws://127.0.0.1:8766", mimeType = "application/octet-stream") {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);

            ws.onopen = () => ws.send(filePath);

            ws.onmessage = (event) => {
                try {
                    // 服务器返回 Base64 字符串
                    const base64 = typeof event.data === "string" ? event.data : null;
                    if (!base64) throw new Error("返回内容不是字符串");

                    // Base64 -> Uint8Array
                    const binaryStr = atob(base64);
                    const len = binaryStr.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryStr.charCodeAt(i);
                    }

                    resolve(new Blob([bytes], { type: mimeType }));
                } catch (err) {
                    reject(new Error("Base64 解码失败: " + err.message));
                } finally {
                    ws.close();
                }
            };

            ws.onerror = (err) => reject(new Error("WebSocket 连接失败"));

            ws.onclose = (event) => {
                if (!event.wasClean) {
                    reject(new Error(`WebSocket 非正常关闭，code=${event.code}`));
                }
            };
        });
    }


    // ------------------- VFS -------------------
    class VFS {
        constructor(name) {
            this.name = name;
            this.dbp = this._initDB();
        }

        async _initDB() {
            return new Promise(resolve => {
                const req = indexedDB.open(this.name, 1);
                req.onupgradeneeded = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains("files")) {
                        db.createObjectStore("files", { keyPath: "path" });
                    }
                };
                req.onsuccess = e => resolve(e.target.result);
            });
        }

        async _tx(mode) { const db = await this.dbp; return db.transaction("files", mode).objectStore("files"); }
        _normalize(path) { return path.replace(/\/+/g, "/").replace(/\/$/, ""); }
        _guessMime(path) {
            const ext = path.split(".").pop().toLowerCase();
            const map = { js: "application/javascript", css: "text/css", html: "text/html", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", txt: "text/plain" };
            return map[ext] || "application/octet-stream";
        }

        async setFile(path, blob) {
            path = this._normalize(path);
            const type = blob.type || this._guessMime(path);
            const store = await this._tx("readwrite");
            return new Promise(resolve => store.put({ path, blob, type }).onsuccess = () => resolve(true));
        }

        async getFile(path) {
            path = this._normalize(path);
            const store = await this._tx("readonly");
            return new Promise(resolve => store.get(path).onsuccess = e => {
                const file = e.target.result;
                resolve(file ? new Blob([file.blob], { type: file.type }) : null);
            });
        }

        async deleteFile(path) {
            path = this._normalize(path);
            const store = await this._tx("readwrite");
            return new Promise(resolve => store.delete(path).onsuccess = () => resolve(true));
        }

        async renameFile(oldPath, newName) {
            oldPath = this._normalize(oldPath);
            const dir = oldPath.split("/").slice(0, -1).join("/") || "/";
            const newPath = this._normalize(dir + "/" + newName);
            const blob = await this.getFile(oldPath);
            if (!blob) return false;
            await this.setFile(newPath, blob);
            await this.deleteFile(oldPath);
            return true;
        }

        async createDir(path) {
            path = this._normalize(path);
            const store = await this._tx("readwrite");
            return new Promise(resolve => store.put({ path, dir: true }).onsuccess = () => resolve(true));
        }

        async deleteDir(path) {
            path = this._normalize(path);
            const db = await this.dbp;
            const tx = db.transaction("files", "readwrite");
            const store = tx.objectStore("files");
            return new Promise(resolve => {
                store.openCursor().onsuccess = e => {
                    const cur = e.target.result;
                    if (!cur) return resolve(true);
                    if (cur.key.startsWith(path)) cur.delete();
                    cur.continue();
                };
            });
        }

        async renameDir(path, newName) {
            path = this._normalize(path);
            const prefix = path + "/";
            const dir = path.split("/").slice(0, -1).join("/") || "/";
            const newPath = this._normalize(dir + "/" + newName);
            const db = await this.dbp;
            const tx = db.transaction("files", "readwrite");
            const store = tx.objectStore("files");
            return new Promise(resolve => {
                store.openCursor().onsuccess = e => {
                    const cur = e.target.result;
                    if (!cur) return resolve(true);
                    const key = cur.key;
                    if (key === path) { const v = cur.value; v.path = newPath; cur.update(v); }
                    else if (key.startsWith(prefix)) { const v = cur.value; v.path = v.path.replace(prefix, newPath + "/"); cur.update(v); }
                    cur.continue();
                };
            });
        }

        async dir(path) {
            path = this._normalize(path);
            const prefix = path === "/" ? "/" : path + "/";
            const items = [];
            const store = await this._tx("readonly");
            return new Promise(resolve => {
                store.openCursor().onsuccess = e => {
                    const cur = e.target.result;
                    if (!cur) return resolve(items);
                    const key = cur.key;
                    if (key.startsWith(prefix)) {
                        const rel = key.slice(prefix.length);
                        if (!rel.includes("/")) {
                            const v = cur.value;
                            items.push({ name: rel, isDir: !!v.dir, size: v.blob?.size || 0, mime: v.type || null });
                        }
                    }
                    cur.continue();
                };
            });
        }

        async uploadFileFromPrompt() {
            return new Promise(resolve => {
                const inp = document.createElement("input");
                inp.type = "file";
                inp.onchange = async () => {
                    const file = inp.files[0];
                    await this.setFile("/" + file.name, file);
                    resolve(file.name);
                };
                inp.click();
            });
        }

        // ------------------- 依赖管理 -------------------
        async createDirIfNotExist(path) {
            const items = await this.dir(path).catch(() => []);
            if (!items.length) await this.createDir(path);
        }

        async loadDependency(name, url) {
            await this.createDirIfNotExist(DEP_DIR);
            const depPath = DEP_DIR + name;

            // 仅在 VFS 中没有依赖时下载
            const localBlob = await this.getFile(depPath);
            if (localBlob) {
                const blobUrl = URL.createObjectURL(localBlob);
                await loadScript(blobUrl);
                if (debug) console.log(`Dependency loaded from VFS: ${name}`);
                return;
            }

            if (debug) console.log(`Downloading dependency ${name} from ${url} ...`);
            const blob = await ws2blob(url, debug ? "ws://127.0.0.1:8766" : "ws://sxz.school.zykj.org:8766", "application/javascript")
            await this.setFile(depPath, blob);   // 保存到 VFS
            const blobUrl = URL.createObjectURL(blob);
            await loadScript(blobUrl);
            if (debug) console.log(`Dependency saved to VFS: ${name}`);
        }



        async initDependencies(list = DEPENDENCIES) {
            await this.createDirIfNotExist(DEP_DIR);
            for (const dep of list) {
                await this.loadDependency(dep.name, dep.url);
            }
        }
    }


    // ------------------- VFSUtils -------------------
    class VFSUtils {
        constructor(vfs) { this.vfs = vfs; }

        async downloadFile(url, path) {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error("Download failed:" + url);
            const blob = await resp.blob();
            await this.vfs.setFile(path, blob);
        }

        async unzipFile(zipPath, targetDir) {
            const blob = await this.vfs.getFile(zipPath);
            if (!blob) throw new Error("ZIP not found:" + zipPath);
            const arrayBuffer = await blob.arrayBuffer();
            const zip = await JSZip.loadAsync(arrayBuffer);
            for (const [filename, fileObj] of Object.entries(zip.files)) {
                if (fileObj.dir) continue;
                const fileData = await fileObj.async("blob");
                await this.vfs.setFile(joinPaths(targetDir, filename), fileData);
            }
        }

        async _runJs(jsPath) {
            const blob = await this.vfs.getFile(jsPath);
            if (!blob) throw new Error("JS file not found:" + jsPath);
            const url = URL.createObjectURL(blob);
            const script = document.createElement("script");
            script.src = url;
            document.body.appendChild(script);
            script.onload = () => URL.revokeObjectURL(url);
        }
    }




    // ------------------- 导出 -------------------
    global.VFS = VFS;
    global.VFSUtils = VFSUtils;
    global.loadScript = loadScript;
    global.DEP_DIR = DEP_DIR;
    global.DEPENDENCIES = DEPENDENCIES;
    global.debug = debug;
    global.ws2blob = ws2blob;

    // ------------------- 自动创建全局VFS -------------------
    (async function () {
        try {
            const vfs = new VFS("globalVfs");
            await vfs.initDependencies();
            console.log("All dependencies loaded into globalVfs.");
            global.globalVfs = vfs;
            global.globalUtils = new VFSUtils(vfs);
            window.main();
        } catch (err) {
            console.error("Failed to initialize globalVfs dependencies:", err);
        }
    })();

})(window);


window.main = async function () {
    function getIframeDepth() {
        let depth = 0;
        let win = window;
        while (win !== win.top) {
            depth++;
            win = win.parent;
        }
        return depth;
    }

    console.log("当前在第 " + getIframeDepth() + " 层 iframe 中");

    if (getIframeDepth() == 1) { return; }

    const wsUrl = debug ? "ws://127.0.0.1:8766" : "ws://sxz.school.zykj.org:8766";
    const bootPath = "/boot.json";
    const systemDir = "/system";

    const bootFile = await globalVfs.getFile(bootPath);

    // 如果 boot.json 不存在，则显示全屏 UI
    let overlay, status;
    if (!bootFile) {
        // ---------- 全屏遮罩 UI ----------
        overlay = document.createElement("div");
        Object.assign(overlay.style, {
            position: "fixed",
            top: "0",
            left: "0",
            width: "100vw",
            height: "100vh",
            backgroundColor: "#000",
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            zIndex: "99999",
            fontFamily: "Arial, sans-serif",
            textAlign: "center",
            padding: "20px",
        });
        document.body.appendChild(overlay);

        // ColumnOS 装饰
        const title = document.createElement("div");
        title.innerHTML = `Column<span style="color:#1a73e8;">O</span>S`;
        Object.assign(title.style, { fontSize: "48px", fontWeight: "bold", marginBottom: "50px" });
        overlay.appendChild(title);

        // 状态信息
        status = document.createElement("div");
        status.innerText = "系统初始化中，请稍候...";
        Object.assign(status.style, { fontSize: "24px" });
        overlay.appendChild(status);
    }

    async function showStartButton() {
        if (!status) return;
        status.innerText = "安装完成！";
        const btn = document.createElement("button");
        btn.innerText = "开始使用";
        Object.assign(btn.style, {
            marginTop: "30px",
            padding: "12px 24px",
            fontSize: "20px",
            cursor: "pointer",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "#1a73e8",
            color: "#fff",
        });
        btn.onclick = () => location.reload();
        overlay.appendChild(btn);
    }

    if (!bootFile) {
        try {
            status.innerText = "正在下载 boot.json...";
            const bootBlob = await ws2blob("/image/boot.json", wsUrl, "application/json");
            await globalVfs.setFile(bootPath, bootBlob);

            status.innerText = "正在下载 system.zip...";
            const zipBlob = await ws2blob("/image/system.zip", wsUrl, "application/zip");
            await globalVfs.setFile("/system.zip", zipBlob);

            status.innerText = "正在解压 system.zip...";
            await globalUtils.unzipFile("/system.zip", systemDir);
            globalVfs.deleteFile("/system.zip");

            

            await showStartButton();
            return;
        } catch (err) {
            if (status) status.innerText = "初始化失败，请刷新页面重试";
            alert("初始化失败: " + err.message);
            console.error(err);
            return;
        }
    }

    // 如果 boot.json 已存在，不显示 UI，直接执行
    let bootJson;
    try {
        const text = await bootFile.text();
        bootJson = JSON.parse(text);
    } catch (err) {
        alert("解析 boot.json 失败: " + err.message);
        console.error(err);
        return;
    }

    if (Array.isArray(bootJson.files)) {
        for (const filePath of bootJson.files) {
            try {
                await globalUtils._runJs("/system/" + filePath);
                console.log("/system/" + filePath);
            } catch (err) {
                console.error(`执行 ${filePath} 失败:`, err);
            }
        }
    } else {
        console.warn("boot.json 中没有 files 列表");
    }
};
