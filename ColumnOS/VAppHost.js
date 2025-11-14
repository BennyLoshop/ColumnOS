(function (global) {
    class VApp {
        constructor(vfs, rootURL, vfsRoot = "/") {
            this.vfs = vfs;
            this.rootURL = rootURL.replace(/\/+$/, "/");
            this.vfsRoot = vfsRoot.replace(/\/+$/, "/");
            this.iframe = null;
            this.blobPool = {}; // path -> Blob URL 缓存
        }

        bind(selector) {
            this.iframe = document.getElementById(selector);
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
        }

        async _getBlobUrl(path) {
            if (this.blobPool[path]) return this.blobPool[path];
            const blob = await this.vfs.getFile(path);
            if (!blob) return null;
            const blobUrl = URL.createObjectURL(blob);
            this.blobPool[path] = blobUrl;
            return blobUrl;
        }

        async _replaceAllUrls(rootNode) {
            const vfsRoot = this.vfsRoot;
            const resolvePath = (url) => {
                if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return null;
                if (url.endsWith(".html") || url.endsWith(".htm")) return null; // HTML 文件不要 blob
                if (url.startsWith("/")) return (vfsRoot + url.slice(1)).replace(/\/+/g, "/");
                return url;
            };

            const elems = [...rootNode.querySelectorAll("*")];
            for (const el of elems) {
                // src
                if (el.hasAttribute("src")) {
                    const url = el.getAttribute("src");
                    const path = resolvePath(url);
                    if (path) {
                        const blobUrl = await this._getBlobUrl(path);
                        if (blobUrl) el.setAttribute("src", blobUrl);
                    }
                }

                // srcset
                if (el.tagName.toLowerCase() === "img" && el.srcset) {
                    const parts = el.srcset.split(",");
                    el.srcset = (await Promise.all(parts.map(async p => {
                        let [u, w] = p.trim().split(/\s+/);
                        const path = resolvePath(u);
                        const blobUrl = path ? await this._getBlobUrl(path) : null;
                        if (!blobUrl) return "";
                        return w ? `${blobUrl} ${w}` : blobUrl;
                    }))).filter(Boolean).join(",");
                }

                // link
                if (el.tagName === "LINK" && el.rel === "stylesheet" && el.href) {
                    const path = resolvePath(el.href);
                    if (path) {
                        const blobUrl = await this._getBlobUrl(path);
                        if (blobUrl) el.href = blobUrl;
                    }
                }

                // script
                if (el.tagName === "SCRIPT" && el.src) {
                    const path = resolvePath(el.src);
                    if (path) {
                        const blobUrl = await this._getBlobUrl(path);
                        if (blobUrl) el.src = blobUrl;
                    }
                }

                // a 标签点击跳转
                if (el.hasAttribute("href") && el.tagName === "A") {
                    el.addEventListener("click", async e => {
                        const href = el.getAttribute("href");
                        if (!href) return;
                        e.preventDefault();
                        await this.load(href); // HTML 文件从 VFS 加载
                    });
                }

                // form
                if (el.tagName === "FORM" && el.hasAttribute("action")) {
                    el.addEventListener("submit", async e => {
                        const action = el.getAttribute("action");
                        if (!action) return;
                        e.preventDefault();
                        await this.load(action); // HTML 文件从 VFS 加载
                    });
                }
            }
        }

        async _injectHtmlToIframe(html) {
            const doc = this.iframe.contentDocument || this.iframe.contentWindow.document;
            doc.open();
            doc.write(html);
            doc.close();

            // 替换内部资源为 blob
            await this._replaceAllUrls(doc);

            // 拦截动态创建 script/link
            const OrigCreateEl = doc.createElement.bind(doc);
            doc.createElement = (tag) => {
                const el = OrigCreateEl(tag);
                if ((tag === "script" && el.src) || (tag === "link" && el.rel === "stylesheet" && el.href)) {
                    Object.defineProperty(el, tag === "script" ? "src" : "href", {
                        set: async (value) => {
                            const path = value.startsWith("/") ? this.vfsRoot + value.slice(1) : this.vfsRoot + value;
                            const blobUrl = await this._getBlobUrl(path);
                            if (blobUrl) el.setAttribute(tag === "script" ? "src" : "href", blobUrl);
                        },
                        configurable: true,
                        enumerable: true
                    });
                }
                return el;
            };

            // 拦截 fetch
            const win = this.iframe.contentWindow;
            const origFetch = win.fetch.bind(win);
            // win.fetch = async (input, opts) => {
            //     if (typeof input === "string") {
            //         const path = input.startsWith("/") ? this.vfsRoot + input.slice(1) : this.vfsRoot + input;
            //         const blob = await this.vfs.getFile(path);
            //         if (!blob) return new Response(null, { status: 404 });
            //         const text = await blob.text();
            //         return new Response(text, { status: 200, headers: { "Content-Type": blob.type || "text/plain" } });
            //     }
            //     return origFetch(input, opts);
            // };

            // 拦截 XHR
            const OrigX = win.XMLHttpRequest;
            win.XMLHttpRequest = () => {
                const xhr = new OrigX();
                const origOpen = xhr.open;
                xhr.open = (method, url, ...rest) => {
                    setTimeout(async () => {
                        const path = url.startsWith("/") ? this.vfsRoot + url.slice(1) : this.vfsRoot + url;
                        const blob = await win.vapp.vfs.getFile(path);
                        if (!blob) {
                            xhr.status = 404;
                            xhr.responseText = null;
                        } else {
                            xhr.status = 200;
                            const text = await blob.text();
                            xhr.response = text;
                            xhr.responseText = text;
                        }
                        xhr.onload && xhr.onload();
                    }, 0);
                    return origOpen.call(xhr, method, url, ...rest);
                };
                return xhr;
            };
        }

        async load(url) {
            if (!this.iframe) throw new Error("iframe not bound");

            const parent = this.iframe.parentNode;
            const iframeId = this.iframe.id;

            // 获取 loader
            const loader = document.getElementById(`${iframeId}-loader`);
            if (!loader) throw new Error(`Loader not found: ${iframeId}-loader`);

            // 直接显示 loader
            loader.style.display = 'flex';
            loader.style.opacity = '1';
            loader.style.transition = 'opacity 0.3s ease';

            // 克隆 iframe 清理旧环境
            const newIframe = this.iframe.cloneNode(false);
            newIframe.style.display = "none"; // 先隐藏
            newIframe.src = window.location.href; // 永远加载 navPage.html
            parent.replaceChild(newIframe, this.iframe);
            this.iframe = newIframe;

            // 等待 navPage.html 加载完成
            await new Promise(resolve => {
                this.iframe.onload = () => resolve();
            });

            // 将 vapp 引入 iframe
            this.iframe.contentWindow.vapp = this;

            // 获取目标 HTML 并注入
            const path = url.startsWith(this.rootURL)
                ? this.vfsRoot + url.slice(this.rootURL.length)
                : this.vfsRoot + url;
            const blob = await this.vfs.getFile(path);
            if (!blob) throw new Error("HTML file not found in VFS: " + path);
            const html = await blob.text();
            await this._injectHtmlToIframe(html);

            // 显示 iframe
            this.iframe.style.display = "block";

            // loader 淡出
            loader.style.opacity = '0';
            setTimeout(() => {
                loader.style.display = 'none';
            }, 300);
        }



    }

    global.VApp = VApp;
})(window);



