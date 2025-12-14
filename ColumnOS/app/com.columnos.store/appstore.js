async function waitVapp() {
    if (window.vapp) return window.vapp;
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.vapp) {
                clearInterval(timer);
                resolve(window.vapp);
            }
        }, 50);
    });
}

async function ensureAppIndex(vapp) {
    const path = "/systemdata/appstore/appIndex.json";
    try {
        const blob = await vapp.globalVfs.getFile(path);
        if (blob) return JSON.parse(await blob.text());
    } catch (e) { }

    const demoApps = Array.from({ length: 10 }, (_, i) => ({
        appId: `com.columnos.demo${i + 1}`,
        appName: `示例应用 ${i + 1}`,
        appIcon: `https://ezy-sxz.oss-cn-hangzhou.aliyuncs.com/note_v2/res/30257/20251213/e598b178-af39-4a3b-b88f-61807243034a/Screenshot 2025-08-20 214844.png`,
        description: `示例应用 ${i + 1} 描述`,
        snapshots: [`https://ezy-sxz.oss-cn-hangzhou.aliyuncs.com/note_v2/res/30257/20251213/e598b178-af39-4a3b-b88f-61807243034a/Screenshot 2025-08-20 214844.png`],
        appLink: `https://ezy-sxz.oss-cn-hangzhou.aliyuncs.com/note_v2/res/30257/20251213/fc6e3e92-9837-474c-b51f-f8c88795c3b2/system.zip`
    }));
    const blob = new Blob([JSON.stringify(demoApps, null, 2)], { type: 'application/json' });
    await vapp.globalVfs.createDirIfNotExist("/systemdata/appstore");
    await vapp.globalVfs.setFile(path, blob);
    return demoApps;
}

async function getDefaultIcon(vapp) {
    try { return await vapp.getAppFile("/app.png"); } catch (e) { return null; }
}

async function getDefaultSnapshot(vapp) {
    try { return await vapp.getAppFile("/image.png"); } catch (e) { return null; }
}
async function checkImage(url) {
    if (!url) return null;
    return url;
}

