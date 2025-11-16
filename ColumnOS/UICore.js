window.showUI = function showUI() {

    const taskbar = document.getElementById('columnos-taskbar');
    const iframe = document.getElementById('columnos-iframe');

    if (!taskbar || !iframe) return;

    // 显示 iframe
    iframe.style.display = 'block';

    // 显示 taskbar并做弹性滑入动画
    taskbar.style.display = 'flex';
    taskbar.style.top = '-60px'; // 初始隐藏位置

    let start = null;
    const distance = 50;
    const duration = 600;

    function easeOutElastic(t) {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }

    function animate(timestamp) {
        if (!start) start = timestamp;
        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = easeOutElastic(progress);
        taskbar.style.top = -distance + eased * distance + 'px';
        if (progress < 1) requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
    const children = Array.from(document.body.children);
    for (const c of children) { if (c.id !== 'columnos-taskbar' && c.id !== 'launchpad-overlay' && c.id !== 'columnos-iframe') c.remove(); }
};
window.showTaskbar = function showTaskbar() {
    const taskbar = document.getElementById('columnos-taskbar');
    const iframe = document.getElementById('columnos-iframe');
    if (!taskbar || !iframe) return;

    taskbar.style.display = 'flex';
    taskbar.style.top = '-60px'; // 初始位置

    // 弹性滑入动画
    let start = null;
    const distance = 50;
    const duration = 600;
    function easeOutElastic(t) {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    function animate(timestamp) {
        if (!start) start = timestamp;
        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = easeOutElastic(progress);
        taskbar.style.top = -distance + eased * distance + 'px';
        if (progress < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    // 调整 iframe 高度
    iframe.style.top = '50px';
    iframe.style.height = 'calc(100% - 50px)';
};

// 隐藏 taskbar 并切换主页
window.hideTaskbar = function hideTaskbar() {
    const taskbar = document.getElementById('columnos-taskbar');
    const iframe = document.getElementById('columnos-iframe');
    if (!taskbar || !iframe) return;

    // 向上滑出
    taskbar.style.top = '-60px';

    // 切换回主页 iframe
    switchAppDiv('0');

    // iframe 占满整个页面
    iframe.style.top = '0';
    iframe.style.height = '100%';

    // 延迟隐藏 taskbar，保留动画时间
    setTimeout(() => {
        taskbar.style.display = 'none';
    }, 400);
};
// ---------- 样式 ----------
const style = document.createElement('style');
style.textContent = `
        html, body { margin:0; padding:0; height:100%; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; background-color:#1e1e1e; color:#ddd; }

        /* Taskbar */
        #columnos-taskbar {
            display:none;position: fixed; top: -60px; left:0; width:100%; height:50px; background-color:#2b2b2b; color:#ddd; display:flex; justify-content:space-between; align-items:center; padding:0 20px; z-index:9999; box-shadow:0 1px 5px rgba(0,0,0,0.5); border-bottom:1px solid #444;
        }
        #columnos-taskbar .left, #columnos-taskbar .right { display:flex; align-items:center; gap:12px; }
        #columnos-taskbar .left span { font-weight:600; font-size:16px; }
        #columnos-taskbar button { background-color:#444; border:none; color:#ddd; padding:5px 12px; border-radius:12px; cursor:pointer; font-size:14px; transition:background 0.2s; }
        #columnos-taskbar button:hover { background-color:#555; }

        /* Launchpad */
        #launchpad-overlay { position: fixed; top:50px; left:0; width:100%; height:calc(100% - 50px); background:rgba(0,0,0,0.8); display:none; justify-content:center; align-items:center; z-index:10001; }
        #launchpad-container {
            background:#2b2b2b; border-radius:16px; padding:20px; max-width:800px; width:90%; max-height:80%; overflow:auto; display:grid; grid-template-columns:repeat(5,1fr); gap:20px;
            box-shadow:0 4px 20px rgba(0,0,0,0.8); transform: scale(0.8); opacity:0; transition: transform 0.3s ease, opacity 0.3s ease; z-index:10002;
        }
        #launchpad-container.show { transform: scale(1); opacity:1; }

        .launchpad-app { display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; transition:transform 0.2s; }
        .launchpad-app:hover { transform:scale(1.1); }
        .launchpad-app-icon { width:60px; height:60px; border-radius:12px; background-color:#444; margin-bottom:8px; display:flex; align-items:center; justify-content:center; font-size:28px; overflow:hidden; }
        .launchpad-app-icon img { width:100%; height:100%; object-fit:cover; }
        .launchpad-app-name { font-size:12px; text-align:center; color:#ddd; }

        /* iframe */
        #columnos-iframe { display:none;position:fixed; top:50px; left:0; width:100%; height:calc(100% - 50px); border:none; background-color:#1e1e1e; }
    `;
document.head.appendChild(style);

// ---------- Taskbar ----------
const taskbar = document.createElement('div');
taskbar.id = 'columnos-taskbar';
taskbar.innerHTML = `
        <div class="left"><span>ColumnOS</span><button id="all-apps-btn">所有应用</button></div>
        <div class="right"><button id="lock-btn">锁定</button><button id="home-btn">主页</button><button id="tasks-btn">任务</button></div>
    `;
document.body.prepend(taskbar);

// 调用一次，taskbar 创建完成后
loadTaskbarIcons();


// ---------- Launchpad ----------
const overlay = document.createElement('div');
overlay.id = 'launchpad-overlay';
const container = document.createElement('div');
container.id = 'launchpad-container';
overlay.appendChild(container);
document.body.appendChild(overlay);

// ================= 动态应用列表 =================
let apps = [];

// 打开 Launchpad
async function openLaunchpad() {


    // 创建 Launchpad UI
    createLaunchpad();

    // 显示 overlay 并触发动画
    overlay.style.display = 'flex';
    container.classList.remove('show');
    setTimeout(() => container.classList.add('show'), 10);
}

// 关闭 Launchpad
function closeLaunchpad() {
    container.classList.remove('show');
    setTimeout(() => overlay.style.display = 'none', 300);
}

// 设置应用列表
function setAppList(list) {
    if (!Array.isArray(list)) list = [];
    apps = list.map(app => ({ ...app }));

    // 按名字拼音排序
    apps.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin'));
}
// ---------- 创建 Launchpad UI ----------
function createLaunchpad() {
    container.innerHTML = '';

    apps.forEach(app => {
        const appDiv = document.createElement('div');
        appDiv.className = 'launchpad-app';
        Object.assign(appDiv.style, {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'transform 0.2s'
        });

        appDiv.onmouseenter = () => { appDiv.style.transform = 'scale(1.1)'; };
        appDiv.onmouseleave = () => { appDiv.style.transform = 'scale(1)'; };

        const iconDiv = document.createElement('div');
        iconDiv.className = 'launchpad-app-icon';
        Object.assign(iconDiv.style, {
            width: '60px',
            height: '60px',
            borderRadius: '12px',
            backgroundColor: '#444',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '28px',
            overflow: 'hidden'
        });

        if (app.icon instanceof Blob) {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(app.icon);
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            iconDiv.appendChild(img);
        } else if (typeof app.icon === 'string') {
            const img = document.createElement('img');
            img.src = app.icon;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            iconDiv.appendChild(img);
        } else {
            iconDiv.textContent = app.icon || '?';
        }

        const nameDiv = document.createElement('div');
        nameDiv.className = 'launchpad-app-name';
        nameDiv.textContent = app.name;
        Object.assign(nameDiv.style, { fontSize: '12px', textAlign: 'center', color: '#ddd' });

        appDiv.appendChild(iconDiv);
        appDiv.appendChild(nameDiv);

        // 点击打开应用
        appDiv.onclick = async () => {
            createVApp(app.id);
            closeLaunchpad();
            try {
                const list = await getAppList();
                setAppList(list);
            } catch { }
        };

        // PC右键 / 移动端长按卸载非系统应用
        if (!app.id.startsWith("com.columnos.")) {
            const showMenu = (x, y) => {
                let menu = document.getElementById('launchpad-context-menu');
                if (!menu) {
                    menu = document.createElement('div');
                    menu.id = 'launchpad-context-menu';
                    Object.assign(menu.style, {
                        position: 'fixed',
                        background: '#2b2b2b',
                        color: '#ddd',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        zIndex: 10003,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                        cursor: 'pointer'
                    });
                    menu.innerText = '卸载应用';
                    document.body.appendChild(menu);

                    menu.onclick = async () => {
                        try {
                            // 删除 app 目录
                            await window.globalVfs.deleteDir(`/app/${app.id}`);

                            // 关闭应用对应 AppDiv
                            const appDivToClose = document.getElementById(`column-os-app-div-${app.id}`);
                            if (appDivToClose) appDivToClose.remove();
                            switchAppDiv(0);

                            // 更新 appManifest.json
                            const manifestBlob = await window.globalVfs.getFile("/systemdata/appManifest.json");
                            if (manifestBlob) {
                                const text = await manifestBlob.text();
                                let appList = [];
                                try { appList = JSON.parse(text); } catch { }
                                appList = appList.filter(a => a.appId !== app.id);
                                const newBlob = new Blob([JSON.stringify(appList, null, 2)], { type: "application/json" });
                                await window.globalVfs.setFile("/systemdata/appManifest.json", newBlob);
                            }

                            apps = apps.filter(a => a.id !== app.id);
                            createLaunchpad(); // 刷新 Launchpad UI
                        } catch (err) {
                            alert('卸载失败: ' + err.message);
                        }
                        menu.remove();
                    };
                }
                menu.style.left = `${x}px`;
                menu.style.top = `${y}px`;
                menu.style.display = 'block';
                const hideMenu = () => { menu.style.display = 'none'; document.removeEventListener('click', hideMenu); };
                setTimeout(() => document.addEventListener('click', hideMenu), 0);
            };

            // PC右键
            appDiv.oncontextmenu = e => { e.preventDefault(); showMenu(e.clientX, e.clientY); };
            // 移动端长按
            let pressTimer;
            appDiv.ontouchstart = e => {
                pressTimer = setTimeout(() => {
                    const touch = e.touches[0];
                    showMenu(touch.clientX, touch.clientY);
                }, 600);
            };
            appDiv.ontouchend = appDiv.ontouchmove = () => clearTimeout(pressTimer);
        }

        container.appendChild(appDiv);
    });
}


// ---------- 打开 / 关闭 Launchpad ----------
function openLaunchpad() {
    createLaunchpad();
    overlay.style.display = 'flex';
    container.classList.remove('show');
    setTimeout(() => container.classList.add('show'), 10);
}
function closeLaunchpad() {
    container.classList.remove('show');
    setTimeout(() => overlay.style.display = 'none', 300);
}

// ---------- overlay 点击空白处关闭 ----------
overlay.onclick = e => { if (e.target === overlay) closeLaunchpad(); };

// ---------- Launchpad 按钮绑定 ----------
const allAppsBtn = document.getElementById('all-apps-btn');
if (allAppsBtn) allAppsBtn.onclick = openLaunchpad;

// ================= 示例：创建/切换 VApp =================
function createVApp(id, options = null) {
    const divId = `column-os-app-div-${id}`;
    const existingDiv = document.getElementById(divId);

    if (existingDiv && (!options)) {
        // 应用已打开，直接切换
        switchAppDiv(id);
        return;
    }

    // 应用未打开，创建新 appDiv
    createAppDiv(id);
    switchAppDiv(id);

    let apppath;
    if (id.startsWith("com.columnos")) apppath = `/system/app/${id}/`;
    else apppath = `/app/${id}/`;

    const vapp = new VApp(window.globalVfs, "http://appdata/", apppath, options || {});
    vapp.bind(`column-os-iframe-${id}`);
    vapp.load("index.html");
}

window.showUI = function showUI() {

    const taskbar = document.getElementById('columnos-taskbar');
    const iframe = document.getElementById('columnos-iframe');

    if (!taskbar || !iframe) return;

    // 显示 iframe
    iframe.style.display = 'block';

    // 显示 taskbar并做弹性滑入动画
    taskbar.style.display = 'flex';
    taskbar.style.top = '-60px'; // 初始隐藏位置

    let start = null;
    const distance = 50;
    const duration = 600;

    function easeOutElastic(t) {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }

    function animate(timestamp) {
        if (!start) start = timestamp;
        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = easeOutElastic(progress);
        taskbar.style.top = -distance + eased * distance + 'px';
        if (progress < 1) requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
    const children = Array.from(document.body.children);
    for (const c of children) { if (c.id !== 'columnos-taskbar' && c.id !== 'launchpad-overlay' && c.id !== 'columnos-iframe') c.remove(); }
}

document.getElementById('home-btn').onclick = () => switchAppDiv("0");
document.getElementById('tasks-btn').onclick = () => showTaskView();
document.getElementById('lock-btn').onclick = () => hideTaskbar();

overlay.onclick = (e) => {
    if (e.target === overlay) {
        container.classList.remove('show');
        setTimeout(() => overlay.style.display = 'none', 300);
    }
};
function patchIframeJsBridge(iframe) {
    if (!iframe || !iframe.contentWindow) return;

    const cw = iframe.contentWindow;

    const fakeJsToJava = {
        checkUrls: function (urls) {
            console.log("Fake JsToJava.checkUrls:", urls);
            return "[]";
        },
        refreshToken: function () {
            console.log("Fake JsToJava.refreshToken() 被屏蔽");
        }
    };

    function override() {
        try {
            Object.defineProperty(cw, 'JsToJava', {
                value: fakeJsToJava,
                writable: true,
                configurable: true,
                enumerable: false
            });
        } catch (e) { }
    }

    override(); // 初次覆盖

    // 防止安卓注入后再覆盖
    cw.setInterval(override, 100);
}

id = setTimeout(() => {
    const children = Array.from(document.body.children);
    const iframe = document.createElement('iframe');
    iframe.id = 'columnos-iframe';
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('isIframe', '2');
    iframe.src = newUrl.toString();
    iframe.onload = () => {
        patchIframeJsBridge(iframe);
    };
    document.body.appendChild(iframe);
}, 700);
// =================== AppDiv 创建与切换 ===================

// 缓存截图
const appSnapshots = {};
let taskViewOverlay = null;

// =================== 创建 AppDiv ===================
function createAppDiv(id) {
    const divId = `column-os-app-div-${id}`;
    if (document.getElementById(divId)) return document.getElementById(divId);

    // 创建 appDiv
    const div = document.createElement('div');
    div.id = divId;
    Object.assign(div.style, {
        position: 'fixed',
        top: '50px',
        left: '100%',
        width: '100%',
        height: 'calc(100% - 50px)',
        background: '#1e1e1e',
        color: '#ddd',
        zIndex: 9998,
        transition: 'left 0.4s ease',
        overflow: 'hidden'
    });

    // 创建 iframe
    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.backgroundColor = '#1e1e1e';
    iframe.id = `column-os-iframe-${id}`;
    div.appendChild(iframe);

    // 创建加载覆盖层，id = iframe id + "-loader"
    const loader = document.createElement('div');
    loader.id = `${iframe.id}-loader`;
    Object.assign(loader.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        backgroundColor: '#1e1e1e'
    });

    // 获取应用图标
    const iconDiv = document.createElement('div');
    Object.assign(iconDiv.style, {
        width: '80px',
        height: '80px',
        borderRadius: '16px',
        backgroundColor: '#444',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '32px',
        color: '#fff',
        overflow: 'hidden'
    });

    const appInfo = apps.find(a => a.id === id);
    if (appInfo?.icon instanceof Blob) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(appInfo.icon);
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        iconDiv.appendChild(img);
    } else if (typeof appInfo?.icon === 'string') {
        const img = document.createElement('img');
        img.src = appInfo.icon;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        iconDiv.appendChild(img);
    } else {
        iconDiv.textContent = appInfo?.icon || '?';
    }

    const nameDiv = document.createElement('div');
    nameDiv.textContent = appInfo?.name || '应用加载中...';
    Object.assign(nameDiv.style, { color: '#ddd', fontSize: '16px', fontWeight: 'bold' });

    loader.appendChild(iconDiv);
    loader.appendChild(nameDiv);
    div.appendChild(loader);

    document.body.appendChild(div);

    // 动画右侧滑入
    setTimeout(() => {
        div.style.left = '0';
    }, 20);

    return div;
}

// 切换页面
function switchAppDiv(id) {
    console.log(id);
    // 隐藏所有appdiv和iframe
    const all = Array.from(document.querySelectorAll('[id^="column-os-app-div-"], #columnos-iframe'));

    console.log(all);
    all.forEach(el => el.style.display = 'none');


    // id=0 表示主iframe
    if (id === '0' || id === 0) {
        const iframe = document.getElementById('columnos-iframe');
        iframe.style.display = 'block';
        iframe.style.zIndex = 9998;
    } else {
        const target = document.getElementById(`column-os-app-div-${id}`);
        if (!target) return;

        target.style.display = 'block';
        target.style.left = '100%';
        setTimeout(() => {
            target.style.transition = 'left 0.4s ease';
            target.style.left = '0';
        }, 20);
    }

    // 异步保存截图，不阻塞切换动画
    setTimeout(() => saveCurrentSnapshot(), 50);
}

// =================== 截图保存 ===================
async function saveCurrentSnapshot() {
    const activeApp = Array.from(document.body.children).find(
        c => (c.id.startsWith('column-os-app-div-') || c.id === 'columnos-iframe') && c.style.display !== 'none'
    );
    if (!activeApp) return;

    const id = activeApp.id === 'columnos-iframe' ? '0' : activeApp.id.replace('column-os-app-div-', '');
    if (id === '0') return; // 主iframe不截图

    try {
        const canvas = await html2canvas(activeApp, { scale: window.devicePixelRatio, useCORS: true });
        appSnapshots[id] = canvas.toDataURL('image/jpeg', 0.8);
    } catch (err) {
        console.warn('截图失败:', err);
    }
}
async function loadTaskbarIcons() {
    let iconType = 1; // 默认：图标 + 文字

    try {
        const settingsBlob = await window.globalVfs.getFile("/systemdata/settings/uisettings.json");
        if (settingsBlob) {
            const settingsText = await settingsBlob.text();
            const settingsJson = JSON.parse(settingsText);
            if (typeof settingsJson.taskbarIconType === "number") {
                iconType = settingsJson.taskbarIconType;
            }
        }
    } catch (err) {
        console.warn("无法读取 uisettings.json，使用默认配置(1)", err);
    }

    const btnMap = [
        { id: "home-btn", file: "home.png" },
        { id: "all-apps-btn", file: "app.png" },
        { id: "tasks-btn", file: "task.png" },
        { id: "lock-btn", file: "lock.png" }
    ];

    for (const btnInfo of btnMap) {
        const btn = document.getElementById(btnInfo.id);
        if (!btn) continue;

        // 记录原始文字（只记录一次）
        if (!btn.dataset.title) {
            btn.dataset.title = btn.innerText.trim();
        }

        // 清空，以便重构内容
        btn.innerHTML = "";

        let iconUrl = null;

        try {
            const blob = await window.globalVfs.getFile(`/system/res/${btnInfo.file}`);
            if (blob) iconUrl = URL.createObjectURL(blob);
        } catch (err) {
            console.warn("加载图标失败", btnInfo.file, err);
        }

        // 创建图标元素
        let img = null;
        if (iconUrl) {
            img = document.createElement("img");
            img.src = iconUrl;
            img.style.width = "18px";
            img.style.height = "18px";
            img.style.verticalAlign = "middle";
        }

        // 显示模式处理
        if (iconType === 0) {
            // 文字模式
            btn.textContent = btn.dataset.title;

        } else if (iconType === 1) {
            // 图标 + 文字
            if (img) {
                img.style.marginRight = "6px";
                btn.appendChild(img);
            }
            btn.appendChild(document.createTextNode(btn.dataset.title));

        } else if (iconType === 2) {
            // 仅图标
            if (img) btn.appendChild(img);
            else btn.textContent = btn.dataset.title; // fallback
        }
    }
}


async function showTaskView() {
    if (taskViewOverlay) taskViewOverlay.remove();

    taskViewOverlay = document.createElement('div');
    Object.assign(taskViewOverlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0)',  // 初始透明
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        overflowY: 'auto',
        padding: '20px',
        gap: '10px',
        zIndex: 9999,
        transition: 'background 0.3s ease'
    });

    // 背景淡入
    setTimeout(() => {
        taskViewOverlay.style.background = 'rgba(0,0,0,0.9)';
    }, 10);

    // 退出按钮
    const exitBtn = document.createElement('div');
    exitBtn.textContent = '✕';
    Object.assign(exitBtn.style, {
        alignSelf: 'flex-end',
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        background: '#fff',
        color: '#000',
        fontSize: '22px',
        fontWeight: 'bold',
        textAlign: 'center',
        lineHeight: '36px',
        cursor: 'pointer',
        boxShadow: '0 0 8px rgba(0,0,0,0.5)',
        marginBottom: '10px',
        opacity: '0',
        transform: 'translateY(-10px)',
        transition: 'opacity 0.3s ease, transform 0.3s ease'
    });
    exitBtn.onclick = () => {
        // 淡出卡片和按钮
        Array.from(taskViewOverlay.children).forEach(c => {
            if (c !== exitBtn) {
                c.style.opacity = '0';
                c.style.transform = 'translateY(-10px)';
            }
        });
        exitBtn.style.opacity = '0';
        exitBtn.style.transform = 'translateY(-10px)';
        setTimeout(() => taskViewOverlay.remove(), 300);
    };
    taskViewOverlay.appendChild(exitBtn);

    // 遍历所有 appDiv 和主 iframe
    const allAppsDivs = Array.from(document.body.children).filter(
        c => c.id === 'columnos-iframe' || c.id.startsWith('column-os-app-div-')
    );

    allAppsDivs.forEach((div, index) => {
        const id = div.id === 'columnos-iframe' ? '0' : div.id.replace('column-os-app-div-', '');
        const name = apps.find(a => a.id === id)?.name || `在线专栏`;

        const card = document.createElement('div');
        Object.assign(card.style, {
            width: '80%',
            padding: '12px 16px',
            margin: '4px 0',
            background: '#2b2b2b',
            color: '#ddd',
            borderRadius: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            fontSize: '16px',
            opacity: '0',           // 初始透明
            transform: 'translateY(-10px)', // 初始上移
            transition: 'opacity 0.3s ease, transform 0.3s ease',
        });

        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;

        const closeBtn = document.createElement('span');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, {
            color: '#fff',
            fontWeight: 'bold',
            cursor: 'pointer'
        });
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            const isActive = div.style.display !== 'none';
            if (div.id !== 'columnos-iframe') div.remove();
            card.remove();
            if (isActive) switchAppDiv('0');
        };
        if (name == '在线专栏') closeBtn.style.display = 'none';

        card.appendChild(nameSpan);
        card.appendChild(closeBtn);

        card.onclick = () => {
            switchAppDiv(id);
            // 淡出卡片
            Array.from(taskViewOverlay.children).forEach(c => {
                if (c !== exitBtn) {
                    c.style.opacity = '0';
                    c.style.transform = 'translateY(-10px)';
                }
            });
            exitBtn.style.opacity = '0';
            exitBtn.style.transform = 'translateY(-10px)';
            setTimeout(() => taskViewOverlay.remove(), 300);
        };

        taskViewOverlay.appendChild(card);

        // 延迟触发动画，错开效果
        setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
            exitBtn.style.opacity = '1';
            exitBtn.style.transform = 'translateY(0)';
        }, 50 + index * 50);
    });

    document.body.appendChild(taskViewOverlay);
}
