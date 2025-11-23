(function () {
    // 从 URL 获取 apiHost 参数
    const params = new URLSearchParams(window.location.search);
    const apiHost = params.get('apiHost');

    if (apiHost) {
        window.apiHost = apiHost;
        console.log("window.apiHost 已设置为:", window.apiHost);
    } else {
        console.warn("URL 中没有找到 apiHost 参数");
    }
})();

let aeskey = () => {
    var e = ":F0wKU!Qg3}UkbW+w[:9|D3-5h=:T;7t#_GZ4#G;~ZNSq{8;}QIP>'{q.lje",
        t = new Date,
        n = t.getFullYear(),
        r = t.getMonth() + 1,
        o = t.getDate(),
        i = 33 + o * r * 33,
        a = String.fromCharCode(i % 94 + 33),
        s = e[o + r],
        c = n * r * o % e.length,
        u = e.substring(0, c),
        l = e.substring(c),
        f = (l + u).substring(0, 14);
    return "".concat(a).concat(f).concat(s)
}

window.key = CryptoJS.enc.Utf8.parse(aeskey());
window.aesDecrypt = (encryptedBase64Str) => {
    if (!encryptedBase64Str)
        return "";
    try {
        let decryptedData = CryptoJS.AES.decrypt(encryptedBase64Str, key, {
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7
        });
        return decryptedData.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        console.log(e);
    }
};
window.aesEncrypt = (data) => {
    let encryptedData = CryptoJS.AES.encrypt(data, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
    });
    return encryptedData.toString();
};

async function getInbox() {
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
        const resp = await fetch(`${apiHost}/CloudNotes/api/Notes/GetAll`, {
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
    const inbox = notesData.noteList.find(n => n.fileUrl === "ColumnOS Push Service Inbox" && n.type === 0);
    if (inbox) {
        window.inboxId = inbox.fileId;
        return inbox.fileId;
    }

    // 5. 如果没有找到，调用 createInbox()
    try {
        const newInboxId = await createInbox();
        window.inboxId = newInboxId;
        return newInboxId;
    } catch (e) {
        console.error("创建 Inbox 失败", e);
        return null;
    }
}
async function createInbox() {
    if (!window.inboxId) window.inboxId = null;

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
        fileName: "ColumnOS Push Service Inbox",
        fileUrl: "ColumnOS Push Service Inbox",
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
            window.inboxId = fileId;
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
async function readInbox() {
    if (!window.inboxId) {
        console.error("readInbox: window.inboxId 为空，你需要先 createInbox()");
        return [];
    }

    const info = await window.initLogin();
    if (!info) return [];

    const token = await window.getToken();
    if (!token) return [];

    // 构造查询参数
    const queryObj = {
        parentid: window.inboxId,
        isNoteNode: true,
        timestamp: Date.now()
    };

    const encryptedQuery = window.aesEncrypt(
        Object.entries(queryObj)
            .map(([k, v]) => `${k}=${v}`)
            .join("&")
    );

    const url = `${info.apiHost}/CloudNotes/api/Notes/GetByParentId?${encryptedQuery}`;

    // 请求数据
    let resp;
    try {
        resp = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
    } catch (e) {
        console.error("readInbox 请求错误:", e);
        return [];
    }

    const json = await resp.json();
    if (json.code !== 0) {
        console.error("readInbox 返回错误:", json);
        return [];
    }

    let decrypted;
    try {
        decrypted = JSON.parse(window.aesDecrypt(json.data));
    } catch (e) {
        console.error("readInbox 解密失败:", e);
        return [];
    }

    // noteList
    const list = decrypted.noteList || [];

    // 过滤 type = 0
    const toProcess = list.filter(x => x.type === 0);

    const results = [];

    for (const item of toProcess) {
        const str = item.fileName + item.fileUrl;
        results.push(str);

        // ============ 删除部分 =============

        // 待删除的 fileId 数组，并加密
        const deletePayload = window.aesEncrypt(JSON.stringify([item.fileId]));

        try {
            await fetch(`${info.apiHost}/CloudNotes/api/Notes/Delete`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: deletePayload
            });
        } catch (e) {
            console.error("删除失败:", e);
        }
    }

    return results;
}
async function pushToInbox(text, id6, token, apiHost) {
    if (!window.chunk) {
        console.error("缺少 window.chunk(text,id6) 函数！");
        return false;
    }
    if (!text || !id6 || !token || !apiHost) {
        console.error("参数不完整");
        return false;
    }

    // ------------------- 内部函数: 获取或创建 Inbox -------------------
    async function getOrCreateInbox(token, apiHost) {
        try {
            // 获取笔记列表
            const resp = await fetch(`${apiHost}/CloudNotes/api/Notes/GetAll`, {
                method: "GET",
                headers: { "Authorization": `Bearer ${token}` }
            });
            const result = await resp.json();
            if (result.code !== 0 || !result.data) return null;

            const notesData = JSON.parse(window.aesDecrypt(result.data));
            const inbox = notesData.noteList.find(n => n.fileUrl === "ColumnOS Push Service Inbox" && n.type === 0);
            if (inbox) return inbox.fileId;

            // 没找到则创建
            const newId = Array.from({ length: 32 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join('');
            const payload = {
                fileId: newId,
                fileName: "ColumnOS Push Service Inbox",
                fileUrl: "ColumnOS Push Service Inbox",
                parentId: "0",
                type: "0"
            };
            const encrypted = window.aesEncrypt(JSON.stringify(payload));

            const createResp = await fetch(`${apiHost}/CloudNotes/api/Notes/AddOrUpdate`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: encrypted
            }).then(r => r.json());

            if (createResp.code === 0) return newId;
            return null;
        } catch (e) {
            console.error("获取或创建 Inbox 失败", e);
            return null;
        }
    }

    const inboxId = await getOrCreateInbox(token, apiHost);
    if (!inboxId) {
        console.error("无法获取或创建 Inbox");
        return false;
    }

    // ------------------- 上传 chunk -------------------
    const items = window.chunk(text, id6);
    if (!Array.isArray(items) || items.length === 0) {
        console.warn("chunk 为空");
        return false;
    }

    const randomId = (len = 32) => Array.from({ length: len }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join('');

    for (const block of items) {
        let part1 = block;
        let part2 = "";

        if (block.length > 255) {
            part1 = block.substring(0, 255);
            part2 = block.substring(255);
        }

        const payload = {
            fileId: randomId(),
            fileName: part1,
            fileUrl: part2,
            parentId: inboxId,
            type: "0"
        };

        const encrypted = window.aesEncrypt(JSON.stringify(payload));

        const resp = await fetch(`${apiHost}/CloudNotes/api/Notes/AddOrUpdate`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: encrypted
        }).then(r => r.json()).catch(e => ({ code: -1, error: e }));

        if (resp.code !== 0) console.error("子节点上传失败:", resp);
        else console.log("子节点上传成功:", payload.fileId);
    }

    return true;
}
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function getPush() {
    while (true) {
        const start = Date.now();

        const items = await readInbox();
        for (const item of items) {
            console.log("收到推送分段:", item);
            await chunkStore.inbox(item);
        }

        const cost = Date.now() - start;
        if (cost < 500) {
            await sleep(500 - cost);
        }
    }
}