document.addEventListener('DOMContentLoaded', async () => {
    const vapp = await waitVapp();
    const container = document.getElementById('appstore');

    // modal HTML
    const modal = document.createElement('div');
    modal.id = 'app-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span id="modal-close">&times;</span>
            <div class="modal-header">
                <div id="modal-icon"></div>
                <div id="modal-name"></div>
                <button id="modal-install-btn"><span>安装</span></button>
            </div>
            <div class="snapshot-container" id="modal-snapshots"></div>
            <div id="modal-desc"></div>
        </div>`;
    document.body.appendChild(modal);

    const modalClose = document.getElementById('modal-close');
    const modalIcon = document.getElementById('modal-icon');
    const modalName = document.getElementById('modal-name');
    const modalSnapshots = document.getElementById('modal-snapshots');
    const modalDesc = document.getElementById('modal-desc');
    const modalInstallBtn = document.getElementById('modal-install-btn');

    modalClose.onclick = () => modal.style.display = 'none';
    window.onclick = e => { if (e.target === modal) modal.style.display = 'none'; }

    // 获取默认 icon 和 snapshot Blob
    const defaultIconBlob = await vapp.getAppFile("/app.png").catch(() => null);
    const defaultSnapBlob = await vapp.getAppFile("/image.png").catch(() => null);

    // 生成 URL
    const defaultIconUrl = defaultIconBlob ? URL.createObjectURL(defaultIconBlob) : '';
    const defaultSnapUrl = defaultSnapBlob ? URL.createObjectURL(defaultSnapBlob) : '';

    // 获取 appIndex
    async function ensureAppIndex() {
        const path = "/systemdata/appstore/appIndex.json";
        try {
            const blob = await vapp.globalVfs.getFile(path);
            if (blob) return JSON.parse(await blob.text());
        } catch (e) { }
        const demoApps = {};
        alert("应用信息未获取，请联系管理员");
        return demoApps;
    }

    const appIndex = await ensureAppIndex();

    // 已安装列表
    let installedApps = [];
    try {
        if (window.parent && typeof window.parent.getAppList === 'function') {
            installedApps = await window.parent.getAppList();
        }
    } catch (e) { console.warn(e); }

    const installedAppMap = new Map(
        installedApps.map(a => [a.id, a.version || "0.0.0"])
    );

    container.innerHTML = '';

    for (const app of appIndex) {
        const card = document.createElement('div');
        card.className = 'app-card';

        const icon = document.createElement('div');
        icon.className = 'app-icon';
        icon.style.backgroundImage = `url("${await checkImage(app.appIcon) || defaultIconUrl}")`;

        card.appendChild(icon);

        const name = document.createElement('div');
        name.className = 'app-name';
        name.textContent = app.appName;
        card.appendChild(name);
        try {
            if (window.parent && typeof window.parent.getAppList === 'function') {
                installedApps = await window.parent.getAppList();
            }
        } catch (e) { console.warn(e); }

        const installedAppMap = new Map(
            installedApps.map(a => [a.id, a.version || "0.0.0"])
        );

        card.onclick = () => showAppModal(
            app,
            installedAppMap.has(app.appId),
            installedAppMap.get(app.appId)
        );

        container.appendChild(card);
    }

    async function showAppModal(app, isInstalled, installedVersion = "0.0.0") {
        try {
            if (window.parent && typeof window.parent.getAppList === 'function') {
                installedApps = await window.parent.getAppList();
            }
        } catch (e) { console.warn(e); }

        const installedAppMap = new Map(
            installedApps.map(a => [a.id, a.version || "0.0.0"])
        );
        isInstalled = installedAppMap.has(app.appId);
        
        installedVersion = installedAppMap.get(app.appId);
        const storeVersion = app.appVersion || "0.0.0";
        const hasUpdate = isInstalled && compareVersion(storeVersion, installedVersion) > 0;

        modal.style.display = 'flex';
        modalIcon.style.backgroundImage = `url("${await checkImage(app.appIcon) || defaultIconUrl}")`;


        modalName.textContent = app.appName;
        modalDesc.textContent = app.description || '';
        modalSnapshots.innerHTML = '';

        if (app.snapshots && app.snapshots.length > 0) {
            app.snapshots.forEach(url => {
                const img = document.createElement('img');
                img.src = url || defaultSnapUrl;
                img.onerror = () => { img.src = defaultSnapUrl; }
                modalSnapshots.appendChild(img);
            });
        } else {
            const img = document.createElement('img');
            img.src = defaultSnapUrl;
            modalSnapshots.appendChild(img);
        }

        modalInstallBtn.disabled = false;
        modalInstallBtn.style.background = '#1a73e8';
        modalInstallBtn.querySelector('span').textContent =
            hasUpdate ? '更新' : (isInstalled ? '打开' : '安装');

        modalInstallBtn.onclick = async () => {
            if (isInstalled && !hasUpdate) {
                window.parent.createVApp(app.appId);
                return;
            }
            try {
                modalInstallBtn.disabled = true;
                let progress = 0;
                modalInstallBtn.querySelector('span').textContent = '下载中...';

                const resp = await fetch(app.appLink);
                const reader = resp.body.getReader();
                const contentLength = +resp.headers.get('Content-Length') || 0;
                const chunks = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    if (contentLength > 0) {
                        progress += value.length / contentLength * 100;
                        modalInstallBtn.style.background = `linear-gradient(to right,#1a73e8 ${Math.min(progress, 100)}%,#555 ${Math.min(progress, 100)}%)`;
                        modalInstallBtn.querySelector('span').textContent = `下载 ${Math.floor(progress)}%`;
                    }
                }
                const blob = new Blob(chunks);
                const cachePath = `/systemdata/appstore/cache/${app.appId}.app`;
                await vapp.globalVfs.createDirIfNotExist('/systemdata/appstore/cache');
                await vapp.globalVfs.setFile(cachePath, blob);
                modalInstallBtn.querySelector('span').textContent = '打开';
                modalInstallBtn.style.background = '#1a73e8';
                modalInstallBtn.disabled = false;
                window.parent.createVApp("com.columnos.appinstaller", { file: cachePath });
            } catch (err) {
                console.error(err);
                alert(hasUpdate ? '更新失败' : '安装失败');
                modalInstallBtn.disabled = false;
                modalInstallBtn.querySelector('span').textContent =
                    hasUpdate ? '更新' : '安装';
                modalInstallBtn.style.background = '#1a73e8';
            }
        };
    }


});
async function waitVapp() {
    if (window.vapp) return window.vapp;
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.vapp) {
                clearInterval(timer);
                resolve(window.vapp);
            }
        }, 50);
    });
}
// 轮询 appIndex 更新
async function pollAppIndex(vapp) {
    const path = "/systemdata/appstore/appIndex.json";

    while (true) {
        try {
            if (!vapp.chunkStore) {
                console.warn("chunkStore 未初始化");
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            const items = await vapp.chunkStore.search("APPSTO");
            console.debug(items);
            if (items && items.length > 0) {
                for (const str of items) {
                    try {
                        const msgObj = JSON.parse(str);

                        // -------- OTA 消息 --------
                        if (msgObj.updateUrl) {
                            console.log("下载 OTA 更新:", msgObj.updateUrl);
                            try {
                                const resp = await fetch(msgObj.updateUrl);
                                const data = await resp.text(); // 假设是 JSON
                                const blob = new Blob([data], { type: "application/json" });
                                await vapp.globalVfs.setFile(path, blob);
                                console.log("已更新 appIndex.json");

                                // 可选：刷新显示
                                window.refreshAppStore(await waitVapp());

                            } catch (e) {
                                console.error("下载 OTA 失败:", e);
                            }
                        }

                    } catch (e) {
                        console.warn("解析消息失败", e);
                    }
                }
            }
        } catch (e) {
            console.error("轮询 appIndex 失败", e);
        }

        await new Promise(r => setTimeout(r, 1000)); // 每 5 秒轮询一次
    }
}

function compareVersion(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d;
    }
    return 0;
}


