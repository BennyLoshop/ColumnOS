const pdfCanvas = document.getElementById('pdfCanvas');
const ctx = pdfCanvas.getContext('2d');
const prevBtn = document.getElementById('prevPage');
const nextBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const scaleSelect = document.getElementById('scaleSelect');
const pageJump = document.getElementById('pageJump');
const jumpBtn = document.getElementById('jumpBtn');
const navBar = document.getElementById('navBar');
const pdfNameSpan = document.getElementById('pdfName');
const container = document.getElementById('canvasContainer');

const openFileBtn = document.getElementById('openFileBtn');
const fileModal = document.getElementById('fileModal');
const fileInput = document.getElementById('pdfFile');
const closeModal = document.querySelector('.close');
const toast = document.getElementById('toast');

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let scale = parseFloat(scaleSelect.value);
let pdfFileArrayBuffer = null;
let pageCache = {};
let currentPdfMD5 = null; // 当前 PDF MD5

// ---------- 等待 vapp 就绪 ----------
window.addEventListener('DOMContentLoaded', () => {
    const waitForVappOk = () => {
        try {
            if (window.vappok) {
                setupPdfWorker();
            } else {
                requestAnimationFrame(waitForVappOk);
            }
        } catch (e) {
            requestAnimationFrame(waitForVappOk);
        }
    };
    waitForVappOk();
});

async function setupPdfWorker() {
    try {
        if (!window.vapp.globalVfs) throw new Error("globalVfs 未就绪");
        const blob = await window.vapp.globalVfs.getFile("/system/app/com.columnos.reader.pdf/pdf.worker.min.js");
        if (!blob) throw new Error("pdf.worker.min.js 未找到");
        const blobUrl = URL.createObjectURL(blob);
        pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl;
        console.log('PDF.js Worker 已就绪');
    } catch (err) {
        console.error('设置 PDF Worker 出错', err);
    }
}

// ---------- MD5 计算 ----------
function calculateMD5(arrayBuffer) {
    return SparkMD5.ArrayBuffer.hash(arrayBuffer);
}


// ---------- IndexedDB ----------
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('pdfReaderDB', 1);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('progressStore')) {
                db.createObjectStore('progressStore', { keyPath: 'md5' });
            }
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

async function saveProgress(md5, page) {
    const db = await openDB();
    const tx = db.transaction('progressStore', 'readwrite');
    const store = tx.objectStore('progressStore');
    store.put({ md5, page });
    await tx.complete;
}

async function getProgress(md5) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('progressStore', 'readonly');
        const store = tx.objectStore('progressStore');
        const request = store.get(md5);
        request.onsuccess = () => resolve(request.result?.page || 1);
        request.onerror = () => reject(request.error);
    });
}

// ---------- 缓存前后 2 页 ----------
async function preloadAround(pageNum) {
  const list = [pageNum - 2, pageNum - 1, pageNum + 1, pageNum + 2];
  for (let p of list) {
    if (p < 1 || p > totalPages) continue;
    if (pageCache[p]) continue;

    const page = await pdfDoc.getPage(p);
    const viewport = page.getViewport({ scale: getAdjustedScale(page) });
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = viewport.width;
    tmpCanvas.height = viewport.height;

    await page.render({ canvasContext: tmpCanvas.getContext("2d"), viewport }).promise;
    const img = new Image();
    img.src = tmpCanvas.toDataURL();
    pageCache[p] = img;
  }
}

// ---------- 缩放计算 ----------
function getAdjustedScale(page) {
  const viewport = page.getViewport({ scale: 1 });
  const containerWidth = container.clientWidth;
  return (containerWidth / viewport.width) * scale;
}

// ---------- 渲染 ----------
async function renderPage(pageNum, animate = false) {
  if (!pdfDoc) return;

  if (pageCache[pageNum]) {
    const img = pageCache[pageNum];
    pdfCanvas.width = img.width;
    pdfCanvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  } else {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: getAdjustedScale(page) });
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const img = new Image();
    img.src = pdfCanvas.toDataURL();
    pageCache[pageNum] = img;
  }

  pageInfo.textContent = `${pageNum} / ${totalPages}`;
  updateNavButtons();
  if (animate) animateSlide();

  preloadAround(pageNum);

  // 自动保存阅读进度
  if (currentPdfMD5) saveProgress(currentPdfMD5, pageNum);
}

function queueRender(pageNum, animate = false) { renderPage(pageNum, animate); }

function updateNavButtons() {
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

// ---------- 翻页按钮 ----------
prevBtn.addEventListener('click', () => { 
  if (currentPage > 1) { 
    currentPage--; 
    queueRender(currentPage, true); 
  } 
});
nextBtn.addEventListener('click', () => { 
  if (currentPage < totalPages) { 
    currentPage++; 
    queueRender(currentPage, true); 
  } 
});

// ---------- 跳页 ----------
jumpBtn.addEventListener('click', () => {
  let p = parseInt(pageJump.value);
  if (!p || p < 1 || p > totalPages) return;
  currentPage = p;
  queueRender(currentPage, true);
});

// ---------- 文件选择 Modal ----------
openFileBtn.addEventListener('click', () => fileInput.click());
closeModal.addEventListener('click', () => fileModal.style.display = 'none');
window.addEventListener('click', e => { if (e.target === fileModal) fileModal.style.display = 'none'; });

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fileModal.style.display = 'none';
  pdfFileArrayBuffer = await file.arrayBuffer();
  pdfNameSpan.textContent = file.name;

  // 计算 MD5
  currentPdfMD5 = calculateMD5(pdfFileArrayBuffer);

  // 加载 PDF
  pdfDoc = await pdfjsLib.getDocument({ data: pdfFileArrayBuffer, worker: null }).promise;
  totalPages = pdfDoc.numPages;
  pageCache = {};

  // 恢复进度
  currentPage = await getProgress(currentPdfMD5);
  queueRender(currentPage);
});

// ---------- 左右滑动翻页 ----------
let touchStartX = 0;
pdfCanvas.addEventListener('touchstart', e => touchStartX = e.touches[0].clientX);
pdfCanvas.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;

  if (scale > 1) return; // 缩放大于1时禁用滑动翻页

  if (dx > 150 && currentPage > 1) {
    currentPage--;
    queueRender(currentPage, true);
  } else if (dx < -150 && currentPage < totalPages) {
    currentPage++;
    queueRender(currentPage, true);
  }
});

// ---------- Nav 隐藏/显示 ----------
let lastScrollTop = 0;
container.addEventListener('scroll', () => {
  const st = container.scrollTop;
  if (st > lastScrollTop + 10) navBar.classList.add('hidden');
  if (st <= 0) navBar.classList.remove('hidden');
  lastScrollTop = st;
});

// ---------- 翻页动画 ----------
function animateSlide() {
  pdfCanvas.style.transform = 'translateX(20px)';
  setTimeout(() => { pdfCanvas.style.transform = 'translateX(0)'; }, 200);
}

// ---------- 缩放 ----------
scaleSelect.addEventListener('change', () => {
  let val = parseFloat(scaleSelect.value);
  if (val > 2) val = 2;
  scale = val;
  pageCache = {};
  queueRender(currentPage);

  if (scale > 1) {
    showToast("缩放大于 1x，滑动翻页已禁用");
  }
});

// ---------- Toast ----------
function showToast(msg, duration = 1500) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}
