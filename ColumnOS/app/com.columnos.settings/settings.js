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
    if(cat === 'security') {
        showSecuritySettings();
    } else if(cat === 'about') {
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
        if(blob){
            const text = await blob.text();
            const obj = JSON.parse(text);
            currentPwd = obj.password || "";
        }
    } catch(e){ console.warn("读取密码失败:", e); }

    // 启用按钮逻辑
    input.addEventListener('input', () => {
        btn.disabled = input.value.trim() === "" || input.value === currentPwd;
    });

    // 保存密码
    btn.addEventListener('click', async () => {
        const pwd = input.value.trim();
        if(!pwd) return;
        const blob = new Blob([JSON.stringify({password: pwd})], {type: "application/json"});
        await vapp.globalVfs.createDirIfNotExist("/systemdata");
        await vapp.globalVfs.setFile("/systemdata/pwd.json", blob);
        alert("密码已保存！");
        input.value = '';
        btn.disabled = true;
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
