(function (global) {
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
        async _tx(mode) {
            const db = await this.dbp;
            return db.transaction("files", mode).objectStore("files");
        }
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
    }
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
                    position: "fixed",
                    top: "0",
                    left: "0",
                    width: "100%",
                    height: "100%",
                    border: "0",
                    zIndex: "9999"
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
                // src 属性
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

                // srcset
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
                    }))).filter(Boolean).join(", ");
                }

                // href <a> <link>
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

                // form action
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
            const iframe = this.iframe;
            const vfs = this.vfs;
            const root = this.rootURL;
            const blobPool = this.blobPool;

            const patchDoc = (doc) => {
                this._replaceAllUrls(doc);

                // 动态 DOM 监听
                const mo = new MutationObserver(muts => {
                    muts.forEach(m => {
                        m.addedNodes.forEach(n => {
                            if (n.nodeType === 1) this._replaceAllUrls(n);
                        });
                    });
                });
                mo.observe(doc, { childList: true, subtree: true });
            };

            // 每次 iframe load 都重新扫描
            iframe.addEventListener("load", () => {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                patchDoc(doc);
            });

            // 初始扫描（可能已经有 document）
            if (iframe.contentDocument) patchDoc(iframe.contentDocument);

            // fetch/XHR monkey patch
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
    class VFSUtils {
        constructor(vfs) {
            this.vfs = vfs;
        }

        // 下载文件到 VFS
        async downloadFile(url, path) {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error("Download failed: " + url);
            const blob = await resp.blob();
            await this.vfs.setFile(path, blob);
        }

        // 解压 zip 文件到 targetDir
        async unzipFile(zipPath, targetDir) {
            const blob = await this.vfs.getFile(zipPath);
            if (!blob) throw new Error("ZIP not found: " + zipPath);

            const arrayBuffer = await blob.arrayBuffer();
            const zip = await JSZip.loadAsync(arrayBuffer);

            for (const [filename, fileObj] of Object.entries(zip.files)) {
                if (fileObj.dir) continue;
                const fileData = await fileObj.async("blob");
                await this.vfs.setFile(joinPaths(targetDir, filename), fileData);
            }
        }

        // 执行 VFS 中的 JS 文件
        async _runJs(jsPath) {
            const blob = await this.vfs.getFile(jsPath);
            if (!blob) throw new Error("JS file not found: " + jsPath);
            const url = URL.createObjectURL(blob);
            const script = document.createElement("script");
            script.src = url;
            document.body.appendChild(script);
            // 可选：移除 script
            script.onload = () => URL.revokeObjectURL(url);
        }
    }
    function joinPaths(base, name) {
        if (base.endsWith("/")) return base + name;
        return base + "/" + name;
    }
    global.VFS = VFS;
    global.VApp = VApp;
    global.VFSUtils = VFSUtils;
}
)(window);


