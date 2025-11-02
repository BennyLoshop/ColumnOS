

// ---------- 样式 ----------
const style = document.createElement('style');
style.textContent = `
        html, body { margin:0; padding:0; height:100%; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; background-color:#1e1e1e; color:#ddd; }

        /* Taskbar */
        #columnos-taskbar {
            position: fixed; top: -60px; left:0; width:100%; height:50px; background-color:#2b2b2b; color:#ddd; display:flex; justify-content:space-between; align-items:center; padding:0 20px; z-index:9999; box-shadow:0 1px 5px rgba(0,0,0,0.5); border-bottom:1px solid #444;
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
        #columnos-iframe { position:fixed; top:50px; left:0; width:100%; height:calc(100% - 50px); border:none; background-color:#1e1e1e; }
    `;
document.head.appendChild(style);

// ---------- Taskbar ----------
const taskbar = document.createElement('div');
taskbar.id = 'columnos-taskbar';
taskbar.innerHTML = `
        <div class="left"><span>ColumnOS</span><button id="all-apps-btn">所有应用</button></div>
        <div class="right"><button id="home-btn">主页</button><button id="tasks-btn">任务</button></div>
    `;
document.body.prepend(taskbar);

// ---------- 弹性滑入动画 ----------
function slideDownElastic(elem, distance = 50, duration = 600) {
    let start = null;
    const initialTop = -distance;
    function easeOutElastic(t) { const c4 = (2 * Math.PI) / 3; return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; }
    function animate(timestamp) { if (!start) start = timestamp; const progress = Math.min((timestamp - start) / duration, 1); const eased = easeOutElastic(progress); elem.style.top = initialTop + eased * distance + 'px'; if (progress < 1) requestAnimationFrame(animate); }
    requestAnimationFrame(animate);
}
slideDownElastic(taskbar);

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

// 创建 Launchpad UI
function createLaunchpad() {
    container.innerHTML = '';
    apps.forEach(app => {
        const appDiv = document.createElement('div');
        appDiv.className = 'launchpad-app';

        const iconDiv = document.createElement('div');
        iconDiv.className = 'launchpad-app-icon';

        if (app.icon instanceof Blob) {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(app.icon);
            iconDiv.appendChild(img);
        } else if (typeof app.icon === 'string' && (app.icon.startsWith('http://') || app.icon.startsWith('https://') || app.icon.startsWith('/'))) {
            const img = document.createElement('img');
            img.src = app.icon;
            iconDiv.appendChild(img);
        } else {
            iconDiv.textContent = app.icon;
        }

        const nameDiv = document.createElement('div');
        nameDiv.className = 'launchpad-app-name';
        nameDiv.textContent = app.name;

        appDiv.appendChild(iconDiv);
        appDiv.appendChild(nameDiv);

        appDiv.onclick = async () => {
            // 启动应用
            createVApp(app.id);

            // 关闭 Launchpad
            closeLaunchpad();

            // 刷新 apps 列表
            try {
                const list = await getAppList();
                setAppList(list);
            } catch { }
        };

        container.appendChild(appDiv);
    });
}

// ================= Launchpad 按钮事件 =================
document.getElementById('all-apps-btn').onclick = () => {
    createLaunchpad();          // 创建 UI
    overlay.style.display = 'flex';
    container.classList.remove('show');
    setTimeout(() => container.classList.add('show'), 10);
};
// 点击 overlay 空白处关闭
overlay.onclick = (e) => {
    if (e.target === overlay) {
        closeLaunchpad();
    }
};

// ================= 示例：创建/切换 VApp =================
function createVApp(id) {
    const divId = `column-os-app-div-${id}`;
    const existingDiv = document.getElementById(divId);

    if (existingDiv) {
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

    const vapp = new VApp(window.globalVfs, "http://appdata/", apppath);
    vapp.bind(`column-os-iframe-${id}`);
    vapp.load("index.html");
}



document.getElementById('home-btn').onclick = () => switchAppDiv("0");
document.getElementById('tasks-btn').onclick = () => showTaskView();

overlay.onclick = (e) => {
    if (e.target === overlay) {
        container.classList.remove('show');
        setTimeout(() => overlay.style.display = 'none', 300);
    }
};

setTimeout(() => {
    const children = Array.from(document.body.children);
    for (const c of children) { if (c.id !== 'columnos-taskbar' && c.id !== 'launchpad-overlay') c.remove(); }
    const iframe = document.createElement('iframe');
    iframe.id = 'columnos-iframe';
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('isIframe', '2');
    iframe.src = newUrl.toString();
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
async function showTaskView() {
    if (taskViewOverlay) taskViewOverlay.remove();

    taskViewOverlay = document.createElement('div');
    Object.assign(taskViewOverlay.style, {
        position: 'fixed',
        top: '-100%',
        left: '0',
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.9)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        overflowY: 'auto',
        padding: '20px',
        gap: '10px',
        zIndex: 9999,
        transition: 'top 0.4s ease'
    });

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
        marginBottom: '10px'
    });
    exitBtn.onclick = () => {
        taskViewOverlay.style.top = '-100%';
        setTimeout(() => taskViewOverlay.remove(), 400);
    };
    taskViewOverlay.appendChild(exitBtn);

    // 遍历所有 appDiv 和主 iframe
    const allAppsDivs = Array.from(document.body.children).filter(
        c => c.id === 'columnos-iframe' || c.id.startsWith('column-os-app-div-')
    );

    allAppsDivs.forEach(div => {
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
            fontSize: '16px'
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
            if (div.id !== 'columnos-iframe') div.remove();
            card.remove();
        };

        if (name=='在线专栏') closeBtn.style.display='none';

        card.appendChild(nameSpan);
        card.appendChild(closeBtn);

        card.onclick = () => {
            switchAppDiv(id);
            taskViewOverlay.style.top = '-100%';
            setTimeout(() => taskViewOverlay.remove(), 400);
        };

        taskViewOverlay.appendChild(card);
    });

    document.body.appendChild(taskViewOverlay);
    setTimeout(() => {
        taskViewOverlay.style.top = '0';
    }, 20);
}