// ------------------- app 管理部分保持不变 -------------------
async function ensureSystemDataManifest() {
    let blob = await window.globalVfs.getFile("/systemdata/appManifest.json");
    if (!blob) {
        const empty = new Blob([JSON.stringify([], null, 2)], { type: "application/json" });
        await window.globalVfs.setFile("/systemdata/appManifest.json", empty);
        blob = empty;
    }
    return blob;
}

async function getAppList() {
    const systemManifestBlob = await window.globalVfs.getFile("/system/app/appManifest.json");
    const systemDataBlob = await ensureSystemDataManifest(); // 确保存在

    let systemApps = [];
    let userApps = [];

    if (systemManifestBlob) {
        const text = await systemManifestBlob.text();
        try { systemApps = JSON.parse(text); } catch (e) { console.error(e); }
    }
    if (systemDataBlob) {
        const text = await systemDataBlob.text();
        try { userApps = JSON.parse(text); } catch (e) { console.error(e); }
    }

    const allApps = [...systemApps, ...userApps];

    const appsWithBlobIcons = await Promise.all(allApps.map(async app => {
        let iconBlob = null;
        if (app.appIcon) {
            const path = app.appIcon.startsWith("/") ? app.appIcon : `/app/${app.appId}/${app.appIcon}`;
            try {
                const blob = await window.globalVfs.getFile(path);
                if (blob) iconBlob = blob;
            } catch (e) {
                console.warn(`获取图标失败: ${path}`, e);
            }
        }
        return {
            name: app.appName,
            id: app.appId,
            icon: iconBlob || app.appIcon
        };
    }));

    return appsWithBlobIcons;
}

async function installApp(manifestPath) {
    const manifestBlob = await window.globalVfs.getFile(manifestPath);
    if (!manifestBlob) throw new Error("Manifest not found: " + manifestPath);

    const text = await manifestBlob.text();
    let app;
    try { app = JSON.parse(text); } catch (e) { throw new Error("Invalid JSON in manifest"); }

    if (app.appIcon && typeof app.appIcon === "string") {
        const fileName = app.appIcon.split('/').pop();
        app.appIcon = `/app/${app.appId}/${fileName}`;
    }

    let systemDataApps = [];
    const dataBlob = await ensureSystemDataManifest();
    if (dataBlob) {
        try {
            const dataText = await dataBlob.text();
            systemDataApps = JSON.parse(dataText);
        } catch (e) { console.error(e); }
    }

    const existingIndex = systemDataApps.findIndex(a => a.appId === app.appId);
    if (existingIndex >= 0) {
        systemDataApps[existingIndex] = app;
    } else {
        systemDataApps.push(app);
    }

    const newBlob = new Blob([JSON.stringify(systemDataApps, null, 2)], { type: "application/json" });
    await window.globalVfs.setFile("/systemdata/appManifest.json", newBlob);
}
