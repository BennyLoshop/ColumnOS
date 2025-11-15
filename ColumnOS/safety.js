function observeArticleInput() {
    const observer = new MutationObserver(async (mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                const input = document.querySelector('input[placeholder="请输入文章名称"]');
                if (input && !input._uiBound) {  // 防止重复绑定
                    input._uiBound = true;
                    input.addEventListener('input', async () => {
                        if (input.value === (await getPassword() || "123456")) {
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
            if (existingInput.value === (await getPassword() || "123456")) if (checkTime()) {
                window.showUI();
            };
        });
    }
}

// 启动监听
observeArticleInput();

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
                            if (input.value === (await getPassword() || "123456")) {
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