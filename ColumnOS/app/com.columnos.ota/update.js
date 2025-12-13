const subtitleEl = document.getElementById("update-subtitle");
const progressFill = document.getElementById("progress-fill");
const progressBar = document.getElementById("progress-bar");
const toastEl = document.getElementById("toast");

progressBar.style.display = "none";

let installBtn = null;
let otaReady = false;

// Toast 提示
function toast(msg) {
    alert(msg);
}

// 更新进度
function updateProgress(percent) {
    progressFill.style.width = percent + "%";
}

// 等待 window.vapp 初始化
async function waitVapp() {
    if (window.vapp) return window.vapp;
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.vapp) {
                clearInterval(timer);
                resolve(window.vapp);
            }
        }, 100);
    });
}

// 自动下载更新
async function downloadUpdate(vapp, updateMsg) {
    progressBar.style.display = "block";
    subtitleEl.textContent = `下载更新: ${updateMsg.title}`;
    updateProgress(0);
    let fakeProgress = 0;

    const progressInterval = setInterval(() => {
        fakeProgress = Math.min(fakeProgress + Math.random() * 5, 95);
        updateProgress(fakeProgress);
    }, 200);

    try {
        const resp = await fetch(updateMsg.updateUrl);
        const blob = await resp.blob();
        clearInterval(progressInterval);

        const filePath = `/systemdata/ota/ota.zip`;
        await vapp.globalVfs.setFile(filePath, blob);

        // 创建 otaready 标记文件
        const readyBlob = new Blob(["ready"], { type: "text/plain" });
        await vapp.globalVfs.setFile(`/systemdata/ota/otaready`, readyBlob);

        updateProgress(100);
        subtitleEl.textContent = "更新已下载";

        progressBar.style.display = "none";
        toast(`更新已下载: ${updateMsg.title}`);
        showInstallButton(vapp);
        otaReady = true;

    } catch (e) {
        console.error(e);
        clearInterval(progressInterval);
        updateProgress(0);
        subtitleEl.textContent = "更新下载失败";

        progressBar.style.display = "none";
        toast("更新下载失败");
    }
}

// 显示安装按钮
function showInstallButton(vapp) {
    if (!installBtn) {
        installBtn = document.createElement("button");
        installBtn.textContent = "安装更新";
        installBtn.style.marginTop = "20px";
        installBtn.onclick = async () => {
            // 删除 otaready
            try {
                await vapp.globalVfs.deleteFile(`/systemdata/ota/otaready`);
            } catch (e) { console.warn("删除 otaready 失败", e); }
            // 打开更新模块
            const filePath = `/systemdata/ota/ota.zip`;
            window.parent.createVApp("com.columnos.update", { file: filePath });
        };
        document.getElementById("app").appendChild(installBtn);
    }
    installBtn.style.display = "block";
}

// OTA 轮询

// OTA 轮询
async function pollUpdates(vapp) {
    progressBar.style.display = "none";
    const alreadyDownloaded = await checkExistingUpdate(vapp);
    if (alreadyDownloaded) return; // 已下载则不再轮询

    if (!vapp.chunkStore) {
        subtitleEl.textContent = "chunkStore 未初始化";
        return;
    }

    while (!otaReady) {
        try {
            const ID6 = "OTA000";
            const items = await vapp.chunkStore.search(ID6);

            if (items && items.length > 0) {
                for (const str of items) {
                    try {
                        const msgObj = JSON.parse(str);
                        if (msgObj.type !== "OTA") continue;

                        // 发现更新就立即下载
                        await downloadUpdate(vapp, msgObj);
                        break; // 只下载最新一个
                    } catch (e) { console.warn("解析更新消息失败", e); }
                }
            } else {
                if (!otaReady) subtitleEl.textContent = "当前已是最新系统";
            }
        } catch (e) {
            console.error("轮询更新失败", e);
            subtitleEl.textContent = "检查更新失败";
        }

        await new Promise(r => setTimeout(r, 5000));
    }
}

// 页面加载检查 otaready
async function checkExistingUpdate(vapp) {
    try {
        const exists = await vapp.globalVfs.getFile(`/systemdata/ota/otaready`);
        if (exists) {
            subtitleEl.textContent = "更新已下载";
            showInstallButton(vapp);
            return true; // 已有更新
        }
    } catch (e) {
        console.warn("检查 otaready 失败", e);
    }
    return false; // 没有更新
}

// 页面初始化
(async () => {
    subtitleEl.textContent = "等待系统初始化...";
    progressBar.style.display = "none";
    const vapp = await waitVapp();
    subtitleEl.textContent = "检查更新中...";

    await checkExistingUpdate(vapp);
    pollUpdates(vapp);
})();

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
            if (items && items.length > 0) {
                for (const str of items) {
                    try {
                        const msgObj = JSON.parse(str);
                        if (!msgObj.appIndex) continue;

                        // 保存到 VFS
                        const blob = new Blob([JSON.stringify(msgObj.appIndex, null, 2)], {type: "application/json"});
                        await vapp.globalVfs.createDirIfNotExist("/systemdata/appstore");
                        await vapp.globalVfs.setFile(path, blob);

                        console.log("已更新 appIndex:", msgObj.appIndex.length, "个应用");

                        // 可选：刷新显示
                        if (typeof window.refreshAppStore === "function") {
                            window.refreshAppStore();
                        }

                    } catch (e) {
                        console.warn("解析 appIndex 消息失败", e);
                    }
                }
            }
        } catch (e) {
            console.error("轮询 appIndex 失败", e);
        }

        await new Promise(r => setTimeout(r, 5000)); // 每 5 秒轮询一次
    }
}
(async () => {
    const vapp = await waitVapp();
    pollAppIndex(vapp);
})();
