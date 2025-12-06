// ---------- 从 VFS/Blob 动态加载 Ace 文件 ----------
async function loadAceFromVfs(path) {
    const blob = await window.vapp.getAppFile(path);
    if (!blob) throw new Error("文件不存在: " + path);
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => resolve();
        script.onerror = reject;
        document.body.appendChild(script);
    });
}

// ---------- 初始化 Ace 编辑器 ----------
async function initAce() {
    await loadAceFromVfs("/ace/ace.js");
    await loadAceFromVfs("/ace/mode-text.js");
    await loadAceFromVfs("/ace/theme-monokai.js");

    const editor = ace.edit("editorContainer", {
        theme: "ace/theme/monokai", // 淡色主题
        mode: "ace/mode/text",     // 仅文本模式
        fontSize: "14px",
        autoScrollEditorIntoView: true,
        readOnly: true
    });
    editor.setHighlightActiveLine(false);

    return editor;
}

// ---------- DOM 元素 ----------
const loadBtn = document.getElementById('loadBtn');
const fileInput = document.getElementById('fileInput');
const fileName = document.getElementById('fileName');

let editorInstance;

// ---------- 等待 vapp 出现 ----------
function waitForVapp() {
    return new Promise(resolve => {
        const check = () => {
            if (window.vapp) {
                resolve();
            } else {
                requestAnimationFrame(check);
            }
        };
        check();
    });
}

// ---------- 页面加载时初始化 ----------
window.addEventListener('DOMContentLoaded', async () => {
    loadBtn.disabled = true; // 初始化前禁用按钮
    try {
        await waitForVapp();           // 等待 vapp 出现
        editorInstance = await initAce(); // 初始化 Ace
        editorInstance.setHighlightActiveLine(false);
        loadBtn.disabled = false;      // 初始化完成启用按钮

        // 自动打开 vapp.params.file
        if (window.vapp?.params?.file) {
            openTextFile(window.vapp.params.file);
        }
    } catch (err) {
        console.error("初始化 Ace 编辑器失败:", err);
    }
});

// ---------- 用户点击加载按钮 ----------
loadBtn.addEventListener('click', () => {
    if (!editorInstance) {
        console.warn("编辑器尚未初始化，请稍等...");
        return;
    }
    fileInput.click();
});

// ---------- 用户选择本地文件 ----------
fileInput.addEventListener('change', async (event) => {
    if (!editorInstance) {
        console.warn("编辑器尚未初始化，请稍等...");
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        editorInstance.setValue(text, -1); // 光标回到开头
        fileName.textContent = file.name;
    } catch (err) {
        console.error("读取本地文件失败:", err);
    }
});

// ---------- 通过 globalVfs 打开文件 ----------
async function openTextFile(filePath) {
    if (!editorInstance) {
        console.warn("编辑器尚未初始化，请稍等...");
        return;
    }
    try {
        const blob = await window.vapp.globalVfs.getFile(filePath);
        if (!blob) throw new Error("文件不存在: " + filePath);

        const text = await blob.text();
        editorInstance.setValue(text, -1);

        const name = filePath.split("/").pop();
        fileName.textContent = name;
    } catch (err) {
        console.error("打开文件失败:", err);
    }
}

window.openTextFile = openTextFile;
