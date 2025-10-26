(function (global) {

    // ------------------- 配置 -------------------
    const debug = false; // debug 模式
    const DEP_DIR = "/dependence/";
    const DEPENDENCIES = [
        { name: "jszip.min.js", url: debug ? "http://127.0.0.1/i_res/jszip.min.js" : "/i_res/jszip.min.js" }
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
            const resp = await fetch(url);
            if (!resp.ok) throw new Error("Failed to download dependency: " + url);
            const blob = await resp.blob();
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

    // ------------------- VApp -------------------
    class VApp {
        constructor(vfs, rootURL) {
            this.vfs = vfs;
            this.rootURL = rootURL.replace(/\/+$/, "/");
            this.iframe = null;
            this.blobPool = {};
        }

        blind(selector) {
            this.iframe = document.querySelector(selector);
            if (!this.iframe) {
                this.iframe = document.createElement("iframe");
                Object.assign(this.iframe.style, {
                    position: "fixed", top: "0", left: "0", width: "100%", height: "100%", border: "0", zIndex: "9999"
                });
                document.body.appendChild(this.iframe);
            }
            this._patchIframe();
        }

        async _replaceAllUrls(rootNode) {
            const vfs = this.vfs, root = this.rootURL, blobPool = this.blobPool;
            const resolvePath = (base, url) => {
                if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return null;
                if (url.startsWith("/")) return url;
                const baseDir = base.split("/").slice(0, -1).join("/");
                return (baseDir + "/" + url).replace(/\/+/g, "/");
            };

            const elems = [...rootNode.querySelectorAll("*")];
            for (const el of elems) {
                if (el.hasAttribute("src")) {
                    const url = el.getAttribute("src");
                    const path = resolvePath(root, url);
                    if (path) {
                        const blob = await vfs.getFile(path);
                        if (blob) {
                            const blobUrl = URL.createObjectURL(blob);
                            el.setAttribute("src", blobUrl);
                            blobPool[blobUrl] = blob;
                        }
                    }
                }
                if (el.tagName.toLowerCase() === "img" && el.srcset) {
                    const parts = el.srcset.split(",");
                    el.srcset = (await Promise.all(parts.map(async p => {
                        let [u, w] = p.trim().split(/\s+/);
                        const p2 = resolvePath(root, u);
                        const b = await vfs.getFile(p2);
                        if (!b) return "";
                        const bu = URL.createObjectURL(b);
                        blobPool[bu] = b;
                        return w ? `${bu} ${w}` : bu;
                    }))).filter(Boolean).join(",");
                }

                if (el.hasAttribute("href") && ["A", "LINK"].includes(el.tagName)) {
                    el.addEventListener("click", async e => {
                        if (el.tagName === "A") {
                            const href = el.getAttribute("href");
                            if (!href || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) return;
                            e.preventDefault();
                            const path = href.startsWith("/") ? href : "/" + href;
                            const blob = await vfs.getFile(path);
                            if (!blob) return console.warn("VFS file not found:", path);
                            const blobUrl = URL.createObjectURL(blob);
                            blobPool[blobUrl] = blob;
                            el.href = blobUrl;
                            this.iframe.contentWindow.location.href = blobUrl;
                        }
                    });
                }

                if (el.tagName === "FORM" && el.hasAttribute("action")) {
                    el.addEventListener("submit", async e => {
                        const action = el.getAttribute("action");
                        if (!action || action.startsWith("http://") || action.startsWith("https://")) return;
                        e.preventDefault();
                        const path = action.startsWith("/") ? action : "/" + action;
                        const blob = await vfs.getFile(path);
                        if (!blob) return console.warn("VFS file not found:", path);
                        const blobUrl = URL.createObjectURL(blob);
                        blobPool[blobUrl] = blob;
                        el.action = blobUrl;
                        this.iframe.contentWindow.location.href = blobUrl;
                    });
                }
            }
        }

        _patchIframe() {
            const iframe = this.iframe, vfs = this.vfs, root = this.rootURL, blobPool = this.blobPool;
            const patchDoc = (doc) => {
                this._replaceAllUrls(doc);
                const mo = new MutationObserver(muts => {
                    muts.forEach(m => {
                        m.addedNodes.forEach(n => { if (n.nodeType === 1) this._replaceAllUrls(n); });
                    });
                });
                mo.observe(doc, { childList: true, subtree: true });
            };
            iframe.addEventListener("load", () => {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                patchDoc(doc);
            });
            if (iframe.contentDocument) patchDoc(iframe.contentDocument);

            const win = iframe.contentWindow;
            const origFetch = win.fetch.bind(win);
            win.fetch = async (input, opts) => {
                if (typeof input === "string" && input.startsWith(root)) {
                    const path = input.slice(root.length - 1);
                    const blob = await vfs.getFile(path);
                    if (!blob) throw Error("VFS file not found:" + path);
                    const type = blob.type || "application/octet-stream";
                    const txt = await blob.text();
                    return new Response(txt, { status: 200, headers: { "Content-Type": type } });
                }
                return origFetch(input, opts);
            };

            const OrigX = win.XMLHttpRequest;
            win.XMLHttpRequest = function () {
                const xhr = new OrigX();
                const origOpen = xhr.open;
                xhr.open = function (method, url, ...rest) {
                    if (typeof url === "string" && url.startsWith(root)) {
                        const path = url.slice(root.length - 1);
                        setTimeout(async () => {
                            const blob = await vfs.getFile(path);
                            if (!blob) xhr.status = 404;
                            else {
                                xhr.status = 200;
                                xhr.response = await blob.text();
                                xhr.responseText = xhr.response;
                                xhr.onload && xhr.onload();
                            }
                        }, 0);
                        return origOpen.call(this, method, url, ...rest);
                    }
                    return origOpen.call(this, method, url, ...rest);
                };
                return xhr;
            };
        }

        async load(url) {
            if (!this.iframe) throw Error("iframe not bound");
            const path = url.startsWith(this.rootURL) ? url.slice(this.rootURL.length - 1) : url;
            const blob = await this.vfs.getFile(path);
            if (!blob) throw Error("File not found in VFS:" + path);
            const blobUrl = URL.createObjectURL(blob);
            this.iframe.src = blobUrl;
            this.blobPool[blobUrl] = blob;
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
    global.VApp = VApp;
    global.VFSUtils = VFSUtils;
    global.loadScript = loadScript;
    global.DEP_DIR = DEP_DIR;
    global.DEPENDENCIES = DEPENDENCIES;
    global.debug = debug;

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
window.main = function () {

    if (window.top !== window.self) return;

    // ---------- 样式 ----------
    const style = document.createElement('style');
    style.textContent = `
        html, body { margin:0; padding:0; height:100%; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; background-color:#1e1e1e; color:#ddd; }

        /* Taskbar */
        #columnos-taskbar {
            position: fixed; top: -60px; left:0; width:100%; height:50px; background-color:#2b2b2b; color:#ddd; display:flex; justify-content:space-between; align-items:center; padding:0 20px; z-index:9999; box-shadow:0 1px 5px rgba(0,0,0,0.5); border-bottom:1px solid #444;
        }
        #columnos-taskbar .left, #columnos-taskbar .right { display:flex; align-items:center; gap:12px; }
        #columnos-taskbar .left span { font-weight:600; font-size:16px; }
        #columnos-taskbar button { background-color:#444; border:none; color:#ddd; padding:5px 12px; border-radius:12px; cursor:pointer; font-size:14px; transition:background 0.2s; }
        #columnos-taskbar button:hover { background-color:#555; }

        /* Launchpad */
        #launchpad-overlay { position: fixed; top:50px; left:0; width:100%; height:calc(100% - 50px); background:rgba(0,0,0,0.8); display:none; justify-content:center; align-items:center; z-index:9998; }
        #launchpad-container {
            background:#2b2b2b; border-radius:16px; padding:20px; max-width:800px; width:90%; max-height:80%; overflow:auto; display:grid; grid-template-columns:repeat(5,1fr); gap:20px;
            box-shadow:0 4px 20px rgba(0,0,0,0.8); transform: scale(0.8); opacity:0; transition: transform 0.3s ease, opacity 0.3s ease;
        }
        #launchpad-container.show { transform: scale(1); opacity:1; }

        .launchpad-app { display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; transition:transform 0.2s; }
        .launchpad-app:hover { transform:scale(1.1); }
        .launchpad-app-icon { width:60px; height:60px; border-radius:12px; background-color:#444; margin-bottom:8px; display:flex; align-items:center; justify-content:center; font-size:28px; overflow:hidden; }
        .launchpad-app-icon img { width:100%; height:100%; object-fit:cover; }
        .launchpad-app-name { font-size:12px; text-align:center; color:#ddd; }

        /* iframe */
        #columnos-iframe { position:fixed; top:50px; left:0; width:100%; height:calc(100% - 50px); border:none; background-color:#1e1e1e; }
    `;
    document.head.appendChild(style);

    // ---------- Taskbar ----------
    const taskbar = document.createElement('div');
    taskbar.id = 'columnos-taskbar';
    taskbar.innerHTML = `
        <div class="left"><span>ColumnOS</span><button id="all-apps-btn">所有应用</button></div>
        <div class="right"><button id="home-btn">主页</button><button id="tasks-btn">任务</button></div>
    `;
    document.body.prepend(taskbar);

    // ---------- 弹性滑入动画 ----------
    function slideDownElastic(elem, distance = 50, duration = 600) {
        let start = null;
        const initialTop = -distance;
        function easeOutElastic(t) { const c4 = (2 * Math.PI) / 3; return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; }
        function animate(timestamp) { if (!start) start = timestamp; const progress = Math.min((timestamp - start) / duration, 1); const eased = easeOutElastic(progress); elem.style.top = initialTop + eased * distance + 'px'; if (progress < 1) requestAnimationFrame(animate); }
        requestAnimationFrame(animate);
    }
    slideDownElastic(taskbar);

    // ---------- Launchpad ----------
    const overlay = document.createElement('div');
    overlay.id = 'launchpad-overlay';
    const container = document.createElement('div');
    container.id = 'launchpad-container';
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    function createLaunchpad(appList) {
        container.innerHTML = '';
        appList.forEach(app => {
            const appDiv = document.createElement('div');
            appDiv.className = 'launchpad-app';

            const iconDiv = document.createElement('div');
            iconDiv.className = 'launchpad-app-icon';

            if (app.icon instanceof Blob) { const img = document.createElement('img'); img.src = URL.createObjectURL(app.icon); iconDiv.appendChild(img); }
            else if (typeof app.icon === 'string' && (app.icon.startsWith('http://') || app.icon.startsWith('https://'))) { const img = document.createElement('img'); img.src = app.icon; iconDiv.appendChild(img); }
            else { iconDiv.textContent = app.icon; }

            const nameDiv = document.createElement('div');
            nameDiv.className = 'launchpad-app-name';
            nameDiv.textContent = app.name;

            appDiv.appendChild(iconDiv);
            appDiv.appendChild(nameDiv);
            appDiv.onclick = () => {
                app.action();
                overlay.style.display = 'none';
                container.classList.remove('show');
            };

            container.appendChild(appDiv);
        });
    }

    const apps = [
        { name: '浏览器', icon: '🌐', action: () => alert('打开浏览器') },
        { name: '邮件', icon: '✉️', action: () => alert('打开邮件') },
        { name: '设置', icon: '⚙️', action: () => alert('打开设置') },
        { name: '图片', icon: 'https://picsum.photos/60', action: () => alert('打开图片') },
        { name: '音乐', icon: '🎵', action: () => alert('打开音乐') },
        { name: '文档', icon: '📄', action: () => alert('打开文档') },
    ];

    document.getElementById('all-apps-btn').onclick = () => {
        createLaunchpad(apps);
        overlay.style.display = 'flex';
        setTimeout(() => container.classList.add('show'), 10); // 延迟触发动画
    };
    document.getElementById('home-btn').onclick = () => alert('返回主页');
    document.getElementById('tasks-btn').onclick = () => alert('打开任务列表');

    overlay.onclick = (e) => {
        if (e.target === overlay) {
            container.classList.remove('show');
            setTimeout(() => overlay.style.display = 'none', 300);
        }
    };

    setTimeout(() => {
        const children = Array.from(document.body.children);
        for (const c of children) { if (c.id !== 'columnos-taskbar' && c.id !== 'launchpad-overlay') c.remove(); }
        const iframe = document.createElement('iframe');
        iframe.id = 'columnos-iframe';
        iframe.src = window.location.href;
        document.body.appendChild(iframe);
    }, 700);
};