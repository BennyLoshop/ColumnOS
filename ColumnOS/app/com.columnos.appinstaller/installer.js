(async function() {
    const selectBtn = document.getElementById("select-file-btn");
    const fileInput = document.getElementById("update-file");
    const statusEl = document.getElementById("status");

    // 等待 vapp 全局初始化完成
    while (!window.vappok) {
        await new Promise(r => setTimeout(r, 100));
    }

    // 获取 file 参数
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

    // 点击选择文件触发 input
    selectBtn.onclick = () => fileInput.click();

    fileInput.onchange = async () => {
        if (!fileInput.files[0]) return;
        zipFile = fileInput.files[0];
        await installZip(zipFile);
    };

    // 如果自动 file 参数存在，直接安装
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
            const appDir = `/app/${manifestJson.appId}`;

            statusEl.innerText = "创建应用目录...";
            await window.vapp.globalVfs.createDir(appDir);

            const files = Object.entries(zip.files);
            for (let i = 0; i < files.length; i++) {
                const [fileName, fileObj] = files[i];
                if (fileObj.dir) continue;
                const blob = await fileObj.async("blob");
                await window.vapp.globalVfs.setFile(`${appDir}/${fileName}`, blob);
                statusEl.innerText = `解压中: ${fileName} (${i+1}/${files.length})`;
            }

            statusEl.innerText = "更新系统应用清单...";
            if (window.parent && typeof window.parent.installApp === "function") {
                await window.parent.installApp(`${appDir}/appManifest.json`);
            } else {
                throw new Error("父页面 installApp 未找到");
            }

            statusEl.innerText = `应用 "${manifestJson.appName}" 安装完成！`;
        } catch (err) {
            console.error(err);
            statusEl.innerText = "安装失败: " + err.message;
        }
    }
})();
