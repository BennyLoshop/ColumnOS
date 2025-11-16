async function waitForVapp() {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.vapp) {
                clearInterval(timer);
                resolve();
            }
        }, 50);
    });
}
async function initSettingsPage() {
    await waitForVapp();
    console.log("vapp 已就绪");

    // ---------------- 左侧分类切换 ----------------
    const categories = document.querySelectorAll('.category-item');
    const content = document.getElementById('settings-content');

    categories.forEach(cat => {
        cat.addEventListener('click', () => {
            categories.forEach(c => c.classList.remove('active'));
            cat.classList.add('active');
            showCategory(cat.dataset.cat);
        });
    });

    // ---------------- 显示分类内容 ----------------
    function showCategory(cat) {
        content.innerHTML = '';
        if (cat === 'security') {
            showSecuritySettings();
        } else if (cat === 'personalize') {
            showPersonalize();
        } else if (cat === 'about') {
            showAbout();
        }
    }

    // ---------------- 安全设置 ----------------
    async function showSecuritySettings() {
        const title = document.createElement('h2');
        title.textContent = "安全设置";
        content.appendChild(title);

        const label = document.createElement('label');
        label.textContent = "设置密码:";
        content.appendChild(label);

        const input = document.createElement('input');
        input.type = "password";
        input.placeholder = "请输入新密码";
        content.appendChild(input);

        const btn = document.createElement('button');
        btn.textContent = "保存密码";
        btn.disabled = true;
        content.appendChild(btn);

        // 读取当前密码
        let currentPwd = "";
        try {
            const blob = await vapp.globalVfs.getFile("/systemdata/pwd.json");
            if (blob) {
                const text = await blob.text();
                const obj = JSON.parse(text);
                currentPwd = obj.password || "";
            }
        } catch (e) { console.warn("读取密码失败:", e); }

        // 启用按钮逻辑
        input.addEventListener('input', () => {
            btn.disabled = input.value.trim() === "" || input.value === currentPwd;
        });

        // 保存密码
        btn.addEventListener('click', async () => {
            const pwd = input.value.trim();
            if (!pwd) return;
            const blob = new Blob([JSON.stringify({ password: pwd })], { type: "application/json" });
            await vapp.globalVfs.createDirIfNotExist("/systemdata");
            await vapp.globalVfs.setFile("/systemdata/pwd.json", blob);
            alert("密码已保存！");
            input.value = '';
            btn.disabled = true;
        });
    }

    async function showPersonalize() {
        const title = document.createElement('h2');
        title.textContent = "个性化设置";
        content.appendChild(title);

        const group = document.createElement('div');
        group.className = "personalize-group";
        content.appendChild(group);

        // 读取 UI 设置
        let uiSettings = { taskbarIconType: 1 };

        try {
            const blob = await vapp.globalVfs.getFile("/systemdata/settings/uisettings.json");
            if (blob) uiSettings = JSON.parse(await blob.text());
        } catch (e) {
            console.warn("读取 uisettings.json 失败:", e);
        }

        const defaultType = uiSettings.taskbarIconType ?? 1;

        const options = [
            { val: 0, title: "仅文字", file: "/0.png" },
            { val: 1, title: "图标 + 文字", file: "/1.png" },
            { val: 2, title: "仅图标", file: "/2.png" }
        ];

        // 创建选项
        for (const opt of options) {
            const row = document.createElement('div');
            row.className = "option-row";
            row.dataset.val = opt.val;

            if (opt.val === defaultType) row.classList.add("active");

            const preview = document.createElement('div');
            preview.className = "option-preview";
            row.appendChild(preview);

            try {
                const blob = await vapp.getAppFile(opt.file);
                if (blob) preview.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
            } catch (e) {
                console.warn("加载图失败:", opt.file, e);
            }

            const textBox = document.createElement('div');
            textBox.className = "option-textbox";

            const dot = document.createElement('div');
            dot.className = "option-dot";
            textBox.appendChild(dot);

            const title = document.createElement('span');
            title.className = "option-title";
            title.textContent = opt.title;
            textBox.appendChild(title);

            row.appendChild(textBox);
            group.appendChild(row);
        }

        // 点击自动保存
        // 点击自动保存
        group.querySelectorAll('.option-row').forEach(r => {
            r.addEventListener('click', async () => {
                const rows = group.querySelectorAll('.option-row');
                rows.forEach(x => x.classList.remove("active"));
                r.classList.add("active");

                const selectedVal = Number(r.dataset.val);
                uiSettings.taskbarIconType = selectedVal;

                const blob = new Blob([JSON.stringify(uiSettings)], {
                    type: "application/json"
                });

                await vapp.globalVfs.createDirIfNotExist("/systemdata/settings");
                await vapp.globalVfs.setFile("/systemdata/settings/uisettings.json", blob);

                console.log("已保存 taskbarIconType =", selectedVal);

                // ⭐ 自动刷新父窗口任务栏图标
                try {
                    const target = window.parent ?? window.opener ?? null;
                    if (target && typeof target.loadTaskbarIcons === "function") {
                        target.loadTaskbarIcons();
                        console.log("父窗口 loadTaskbarIcons() 已调用");
                    } else {
                        console.warn("未找到父窗口的 loadTaskbarIcons()");
                    }
                } catch (err) {
                    console.error("调用 loadTaskbarIcons() 失败:", err);
                }
            });
        });

    }




    // ---------------- 关于 ----------------
    function showAbout() {
        const title = document.createElement('h2');
        title.textContent = "关于";
        content.appendChild(title);

        const info = document.createElement('p');
        info.textContent = "ColumnOS v1.0.1";
        content.appendChild(info);
    }

    // 默认显示安全
    showCategory('security');
}

initSettingsPage();