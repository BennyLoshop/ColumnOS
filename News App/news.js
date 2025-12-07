const newsListEl = document.getElementById("news-list");
const newsModal = document.getElementById("news-modal");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
const modalClose = document.getElementById("modal-close");

const pushDateEl = document.getElementById("push-date");
const pushSelectModal = document.getElementById("push-select-modal");
const pushSelectList = document.getElementById("push-select-list");
const pushSelectClose = document.getElementById("push-select-close");

const toastEl = document.getElementById("toast");

let currentPush = null;
let pushIndex = [];

// Toast
function toast(msg) {
  alert(msg);
}

// 等待 vapp
async function waitVapp() {
  if (window.vapp) return window.vapp;
  return new Promise(resolve => {
    const timer = setInterval(() => {
      if (window.vapp) {
        clearInterval(timer);
        resolve(window.vapp);
      }
    }, 100);
  });
}

// 保存推送
async function savePushData(pushData) {
    console.log("收到推送数据:", pushData);
    const vfs = window.vapp.globalVfs;

    try {
        // 下载 URL 对应的推送 JSON
        const resp = await fetch(pushData.url);
        if (!resp.ok) throw new Error("下载推送失败: " + resp.status);
        const jsonData = await resp.json();

        const time = jsonData.time;
        const timeFile = `/data/com.news/dailyPush/${time}.json`;

        // 保存到 VFS
        await vfs.setFile(timeFile, new Blob([JSON.stringify(jsonData, null, 4)], { type: "application/json" }));

        // 更新索引
        let index = [];
        try {
            const file = await vfs.getFile("/data/com.news/index.json");
            const text = await file.text();
            index = JSON.parse(text);
        } catch (e) { /* 文件不存在，创建新索引 */ }

        // 避免重复
        if (!index.find(i => i.time === time)) {
            index.unshift({ time, title: jsonData.data[0]?.title || "每日新闻" });
        }

        await vfs.setFile("/data/com.news/index.json", new Blob([JSON.stringify(index, null, 4)], { type: "application/json" }));
        pushIndex = index;


        // 提示
        toast("收到新推送: " + time);

        // 刷新 UI
        renderPushDate();
        renderNewsList(time);

    } catch (e) {
        console.error("保存推送失败", e);
        toast("保存推送失败");
    }
}


// 渲染右上日期
function renderPushDate() {
  if (pushIndex.length > 0) {
    pushDateEl.textContent = pushIndex[0].time;
  } else {
    pushDateEl.textContent = "暂无推送";
  }
}

// 渲染新闻列表
async function renderNewsList(time) {
  const vfs = window.vapp.globalVfs;
  try {
    const file = await vfs.getFile(`/data/com.news/dailyPush/${time}.json`);
    const text = await file.text();
    currentPush = JSON.parse(text);

    newsListEl.innerHTML = "";
    currentPush.data.forEach((item, idx) => {
      const li = document.createElement("li");
      li.innerHTML = `<h3>${idx + 1}. ${item.title}</h3><p>${item.description}</p>`;
      li.onclick = () => showNewsModal(item);
      newsListEl.appendChild(li);
    });
  } catch (e) {
    console.error(e);
  }
}

// 显示新闻 modal
function showNewsModal(item) {
  modalTitle.textContent = item.title;
  modalBody.innerHTML = item.content.map(p => `<p>${p}</p>`).join("");
  newsModal.style.display = "flex";
}

// 关闭 modal
modalClose.onclick = () => newsModal.style.display = "none";
pushSelectClose.onclick = () => pushSelectModal.style.display = "none";
window.onclick = e => {
  if (e.target === newsModal) newsModal.style.display = "none";
  if (e.target === pushSelectModal) pushSelectModal.style.display = "none";
}

// 右上切换推送
pushDateEl.onclick = () => {
  pushSelectList.innerHTML = "";
  pushIndex.forEach(item => {
    const div = document.createElement("div");
    div.textContent = item.time;
    div.className = "push-item";
    div.onclick = () => {
      renderNewsList(item.time);
      pushSelectModal.style.display = "none";
    };
    pushSelectList.appendChild(div);
  });
  pushSelectModal.style.display = "flex";
}

// 轮询推送
async function pollPush() {
  const vapp = await waitVapp();
  while (true) {
    if (!vapp.chunkStore) {
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    try {
      const items = await vapp.chunkStore.search("NEWS00");
      if (items && items.length > 0) {
        for (const str of items) {
          try {
            const msg = JSON.parse(str);
            await savePushData(msg);
            break;
          } catch (e) { console.warn(e); }
        }
      }
    } catch (e) { console.error(e); }
    await new Promise(r => setTimeout(r, 5000));
  }
}
let lastBackTime = 0;
const backTimeout = 1500; // 1.5 秒
let currentPath = "/"; // 当前页面路径，初始为根

window.addEventListener('OnVappReturn', (e) => {
  console.log('收到返回事件');

  // 阻止默认关闭行为
  e.preventDefault();

  // 如果 modal 打开，先关闭 modal
  if (newsModal.style.display === "flex") {
    newsModal.style.display = "none";
    return;
  }

  // 当前不在根目录
  if (currentPath !== "/") {
    const parts = currentPath.split("/").filter(p => p);
    parts.pop();
    currentPath = "/" + parts.join("/") || "/";
    refreshDir(currentPath);
  } else {
    const now = Date.now();
    if (now - lastBackTime < backTimeout) {
      console.log("退出应用或关闭页面");
      vapp.exit(); // 或其他退出逻辑
    } else {
      alert("2s内再次返回退出");
      lastBackTime = now;
    }
  }
});

// 初始化
(async () => {
  const vapp = await waitVapp();
  try {
    const file = await vapp.globalVfs.getFile("/data/com.news/index.json");
    const text = await file.text();
    pushIndex = JSON.parse(text);
  } catch (e) { pushIndex = []; }

  renderPushDate();
  if (pushIndex.length > 0) renderNewsList(pushIndex[0].time);

  pollPush();
})();
