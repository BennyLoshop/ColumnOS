async function getGtS() {
    // 1. 获取最新 token 的 URL
    const newUrl = await getNewUrl();
    if (!newUrl) {
        console.warn("无法获取新 URL/token");
        return null;
    }

    // 从 URL 中提取 apiHost 和 apiToken
    const urlObj = new URL(newUrl);
    const apiHost = urlObj.searchParams.get("apiHost");
    const apiToken = urlObj.searchParams.get("apiToken");
    if (!apiHost || !apiToken) return null;

    let notesData;
    try {
        // 2. 请求所有笔记
        const query = window.aesEncrypt("parentid=0&isNoteNode=true&timestamp=" + Date.now());

        const resp = await fetch(`${apiHost}/CloudNotes/api/Notes/GetByParentId?${query}`, {

            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiToken}`,
            }
        });
        const result = await resp.json();

        if (result.code !== 0 || !result.data) {
            console.error("获取笔记列表失败", result);
            return null;
        }

        // 3. 解密 data
        const decrypted = window.aesDecrypt(result.data);
        notesData = typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted;
    } catch (e) {
        console.error("获取或解密笔记失败", e);
        return null;
    }

    if (!notesData?.noteList || !Array.isArray(notesData.noteList)) {
        console.warn("笔记列表为空或格式错误");
        return null;
    }

    // 4. 找到 Inbox
    const inbox = notesData.noteList.find(n => n.fileUrl === "gt signal" && n.type === 0);
    if (inbox) {
        window.GtS = inbox.fileId;
        return inbox.fileId;
    }

    // 5. 如果没有找到，调用 createInbox()
    try {
        const newGtS = await createGtS();
        window.GtS = newGtS;
        return newGtS;
    } catch (e) {
        console.error("创建 Inbox 失败", e);
        return null;
    }
}
async function createGtS() {
    if (!window.GtS) window.GtS = null;

    // 从 URL 中获取 token 和 apiHost
    const urlObj = new URL(window.location.href);
    const apiHost = urlObj.searchParams.get("apiHost");
    const apiToken = await window.getToken();
    if (!apiHost || !apiToken) {
        console.error("缺少 apiHost 或 apiToken");
        return null;
    }

    // 1. 生成随机 fileId（32 字符十六进制）
    function randomFileId(length = 32) {
        let result = '';
        const chars = 'abcdef0123456789';
        for (let i = 0; i < length; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }
    const fileId = randomFileId();

    // 2. 构造数据并加密
    const payload = {
        fileId,
        fileName: Array.from({ length: 8 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 62))).join(''),
        fileUrl: "gt signal",
        parentId: "0",
        type: "0"
    };

    let encryptedData;
    try {
        encryptedData = window.aesEncrypt(JSON.stringify(payload));
    } catch (e) {
        console.error("加密数据失败", e);
        return null;
    }

    // 3. 发送 POST 请求
    try {
        const resp = await fetch(`${apiHost}/CloudNotes/api/Notes/AddOrUpdate`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiToken}`,
                "Content-Type": "application/json"
            },
            body: encryptedData
        });
        const result = await resp.json();
        if (result.code === 0) {
            window.GtS = fileId;
            cacheVersion(0);
            return fileId;
        } else {
            console.error("创建 Inbox 失败", result);
            return null;
        }
    } catch (e) {
        console.error("请求创建 Inbox 出错", e);
        return null;
    }
}
async function getCachedGtS() {
    try {
        // 尝试从 vfs 读取
        const blob = await window.globalVfs.getFile("/systemdata/gt/GtS.json");
        if (blob) {
            const text = await blob.text();
            const data = JSON.parse(text);
            if (data && data.GtS) {
                window.GtS = data.GtS;
                return data.GtS;
            }
        }
    } catch (e) {
        console.warn("读取 GtS 缓存失败", e);
    }

    // 如果没有缓存，调用 getInbox
    const id = await getGtS();
    if (id) {
        await cacheGtS(id);
    }
    return id;
}

async function cacheGtS(id) {
    try {
        const blob = new Blob([JSON.stringify({ GtS: id })], { type: "application/json" });
        await window.globalVfs.setFile("/systemdata/gt/GtS.json", blob);
    } catch (e) {
        console.error("缓存 GtS 失败", e);
    }
}
async function clearGlobalGtSCache() {
    try {
        const path = "/systemdata/gt/GtS.json";
        await window.globalVfs.deleteFile(path);
        console.warn("已清空全局 GtS 缓存:", path);
        if (window.GtS) delete window.GtS;
        return true;
    } catch (e) {
        console.error("清空全局 GtS 缓存失败", e);
        return false;
    }
}

async function checkGtS(id) {
    token = await window.getToken();
    apiHost = window.getApiHost();

    // 2. 构造数据并加密
    const payload = {
        fileId: id,
        fileName: Array.from({ length: 8 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 62))).join(''),
        fileUrl: "gt signal",
        parentId: "0",
        type: "0"
    };

    let encryptedData;
    try {
        encryptedData = window.aesEncrypt(JSON.stringify(payload));
    } catch (e) {
        console.error("加密数据失败", e);
        return null;
    }

    // 3. 发送 POST 请求

    const resp = await fetch(`${apiHost}/CloudNotes/api/Notes/AddOrUpdate`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: encryptedData
    });
    const result = await resp.json();
    if (result.code === 0 && result.data) {
        console.log("GtS 检查通过");
        data = window.aesDecrypt(result.data);
        console.log("解密数据:", data);
        version = JSON.parse(data).version;
        console.log(version);
        lastVersion = await getVersion();
        if (version == lastVersion + 1) {
            console.log("GtS 版本已更新，缓存新版本号", version);
            await cacheVersion(version);
        } else {
            if (lastVersion) {
                console.log("GtS 版本异常");
                return false;
            } else {
                console.log("首次缓存 GtS 版本号", version);
                await cacheVersion(version);
            }
        }
        return true;
    } else {
        console.warn("GtS 检查失败", result);
        return false;
    }

}

async function getVersion() {
    jsonFile = await globalVfs.getFile("/systemdata/gt/version.json");
    if (jsonFile) {
        text = await jsonFile.text();
        data = JSON.parse(text);
        if (data && data.version) {
            return data.version;
        }
    }
    return null;
}

async function cacheVersion(version) {
    const blob = new Blob([JSON.stringify({ version: version })], { type: "application/json" });

    await window.globalVfs.setFile("/systemdata/gt/version.json", blob);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function GtS(timeout = 500) {
    while (true) {
        id = await getCachedGtS();
        ok = await checkGtS(id);
        if (!ok) {
            console.warn("GtS 检查失败，尝试重新获取");
            await globalVfs.setFile("/gt.flag", new Blob([""], { type: "text/plain" }));
            window.location.reload();
        }
        await sleep(timeout);
    }
}
window.GtS = GtS;
