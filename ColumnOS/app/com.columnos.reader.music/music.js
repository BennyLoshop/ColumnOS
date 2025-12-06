// -------------------- 初始化 APlayer --------------------
const ap = new APlayer({
    container: document.getElementById('playerContainer'),
    fixed: false,
    autoplay: false,
    theme: '#ff4081',
    audio: []
});

// -------------------- DOM 元素 --------------------
const loadBtn = document.getElementById('loadBtn');
const modeBtn = document.getElementById('modeBtn');
const musicFileInput = document.getElementById('musicFileInput');
const musicName = document.getElementById('musicName');
const playlistEl = document.getElementById('playlist');

// -------------------- 播放列表数据 --------------------
const audioList = [];  // [{name, url}]
let currentIndex = -1;
let loopMode = 'list'; // 'list' = 列表循环, 'single' = 单曲循环

// -------------------- 播放函数 --------------------
function playAudioByIndex(index) {
    if (index < 0 || index >= audioList.length) return;

    const { name, url } = audioList[index];
    currentIndex = index;

    ap.list.clear();
    ap.list.add([{ name, artist: '', url, cover: '' }]);
    ap.list.switch(0);
    ap.play();
    musicName.textContent = name;

    // 高亮当前播放
    Array.from(playlistEl.children).forEach((li, i) => {
        li.classList.toggle('active', i === index);
    });
}

// -------------------- 播放下一首 --------------------
function playNext() {
    if (audioList.length === 0) return;

    if (loopMode === 'single') {
        // 单曲循环，重新播放当前
        playAudioByIndex(currentIndex);
    } else {
        // 列表循环
        const nextIndex = (currentIndex + 1) % audioList.length;
        playAudioByIndex(nextIndex);
    }
}

// -------------------- 播放模式切换 --------------------
modeBtn.addEventListener('click', () => {
    loopMode = loopMode === 'list' ? 'single' : 'list';
    modeBtn.textContent = loopMode === 'list' ? '模式: 列表循环' : '模式: 单曲循环';
});

// -------------------- 本地文件上传 --------------------
loadBtn.addEventListener('click', () => musicFileInput.click());

musicFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const name = file.name;

    audioList.push({ name, url });

    const li = document.createElement('li');
    li.textContent = name;
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => playAudioByIndex(audioList.findIndex(a => a.name === name)));
    playlistEl.appendChild(li);

    playAudioByIndex(audioList.length - 1);
});

// -------------------- 打开 VFS 单个文件 --------------------
window.openMusicFile = async function (filePath) {
    if (!window.vapp || !window.vapp.globalVfs) return;

    try {
        const blob = await window.vapp.globalVfs.getFile(filePath);
        if (!blob) throw new Error('文件不存在: ' + filePath);

        const url = URL.createObjectURL(blob);
        const name = filePath.split('/').pop();

        audioList.push({ name, url });

        const li = document.createElement('li');
        li.textContent = name;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => playAudioByIndex(audioList.findIndex(a => a.name === name)));
        playlistEl.appendChild(li);

        playAudioByIndex(audioList.length - 1);

    } catch (err) {
        console.error('打开音乐失败:', err);
    }
};

// -------------------- 搜索 VFS 所有 MP3 并添加到播放列表 --------------------
async function loadAllMp3ToPlaylist() {
    if (!window.vapp || !window.vapp.globalVfs) return;

    try {
        const mp3Files = await window.vapp.globalVfs.searchFileByExt(".mp3");
        if (!mp3Files.length) return;

        for (const path of mp3Files) {
            const blob = await window.vapp.globalVfs.getFile(path);
            if (!blob) continue;

            const url = URL.createObjectURL(blob);
            const name = path.split('/').pop();

            audioList.push({ name, url });

            const li = document.createElement('li');
            li.textContent = name;
            li.style.cursor = 'pointer';
            li.addEventListener('click', () => playAudioByIndex(audioList.findIndex(a => a.name === name)));
            playlistEl.appendChild(li);
        }

        if (audioList.length > 0 && currentIndex === -1) playAudioByIndex(0);

    } catch (err) {
        console.error("加载 MP3 文件失败:", err);
    }
}

// -------------------- 页面加载后执行 --------------------
window.addEventListener('DOMContentLoaded', () => {
    const waitVapp = () => {
        if (window.vappok) {
            if (window.vapp?.params?.file) {
                openMusicFile(window.vapp.params.file);
                loadAllMp3ToPlaylist();
            } else {
                loadAllMp3ToPlaylist();
            }
        } else {
            requestAnimationFrame(waitVapp);
        }
    };
    waitVapp();
});

// -------------------- 自动播放下一首 --------------------
ap.on('ended', playNext);
