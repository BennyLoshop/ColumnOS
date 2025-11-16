// 初始化 DPlayer
let dp = new DPlayer({
    container: document.getElementById('playerContainer'),
    theme: '#4285f4',
    lang: 'zh-cn',
    autoplay: false,
    video: {
        url: '',
        pic: ''
    }
});

// DOM 元素
const loadBtn = document.getElementById('loadBtn');
const videoFileInput = document.getElementById('videoFileInput');
const videoName = document.getElementById('videoName');

// ---------- 用户点击加载按钮 ----------
loadBtn.addEventListener('click', () => {
    videoFileInput.click();
});

// ---------- 用户选择本地文件 ----------
videoFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const fileURL = URL.createObjectURL(file);

    // 更新 DPlayer
    dp.switchVideo({
        url: fileURL,
        type: 'auto'
    });

    // 显示文件名
    videoName.textContent = file.name;
});

// ---------- 通过 globalVfs 打开 VFS 文件 ----------
window.openVideoFile = async function(filePath) {
    if (!window.vapp || !window.vapp.globalVfs) return;
    try {
        // 从 globalVfs 获取 Blob
        const blob = await window.vapp.globalVfs.getFile(filePath);
        if (!blob) throw new Error('文件不存在: ' + filePath);

        const url = URL.createObjectURL(blob);
        dp.switchVideo({
            url: url,
            type: 'auto'
        });

        const name = filePath.split('/').pop();
        videoName.textContent = name;
    } catch (err) {
        console.error('打开视频失败:', err);
    }
};

// ---------- 自动打开 vapp.params.file ----------
window.addEventListener('DOMContentLoaded', () => {
    const waitVapp = () => {
        if (window.vappok) {
            if (window.vapp?.params?.file) {
                openVideoFile(window.vapp.params.file);
            }
        } else {
            requestAnimationFrame(waitVapp);
        }
    };
    waitVapp();
});
