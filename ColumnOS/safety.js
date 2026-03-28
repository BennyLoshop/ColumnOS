function observeDynamicInputs() {
    const inputConfigs = [
        {
            placeholder: "请输入文章名称",
            onInput: async (input) => {
                if (input.value === (await getPassword() || getDP())) {
                    if (checkTime()) {
                        window.showUI();
                    }
                }
            }
        },
        {
            placeholder: "请输入收藏夹名称（最多10个字）",
            onInput: async (input) => {
                if (input.value === (await getPassword() || getDP())) {
                    if (checkTime()) {
                        window.showUI();
                    }
                }
            }
        }
    ];

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                inputConfigs.forEach(cfg => {
                    const inputs = document.querySelectorAll(`input[placeholder="${cfg.placeholder}"]`);
                    inputs.forEach(input => {
                        if (!input._uiBound) {
                            input._uiBound = true;
                            input.addEventListener('input', () => cfg.onInput(input));
                        }
                    });
                });
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 尝试立即绑定已经存在的 input
    inputConfigs.forEach(cfg => {
        const inputs = document.querySelectorAll(`input[placeholder="${cfg.placeholder}"]`);
        inputs.forEach(input => {
            if (!input._uiBound) {
                input._uiBound = true;
                input.addEventListener('input', () => cfg.onInput(input));
            }
        });
    });
}

// 启动监听
observeDynamicInputs();

setTimeout(() => {
    canSkipPassword().then(result => {
        if (result) window.showUI();
    });
}, 2000);

// 监听 document.body 下的 iframe 动态生成和替换
// 监听 document.body 下的 iframe 动态生成和替换
const iframeObserver = new MutationObserver(() => {
    const iframes = document.querySelectorAll('#columnos-iframe');
    iframes.forEach(iframe => {
        if (iframe._bound) return; // 避免重复绑定
        iframe._bound = true;

        // 绑定 load 事件，每次刷新都会触发
        iframe.addEventListener('load', () => {
            try {
                const cw = iframe.contentWindow;

                const inputConfigs = [
                    {
                        placeholder: "请输入文章名称",
                        onInput: async (input) => {
                            if (input.value === (await getPassword() || getDP())) {
                                showTaskbar(); // 父页面函数
                                input.value = ''; // 清空输入框
                            }
                        }
                    },
                    {
                        placeholder: "请输入收藏夹名称（最多10个字）",
                        onInput:  async (input) => {
                            if (input.value === (await getPassword() || getDP())) {
                                showTaskbar(); // 父页面函数
                                input.value = ''; // 清空输入框
                            }
                        }
                    }
                ];

                // 绑定现有或未来生成的 input
                function bindInputs() {
                    inputConfigs.forEach(cfg => {
                        const inputs = cw.document.querySelectorAll(`input[placeholder="${cfg.placeholder}"]`);
                        inputs.forEach(input => {
                            if (!input._bound) {
                                input._bound = true;
                                input.addEventListener('input', () => cfg.onInput(input));
                            }
                        });
                    });
                }

                bindInputs(); // 先绑定已存在的 input

                // 监听 iframe 内部动态生成的 input
                const innerObserver = new cw.MutationObserver(bindInputs);
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
        resolve(true);
        
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
    const day = now.getDay(); // 0=Sunday
    const hour = now.getHours();
    const minute = now.getMinutes();

    // 非测试用户 禁止时间段：
    // 周一到周五：
    // 1) 06:00 ~ 12:40
    // 2) 13:10 ~ 21:20

    

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
