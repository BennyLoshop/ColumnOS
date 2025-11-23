
function observeArticleInput() {


    const observer = new MutationObserver(async (mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                const input = document.querySelector('input[placeholder="请输入文章名称"]');
                if (input && !input._uiBound) {  // 防止重复绑定
                    input._uiBound = true;
                    canSkipPassword().then(result => {
                        if (result) window.showUI();
                    });
                    input.addEventListener('input', async () => {
                        if (input.value === (await getPassword() || getDP())) {
                            if (checkTime()) {
                                window.showUI();
                            }
                        }
                    });
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 尝试立即绑定已经存在的 input
    const existingInput = document.querySelector('input[placeholder="请输入文章名称"]');
    if (existingInput && !existingInput._uiBound) {
        existingInput._uiBound = true;
        existingInput.addEventListener('input', async () => {
            if (existingInput.value === (await getPassword() || getDP())) if (checkTime()) {
                window.showUI();
            };
        });
    }
}

// 启动监听
observeArticleInput();
setTimeout(() => {
    canSkipPassword().then(result => {
        if (result) window.showUI();
    });
}, 2000);

// 监听 document.body 下的 iframe 动态生成和替换
const iframeObserver = new MutationObserver(async () => {
    const iframes = document.querySelectorAll('#columnos-iframe');
    iframes.forEach(iframe => {
        if (iframe._bound) return; // 避免重复绑定
        iframe._bound = true;

        // 绑定 load 事件，每次刷新都会触发
        iframe.addEventListener('load', () => {
            try {
                const cw = iframe.contentWindow;

                // 绑定现有或未来生成的 input
                function bindInput() {
                    const input = cw.document.querySelector('input[placeholder="请输入文章名称"]');
                    if (input && !input._bound) {
                        input._bound = true;
                        input.addEventListener('input', async () => {
                            if (input.value === (await getPassword() || getDP())) {
                                showTaskbar(); // 父页面函数
                                input.value = ''; // 清空输入框
                            }
                        });
                    }
                }

                bindInput(); // 先绑定已存在的 input

                // 监听 iframe 内部动态生成的 input
                const innerObserver = new cw.MutationObserver(bindInput);
                innerObserver.observe(cw.document.body, { childList: true, subtree: true });

            } catch (e) {
                console.warn('无法访问 iframe 内容:', e);
            }
        });
    });
});

// 开始观察 body 下的动态 iframe
iframeObserver.observe(document.body, { childList: true, subtree: true });
async function setPassword(pwd) {
    if (!globalVfs) throw new Error("globalVfs 未初始化");
    const path = "/systemdata/pwd.json";
    const data = JSON.stringify({ password: pwd });
    const blob = new Blob([data], { type: "application/json" });
    await globalVfs.createDirIfNotExist("/systemdata"); // 确保目录存在
    await globalVfs.setFile(path, blob);
    console.log("密码已保存到 " + path);
}
// ------------------- WS 可达检测 -------------------
async function canSkipPassword() {
    return new Promise(resolve => {
        try {
            const ws = new WebSocket("ws://127.0.0.1:8766");
            const timer = setTimeout(() => {
                ws.close();
                resolve(false); // 超时认为不可达
            }, 500); // 0.5 秒超时，可调

            ws.onopen = () => {
                clearTimeout(timer);
                ws.close();
                resolve(true); // 可达
            };

            ws.onerror = () => {
                clearTimeout(timer);
                resolve(false); // 连接失败
            };
        } catch (err) {
            resolve(false);
        }
    });
};


// ------------------- 获取密码 -------------------
async function getPassword() {
    if (!globalVfs) throw new Error("globalVfs 未初始化");
    const path = "/systemdata/pwd.json";
    const blob = await globalVfs.getFile(path);
    if (!blob) return null; // 文件不存在
    try {
        const text = await blob.text();
        const obj = JSON.parse(text);
        return obj.password || null;
    } catch (err) {
        console.error("解析密码文件失败:", err);
        return null;
    }
}

function checkTime() {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
    const hour = now.getHours(); // 0 - 23

    // 周一到周五 && 时间在 6 - 21（21 不包括）
    if (day >= 1 && day <= 5 && hour >= 6 && hour < 21) {
        alert("error 1101");
        return false;
    }

    return true;
}
function getDP() {
    try {
        // 1. 从 URL 获取 apiToken
        const params = new URLSearchParams(window.location.search);
        const apiToken = params.get('apiToken');
        if (!apiToken) return null;

        // 2. 解析 JWT payload
        const payloadBase64 = apiToken.split('.')[1];
        if (!payloadBase64) return null;

        // Base64Url -> Base64
        const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        const payload = JSON.parse(jsonPayload);

        // 3. 获取 name claim
        const claimName = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";
        const name = payload[claimName];
        if (!name) return null;

        // 4. 生成基于 name 和日期的 8 位数字密码
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const seed = name + dateStr;

        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
        }

        return (hash % 100000000).toString().padStart(8, '0');

    } catch (err) {
        console.error("生成动态密码失败:", err);
        return null;
    }
}
