(async function () {
    const statusEl = document.getElementById("status");
    const appNameEl = document.getElementById("app-name");
    const appIconEl = document.getElementById("app-icon");
    // 假设 manifestJson 已经读取，appDir 已存在
    const btnDone = document.getElementById("btn-done");
    const btnOpen = document.getElementById("btn-open");

    // 安装过程中禁用“打开”
    btnOpen.disabled = true;
    btnOpen.style.opacity = "0.5";
    btnDone.disabled = true;
    btnDone.style.opacity = "0.5";

    // 绑定完成按钮
    btnDone.addEventListener("click", () => {
        if (window.vapp && typeof window.vapp.exit === "function") {
            window.vapp.exit();
        }
    });

    // 绑定打开按钮



    while (!window.vappok) {
        await new Promise(r => setTimeout(r, 100));
    }

    let zipFile = null;
    const fileParam = window.vapp?.params?.file;
    if (fileParam) {
        try {
            statusEl.innerText = "读取自动传入文件...";
            zipFile = await window.vapp.globalVfs.getFile(fileParam);
            if (!zipFile) throw new Error("vapp.globalVfs 未找到文件: " + fileParam);
        } catch (err) {
            console.error(err);
            statusEl.innerText = "读取文件失败: " + err.message;
        }
    }

    if (zipFile) {
        await installZip(zipFile);
    }

    async function installZip(zipFile) {
        try {
            statusEl.innerText = "获取父页面 JSZip...";
            const JSZip = window.parent.JSZip;
            if (!JSZip) throw new Error("父页面 JSZip 未找到");

            statusEl.innerText = "读取 ZIP 文件...";
            const zip = await JSZip.loadAsync(zipFile);

            const manifestFile = zip.file("appManifest.json");
            if (!manifestFile) throw new Error("ZIP 中未找到 appManifest.json");

            const manifestText = await manifestFile.async("text");
            const manifestJson = JSON.parse(manifestText);

            // 显示应用名称和图标
            appNameEl.innerText = manifestJson.appName || "未知应用";
            console.log(manifestJson.appIcon);
            if (manifestJson.appIcon) {
                try {
                    // 去掉开头的 /
                    let iconPath = manifestJson.appIcon.replace(/^\/+/, '');
                    const iconFile = zip.file(iconPath);
                    if (iconFile) {
                        const blob = await iconFile.async("blob");
                        appIconEl.src = URL.createObjectURL(blob);
                    }
                } catch (e) {
                    console.warn("加载图标失败", e);
                }
            }


            const appDir = `/app/${manifestJson.appId}`;
            statusEl.innerText = "创建应用目录...";
            await window.vapp.globalVfs.createDir(appDir);

            const files = Object.entries(zip.files);
            for (let i = 0; i < files.length; i++) {
                const [fileName, fileObj] = files[i];
                if (fileObj.dir) continue;
                const blob = await fileObj.async("blob");
                await window.vapp.globalVfs.setFile(`${appDir}/${fileName}`, blob);
                statusEl.innerText = `解压中: ${fileName} (${i + 1}/${files.length})`;
            }

            statusEl.innerText = "更新系统应用清单...";
            if (window.parent && typeof window.parent.installApp === "function") {
                await window.parent.installApp(`${appDir}/appManifest.json`);
            } else {
                throw new Error("父页面 installApp 未找到");
            }
            btnOpen.addEventListener("click", () => {
                if (window.parent && typeof window.parent.createVApp === "function") {
                    window.parent.createVApp(manifestJson.appId);
                }
            });

            statusEl.innerText = `应用 "${manifestJson.appName}" 安装完成！`;
            btnOpen.disabled = false;
            btnOpen.style.opacity = "1";
            btnDone.disabled = false;
            btnDone.style.opacity = "1";
        } catch (err) {
            console.error(err);
            statusEl.innerText = "安装失败: " + err.message;
        }
    }
})();
