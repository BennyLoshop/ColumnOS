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

// 点击加载按钮
loadBtn.addEventListener('click', () => {
    videoFileInput.click();
});

// 选择文件后加载
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

// 支持 model 打开文件（示例）
window.openVideoFile = function(file) {
    if (!file) return;
    const fileURL = URL.createObjectURL(file);
    dp.switchVideo({ url: fileURL, type: 'auto' });
    videoName.textContent = file.name;
};