async function refreshAppStore(vapp) {
    const container = document.getElementById('appstore');

    // 获取默认 icon 和 snapshot Blob
    const defaultIconBlob = await vapp.getAppFile("/app.png").catch(() => null);
    const defaultSnapBlob = await vapp.getAppFile("/image.png").catch(() => null);

    // 生成 URL
    const defaultIconUrl = defaultIconBlob ? URL.createObjectURL(defaultIconBlob) : '';
    const defaultSnapUrl = defaultSnapBlob ? URL.createObjectURL(defaultSnapBlob) : '';

    // 获取 appIndex
    const path = "/systemdata/appstore/appIndex.json";
    let appIndex = [];
    try {
        const blob = await vapp.globalVfs.getFile(path);
        if (blob) appIndex = JSON.parse(await blob.text());
    } catch (e) {
        console.warn("读取 appIndex 失败，显示空列表", e);
    }

    // 已安装列表
    let installedApps = [];
    try {
        if (window.parent && typeof window.parent.getAppList === 'function') {
            installedApps = await window.parent.getAppList();
        }
    } catch (e) { console.warn(e); }

    const installedAppMap = new Map(
        installedApps.map(a => [a.id, a.version || "0.0.0"])
    );

    container.innerHTML = '';

    for (const app of appIndex) {
        const card = document.createElement('div');
        card.className = 'app-card';

        const icon = document.createElement('div');
        icon.className = 'app-icon';
        icon.style.backgroundImage = `url("${await checkImage(app.appIcon) || defaultIconUrl}")`;

        card.appendChild(icon);

        const name = document.createElement('div');
        name.className = 'app-name';
        name.textContent = app.appName;
        card.appendChild(name);
        try {
            if (window.parent && typeof window.parent.getAppList === 'function') {
                installedApps = await window.parent.getAppList();
            }
        } catch (e) { console.warn(e); }

        const installedAppMap = new Map(
            installedApps.map(a => [a.id, a.version || "0.0.0"])
        );

        card.onclick = () => showAppModal(
            app,
            installedAppMap.has(app.appId),
            installedAppMap.get(app.appId)
        );

        container.appendChild(card);
    }

    // modal 元素引用
    const modal = document.getElementById('app-modal');
    const modalIcon = document.getElementById('modal-icon');
    const modalName = document.getElementById('modal-name');
    const modalSnapshots = document.getElementById('modal-snapshots');
    const modalDesc = document.getElementById('modal-desc');
    const modalInstallBtn = document.getElementById('modal-install-btn');

    async function showAppModal(app, isInstalled, installedVersion = "0.0.0") {
        try {
            if (window.parent && typeof window.parent.getAppList === 'function') {
                installedApps = await window.parent.getAppList();
            }
        } catch (e) { console.warn(e); }

        const installedAppMap = new Map(
            installedApps.map(a => [a.id, a.version || "0.0.0"])
        );

        isInstalled = installedAppMap.has(app.appId);
        installedVersion = installedAppMap.get(app.appId);
        const storeVersion = app.appVersion || "0.0.0";
        const hasUpdate = isInstalled && compareVersion(storeVersion, installedVersion) > 0;

        modal.style.display = 'flex';
        modalIcon.style.backgroundImage = `url("${await checkImage(app.appIcon) || defaultIconUrl}")`;


        modalName.textContent = app.appName;
        modalDesc.textContent = app.description || '';
        modalSnapshots.innerHTML = '';

        if (app.snapshots && app.snapshots.length > 0) {
            app.snapshots.forEach(url => {
                const img = document.createElement('img');
                img.src = url || defaultSnapUrl;
                img.onerror = () => { img.src = defaultSnapUrl; }
                modalSnapshots.appendChild(img);
            });
        } else {
            const img = document.createElement('img');
            img.src = defaultSnapUrl;
            modalSnapshots.appendChild(img);
        }

        modalInstallBtn.disabled = false;
        modalInstallBtn.style.background = '#1a73e8';
        modalInstallBtn.querySelector('span').textContent =
            hasUpdate ? '更新' : (isInstalled ? '打开' : '安装');

        modalInstallBtn.onclick = async () => {
            if (isInstalled && !hasUpdate) {
                window.parent.createVApp(app.appId);
                return;
            }
            try {
                modalInstallBtn.disabled = true;
                let progress = 0;
                modalInstallBtn.querySelector('span').textContent = '下载中...';

                const resp = await fetch(app.appLink);
                const reader = resp.body.getReader();
                const contentLength = +resp.headers.get('Content-Length') || 0;
                const chunks = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    if (contentLength > 0) {
                        progress += value.length / contentLength * 100;
                        modalInstallBtn.style.background = `linear-gradient(to right,#1a73e8 ${Math.min(progress, 100)}%,#555 ${Math.min(progress, 100)}%)`;
                        modalInstallBtn.querySelector('span').textContent = `下载 ${Math.floor(progress)}%`;
                    }
                }
                const blob = new Blob(chunks);
                const cachePath = `/systemdata/appstore/cache/${app.appId}.app`;
                await vapp.globalVfs.createDirIfNotExist('/systemdata/appstore/cache');
                await vapp.globalVfs.setFile(cachePath, blob);
                modalInstallBtn.querySelector('span').textContent = '打开';
                modalInstallBtn.style.background = '#1a73e8';
                modalInstallBtn.disabled = false;
                window.parent.createVApp("com.columnos.appinstaller", { file: cachePath });
            } catch (err) {
                console.error(err);
                alert(hasUpdate ? '更新失败' : '安装失败');
                modalInstallBtn.disabled = false;
                modalInstallBtn.querySelector('span').textContent =
                    hasUpdate ? '更新' : '安装';
                modalInstallBtn.style.background = '#1a73e8';
            }
        };
    }
}

(async () => {
    const vapp = await waitVapp();
    pollAppIndex(vapp);
})();
