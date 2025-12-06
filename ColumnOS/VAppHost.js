(function (global) {

    class VApp {
        constructor(vfs, rootURL, vfsRoot = "/", options = {}) {
            this.vfs = vfs;
            this.rootURL = rootURL.replace(/\/+$/, "/");
            this.vfsRoot = vfsRoot.replace(/\/+$/, "/");
            this.iframe = null;
            this.blobPool = {};

            // 可选传入自定义参数
            //options = { file: '/system/1.pdf', hash: '', href: '', pathname: '' };
            this.urlParams = options || {};
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

        _resolveVfsPath(url) {
            if (!url) return null;
            if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return null;
            if (url.startsWith("/")) return (this.vfsRoot + url.slice(1)).replace(/\/+/g, "/");
            return (this.vfsRoot + url).replace(/\/+/g, "/");
        }



        _injectVAppApi(win) {
            const params = this.urlParams || {};
            console.log("VApp: injecting vapp with params", params);
            const style = win.document.createElement('style');
            style.innerHTML = `
    html, body {
        overscroll-behavior: none;      /* 阻止滚动链式反弹 */
        -webkit-overflow-scrolling: auto; /* iOS 弹性滚动改为普通滚动 */
        overflow: hidden;                /* 需要可滚动的元素另行处理 */
    }
    * {
        -webkit-tap-highlight-color: transparent; /* 去掉触摸高亮 */
    }
`;
            win.document.head.appendChild(style);

            win.vapp = {
                params: params,
                globalVfs: window.globalVfs,
                globalUtils: window.globalUtils,
                chunkStore: window.chunkStore,
                pushToInbox: window.pushToInbox,
                tokenStore: window.tokenStore,
                getApiHost: window.getApiHost,
                getUsername: window.getUsername,
                // ============ 增加 getAppFile ============
                // 传入相对于 vfsRoot 的路径，如 "/img/icon.png"
                // 返回对应的 Blob
                getAppFile: async (relPath) => {
                    if (!relPath.startsWith("/")) relPath = "/" + relPath;

                    const vfsPath = (this.vfsRoot + relPath).replace(/\/+/g, "/");

                    const blob = await window.globalVfs.getFile(vfsPath);
                    return blob || null;
                },
                // =========================================


                fetch: async (url, options) => {
                    const vfsPath = this._resolveVfsPath(url);
                    if (!vfsPath) throw new Error("fetch: invalid VFS path: " + url);
                    const blob = await this.globalVfs.getFile(vfsPath);
                    if (!blob) return new Response(null, { status: 404 });
                    const text = await blob.text();
                    return new Response(text, {
                        status: 200,
                        headers: { "Content-Type": blob.type || "text/plain" }
                    });
                },

                xhr: (url) => {
                    const vfsPath = this._resolveVfsPath(url);
                    return {
                        async text() {
                            const blob = await this.globalVfs.getFile(vfsPath);
                            if (!blob) return null;
                            return await blob.text();
                        }
                    };
                }
            };

            // -------------------- Proxy 包装 location --------------------
            win.vapp.location = new Proxy({}, {
                get(_, prop) {
                    switch (prop) {
                        case 'href': return params.href || '';
                        case 'search': return params.search || '';
                        case 'hash': return params.hash || '';
                        case 'pathname': return params.pathname || '';
                        default: return undefined;
                    }
                },
                set(_, prop, value) {
                    console.warn('iframe location 被劫持, 设置无效');
                    return true;
                }
            });

            // -------------------- Proxy 包装 referrer --------------------
            win.vapp.referrer = new Proxy({}, {
                get(_, prop) {
                    if (prop === 'referrer') return params.referrer || '';
                    return undefined;
                }
            });
            win.alert = function (msg) {
                // 如果已有 toast，先移除
                const existing = win.document.getElementById('__vapp_toast');
                if (existing) existing.remove();

                const toast = win.document.createElement('div');
                toast.id = '__vapp_toast';
                toast.textContent = msg;

                Object.assign(toast.style, {
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    padding: '12px 24px',
                    backgroundColor: 'rgba(30,30,30,0.95)',
                    color: '#fff',
                    fontSize: '16px',
                    borderRadius: '8px',
                    zIndex: '999999',
                    textAlign: 'center',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                    opacity: '0',
                    transition: 'opacity 0.2s'
                });

                win.document.body.appendChild(toast);

                // 动画显示
                requestAnimationFrame(() => { toast.style.opacity = '1'; });

                // 1秒后自动消失
                setTimeout(() => {
                    toast.style.opacity = '0';
                    setTimeout(() => {
                        toast.remove();
                    }, 200);
                }, 1000);
            };

            // ==================== 劫持所有 file input ====================
            function hijackFileInputs() {
                const inputs = win.document.querySelectorAll('input[type=file]');
                inputs.forEach(input => {
                    if (input._vfsHijacked) return;
                    input._vfsHijacked = true;

                    input.addEventListener('click', async (e) => {
                        e.preventDefault(); // 阻止默认文件选择

                        // ---------- 文件管理器窗口 ----------
                        const overlay = document.createElement("div");
                        Object.assign(overlay.style, {
                            position: "fixed",
                            top: "0",
                            left: "0",
                            width: "100vw",
                            height: "100vh",
                            backgroundColor: "rgba(0,0,0,0.6)",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            zIndex: "99999"
                        });

                        const winDiv = document.createElement("div");
                        Object.assign(winDiv.style, {
                            width: "500px",
                            height: "400px",
                            backgroundColor: "#1e1e1e",
                            borderRadius: "12px",
                            boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                            padding: "12px",
                            fontFamily: "-apple-system, BlinkMacSystemFont, 'San Francisco', sans-serif",
                            display: "flex",
                            flexDirection: "column",
                            color: "#eee",
                            overflow: "hidden"
                        });

                        // 顶部按钮栏
                        const topBar = document.createElement("div");
                        Object.assign(topBar.style, { display: "flex", justifyContent: "space-between", marginBottom: "6px" });

                        const upBtn = document.createElement("button");
                        upBtn.innerText = "⬆ 上一级";
                        Object.assign(upBtn.style, { padding: "4px 8px", borderRadius: "6px", border: "none", cursor: "pointer", backgroundColor: "#333", color: "#eee" });

                        const closeBtn = document.createElement("button");
                        closeBtn.innerText = "✕";
                        Object.assign(closeBtn.style, { padding: "4px 8px", borderRadius: "6px", border: "none", cursor: "pointer", backgroundColor: "#333", color: "#eee" });

                        topBar.appendChild(upBtn);
                        topBar.appendChild(closeBtn);
                        winDiv.appendChild(topBar);

                        // 文件列表容器
                        const fileList = document.createElement("div");
                        Object.assign(fileList.style, { flex: "1", overflowY: "auto", display: "flex", flexDirection: "column" });
                        winDiv.appendChild(fileList);

                        // 底部按钮
                        const btnBar = document.createElement("div");
                        Object.assign(btnBar.style, { display: "flex", justifyContent: "flex-end", marginTop: "6px" });
                        const cancelBtn = document.createElement("button");
                        cancelBtn.innerText = "取消";
                        Object.assign(cancelBtn.style, { padding: "6px 12px", marginRight: "6px", borderRadius: "6px", border: "1px solid #555", backgroundColor: "#333", color: "#eee", cursor: "pointer" });
                        const selectBtn = document.createElement("button");
                        selectBtn.innerText = "选择";
                        Object.assign(selectBtn.style, { padding: "6px 12px", borderRadius: "6px", border: "none", backgroundColor: "#1a73e8", color: "#fff", cursor: "pointer" });
                        btnBar.appendChild(cancelBtn);
                        btnBar.appendChild(selectBtn);
                        winDiv.appendChild(btnBar);

                        overlay.appendChild(winDiv);
                        document.body.appendChild(overlay);

                        let currentPath = "/";
                        let selectedFile = null;

                        async function refreshDir(path) {
                            currentPath = path;
                            fileList.innerHTML = "";
                            selectedFile = null;

                            const items = await win.vapp.globalVfs.dir(path);
                            items.forEach(item => {
                                const row = document.createElement("div");
                                row.innerText = item.name + (item.isDir ? "/" : "");
                                Object.assign(row.style, {
                                    padding: "6px 12px",
                                    cursor: "pointer",
                                    borderRadius: "6px",
                                    marginBottom: "2px",
                                    backgroundColor: "#2a2a2a"
                                });

                                row.onmouseover = () => { if (selectedFile !== path + "/" + item.name) row.style.backgroundColor = "#3a3a3a"; };
                                row.onmouseout = () => { if (selectedFile !== path + "/" + item.name) row.style.backgroundColor = "#2a2a2a"; };

                                row.onclick = () => {
                                    if (item.isDir) {
                                        refreshDir(currentPath + (currentPath.endsWith("/") ? "" : "/") + item.name);
                                    } else {
                                        Array.from(fileList.children).forEach(c => c.style.backgroundColor = "#2a2a2a");
                                        row.style.backgroundColor = "#1a73e8";
                                        selectedFile = currentPath + (currentPath.endsWith("/") ? "" : "/") + item.name;
                                    }
                                };

                                fileList.appendChild(row);
                            });
                        }

                        // 上一级按钮
                        upBtn.onclick = () => {
                            if (currentPath === "/") return;
                            const parts = currentPath.split("/").filter(p => p);
                            parts.pop();
                            const newPath = "/" + parts.join("/");
                            refreshDir(newPath || "/");
                        };

                        // 关闭按钮
                        closeBtn.onclick = () => document.body.removeChild(overlay);
                        cancelBtn.onclick = () => document.body.removeChild(overlay);

                        // 选择按钮
                        selectBtn.onclick = async () => {
                            if (!selectedFile) { alert("请选择文件"); return; }
                            const blob = await win.vapp.globalVfs.getFile(selectedFile);
                            if (!blob) { alert("文件不存在"); return; }

                            const fileName = selectedFile.split('/').pop();
                            const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
                            const dt = new DataTransfer();
                            dt.items.add(file);
                            input.files = dt.files;

                            const event = new Event('change', { bubbles: true });
                            input.dispatchEvent(event);
                            document.body.removeChild(overlay);
                        };

                        // 初始化
                        await refreshDir("/");
                    });
                });
            }

            // 初始劫持
            hijackFileInputs();

            // 动态监控新插入的 file input
            const observer = new MutationObserver(hijackFileInputs);
            observer.observe(win.document.body, { childList: true, subtree: true });


            // ===================== 注入 exit =====================
            win.vapp.exit = () => {
                try {
                    // ============= ① 清空 this.blobPool 所有 URL =============
                    if (this.blobPool) {
                        for (const key in this.blobPool) {
                            try { URL.revokeObjectURL(this.blobPool[key]); } catch (e) { }
                        }
                        this.blobPool = {};
                    }

                    // ============= ② 清空 iframe.srcdoc，释放内容 =============
                    const iframeEl = win.frameElement;
                    if (iframeEl) iframeEl.srcdoc = "";

                    // ============= ③ 移除 iframe =============
                    if (iframeEl) {
                        const parentDiv = iframeEl.parentNode;
                        if (parentDiv) parentDiv.remove();
                    }

                    // 切回主界面（如果有）
                    if (typeof window.switchAppDiv === 'function') window.switchAppDiv('0');

                } catch (err) {
                    console.error('vapp.exit error:', err);
                }
            };



        }




        // 1) 先解析 vfs:xxx
        // 2) 从 vfs 读取 blob
        // 3) 用 applyVfsList 替换掉标签里的 vfs:xxx
        // 4) 再加载 iframe

        async load(url) {
            if (!this.iframe) throw new Error("iframe not bound");

            const parent = this.iframe.parentNode;
            const iframeId = this.iframe.id;

            const loader = document.getElementById(`${iframeId}-loader`);
            if (!loader) throw new Error(`Loader not found: ${iframeId}-loader`);

            loader.style.display = "flex";
            loader.style.opacity = "1";

            const newIframe = this.iframe.cloneNode(false);
            newIframe.style.display = "none";
            parent.replaceChild(newIframe, this.iframe);
            this.iframe = newIframe;

            const vfsPath = url.startsWith(this.rootURL)
                ? this.vfsRoot + url.slice(this.rootURL.length)
                : this.vfsRoot + url;

            const blob = await this.vfs.getFile(vfsPath);
            if (!blob) throw new Error("HTML not found: " + vfsPath);

            let html = await blob.text();

            // ================================
            // A) 提取所有 vfs:xxx
            // ================================
            const vfsList = window.parseVfsList(html);

            // ================================
            // B) 从 vfs 读取对应资源
            // ================================
            const blobMap = {};
            for (const vfsKey of vfsList) {
                const f = await this.vfs.getFile((this.vfsRoot + vfsKey).replace(/\/+/g, "/"));
                if (f) {
                    const url = URL.createObjectURL(f);
                    blobMap[vfsKey] = url;
                }
            }

            // ================================
            // C) 替换 HTML 里所有 vfs:xxx 标签属性
            // ================================
            html = window.applyVfsList(html, blobMap);

            this.iframe.srcdoc = html;
            await new Promise(r => (this.iframe.onload = r));

            for (const key in blobMap) {
                URL.revokeObjectURL(blobMap[key]);
            }

            // 注入 vapp API
            this._injectVAppApi(this.iframe.contentWindow);

            // ✅ 触发自定义事件 VappContentLoaded
            const event = new CustomEvent('VappContentLoaded', {
                detail: { iframe: this.iframe, vapp: this.iframe.contentWindow.vapp }
            });
            this.iframe.contentWindow.dispatchEvent(event);
            window.dispatchEvent(event); // 如果希望全局也能监听

            // 设置全局标志
            this.iframe.contentWindow.vappok = true;


            // 显示 iframe
            this.iframe.style.display = "block";

            loader.style.opacity = "0";
            setTimeout(() => (loader.style.display = "none"), 300);
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
