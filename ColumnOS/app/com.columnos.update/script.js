
const selectFileBtn = document.getElementById('select-file-btn');
const updateBtn = document.getElementById('update-btn');
const updateFileInput = document.getElementById('update-file');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('update-log');

let zipFile = null;
let bootJson = null;

// 父页面 VFS 与 Utils
const globalVfs = window.parent.globalVfs;
const globalUtils = window.parent.globalUtils;
window.addEventListener('DOMContentLoaded', () => {
    const waitForVappOk = async () => {
        while (!window.vappok) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (window.vappok) {
            const filePath = window.vapp.params?.file;

            if (filePath) {
                try {
                    statusEl.innerText = "正在安装更新...";
                    updateBtn.disabled = true;
                    selectFileBtn.style.display = "none";

                    try {

                        // 删除旧系统
                        await globalVfs.deleteDir("/system");

                        // 使用父页面的旧解压函数
                        await globalUtils.unzipFile(filePath, "/");

                        await globalUtils.unzipFile("/system.zip", "/system");


                        // 删除临时 zip
                        await globalVfs.deleteFile("/system.zip");

                        statusEl.innerText = "更新完成，刷新页面应用新版本";

                        // 隐藏其他按钮
                        updateBtn.style.display = "none";
                        selectFileBtn.style.display = "none";

                        const btnReload = document.createElement("button");
                        btnReload.innerText = "刷新";
                        btnReload.onclick = () => window.top.location.reload();
                        document.querySelector(".btn-container").appendChild(btnReload);

                    } catch (err) {
                        console.error(err);
                        statusEl.innerText = "安装失败: " + err.message;
                    }


                } catch (e) {
                    console.error("自动打开文件失败:", e);
                    showToast("无法打开指定文件");
                    openFileBtn.disabled = false;
                }
            }
        } else {
        }

    };
    waitForVappOk();
});


    // 选择文件
    selectFileBtn.onclick = () => updateFileInput.click();

    updateFileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        zipFile = file;
        statusEl.innerText = "读取更新文件中...";

        try {
            const JSZip = window.parent.JSZip;
            const arrayBuffer = await file.arrayBuffer();
            const zip = await JSZip.loadAsync(arrayBuffer);

            if (!zip.file("boot.json")) {
                statusEl.innerText = "更新包缺少 boot.json";
                return;
            }

            const bootText = await zip.file("boot.json").async("string");
            bootJson = JSON.parse(bootText);

            logEl.innerText = `版本: ${bootJson.versionName}\n更新内容:\n${bootJson.updateLog}`;
            logEl.style.display = "block";
            statusEl.innerText = "检测到更新";
            updateBtn.style.display = "inline-block";

        } catch (err) {
            console.error(err);
            statusEl.innerText = "读取更新文件失败: " + err.message;
        }
    };

    // 安装更新
    updateBtn.onclick = async () => {
        if (!zipFile || !bootJson) return;

        statusEl.innerText = "正在安装更新...";
        updateBtn.disabled = true;
        selectFileBtn.style.display = "none";

        try {
            const arrayBuffer = await zipFile.arrayBuffer();
            const zipBlob = new Blob([arrayBuffer], { type: "application/zip" });
            await globalVfs.setFile("/system.zip", zipBlob);

            // 删除旧系统
            await globalVfs.deleteDir("/system");

            // 使用父页面的旧解压函数
            await globalUtils.unzipFile("/system.zip", "/");

            await globalUtils.unzipFile("/system.zip", "/system");


            // 删除临时 zip
            await globalVfs.deleteFile("/system.zip");

            statusEl.innerText = "更新完成，刷新页面应用新版本";

            // 隐藏其他按钮
            updateBtn.style.display = "none";
            selectFileBtn.style.display = "none";

            const btnReload = document.createElement("button");
            btnReload.innerText = "刷新";
            btnReload.onclick = () => window.top.location.reload();
            document.querySelector(".btn-container").appendChild(btnReload);

        } catch (err) {
            console.error(err);
            statusEl.innerText = "安装失败: " + err.message;
        }
    };
