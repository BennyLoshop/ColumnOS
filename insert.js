// 检查本地存储中是否有保存的JS代码，有则执行


const storedJs = localStorage.getItem('injuredJs');
if (window.JsToJava && typeof window.JsToJava.checkUrls === "function") {
    console.log("[Bypass] 覆盖 JsToJava.checkUrls");
    window.JsToJava.checkUrls = function () {
        return "[]"; // 全通过
    };
}

// 4. 覆盖 Array.prototype.slice
const originalSlice = Array.prototype.slice;
Array.prototype.slice = function () {
    if (this[0] instanceof HTMLIFrameElement) return [];
    return originalSlice.apply(this, arguments);
};

// 5. 拦截 Element.remove
const originalRemove = Element.prototype.remove;
Element.prototype.remove = function () {
    if (this.tagName === "IFRAME") {
        console.warn("[Bypass] 阻止 iframe 删除：", this.src);
        return;
    }
    return originalRemove.call(this);
};

// 6. 拦截包含 JsToJava 检查的 setInterval
const originalSetInterval = window.setInterval;
window.setInterval = function (fn, delay, ...args) {
    const fnStr = fn.toString();
    if (fnStr.includes("JsToJava.checkUrls")) {
        console.warn("[Bypass] 阻止 iframe 白名单检查定时器");
        return -1;
    }
    return originalSetInterval(fn, delay, ...args);
};
if (storedJs) {
    try {
        console.log('检测到本地存储的JS代码，正在执行...');
        // 执行本地存储的代码
        eval(storedJs);
        // 如果本地代码执行成功，就不再执行下面的默认代码
        console.log('本地存储的JS代码执行完毕');
    } catch (error) {
        console.error('本地存储的JS代码执行出错：', error);
        alert('本地JS代码执行失败，请检查代码有效性');
        // 出错后继续执行默认代码
    }
} else {
    console.log('未检测到本地存储的JS代码，执行默认代码...');
}

// 默认代码 - 只有当本地存储中没有有效JS代码时才会执行
if (!storedJs || window.defaultCodeShouldRun) {
    const EbookDB = {
        dbName: 'EbookStorage',
        storeName: 'files',
        version: 1,
        db: null,

        // 初始化数据库
        init() {
            return new Promise((resolve, reject) => {
                if (this.db) {
                    resolve(this.db);
                    return;
                }

                // 打开数据库（版本号用于升级）
                const request = indexedDB.open(this.dbName, this.version);

                // 数据库首次创建或版本升级时触发
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    // 创建存储对象（类似表），主键为文件名
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName, {
                            keyPath: 'fileName',
                            autoIncrement: false
                        });
                    }
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    resolve(this.db);
                };

                request.onerror = (event) => {
                    console.error('IndexedDB初始化失败:', event.target.error);
                    reject(event.target.error);
                };
            });
        },

        // 存储文件（支持分块）
        saveFile(fileName, content, fileType = 'binary') {
            return new Promise(async (resolve, reject) => {
                try {
                    const db = await this.init();
                    const transaction = db.transaction(this.storeName, 'readwrite');
                    const store = transaction.objectStore(this.storeName);

                    // 存储文件元信息和内容（大文件已分块）
                    const request = store.put({
                        fileName,
                        content,       // 分块数组或完整内容
                        type: fileType,
                        timestamp: Date.now(), // 用于LRU缓存
                        size: this.calculateSize(content) // 计算存储大小
                    });

                    request.onsuccess = () => resolve(true);
                    request.onerror = () => reject(request.error);
                } catch (error) {
                    reject(error);
                }
            });
        },

        // 读取文件
        getFile(fileName) {
            return new Promise(async (resolve, reject) => {
                try {
                    const db = await this.init();
                    const transaction = db.transaction(this.storeName, 'readonly');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.get(fileName);

                    request.onsuccess = () => {
                        // 更新访问时间（用于LRU）
                        if (request.result) {
                            this.updateFileTimestamp(fileName);
                        }
                        resolve(request.result || null);
                    };
                    request.onerror = () => reject(request.error);
                } catch (error) {
                    reject(error);
                }
            });
        },

        // 删除文件
        deleteFile(fileName) {
            return new Promise(async (resolve, reject) => {
                try {
                    const db = await this.init();
                    const transaction = db.transaction(this.storeName, 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.delete(fileName);

                    request.onsuccess = () => resolve(true);
                    request.onerror = () => reject(request.error);
                } catch (error) {
                    reject(error);
                }
            });
        },

        // 获取所有文件（用于LRU清理）
        getAllFiles() {
            return new Promise(async (resolve, reject) => {
                try {
                    const db = await this.init();
                    const transaction = db.transaction(this.storeName, 'readonly');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.getAll();

                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                } catch (error) {
                    reject(error);
                }
            });
        },

        // 更新文件时间戳（用于LRU）
        updateFileTimestamp(fileName) {
            return new Promise(async (resolve) => {
                try {
                    const file = await this.getFile(fileName);
                    if (file) {
                        file.timestamp = Date.now();
                        await this.saveFile(file.fileName, file.content, file.type);
                    }
                    resolve(true);
                } catch (error) {
                    console.error('更新时间戳失败:', error);
                    resolve(false);
                }
            });
        },

        // 计算内容大小（字节）
        calculateSize(content) {
            if (Array.isArray(content)) {
                // 分块存储时计算总大小
                return content.reduce((total, chunk) => total + chunk.length, 0);
            }
            return content ? new TextEncoder().encode(content).length : 0;
        }
    };

    // 2. 大文件分块存储管理器
    const ChunkManager = {
        chunkSize: 2 * 1024 * 1024, // 2MB每块（可根据WebView性能调整）

        // 分割内容为块
        splitContent(content) {
            const chunks = [];
            for (let i = 0; i < content.length; i += this.chunkSize) {
                chunks.push(content.slice(i, i + this.chunkSize));
            }
            return chunks;
        },

        // 合并块为完整内容
        mergeChunks(chunks) {
            return chunks.join('');
        }
    };

    // 3. LRU缓存策略（自动清理最旧文件）
    const CacheManager = {
        // 最大缓存大小（根据设备调整，默认500MB）
        maxTotalSize: 500 * 1024 * 1024,

        // 检查并清理空间
        async ensureSpace(requiredSize) {
            const files = await EbookDB.getAllFiles();
            const totalSize = files.reduce((sum, file) => sum + file.size, 0);

            // 空间足够，直接返回
            if (totalSize + requiredSize <= this.maxTotalSize) {
                return true;
            }

            // 空间不足，按时间戳排序（旧的在前）
            const sortedFiles = [...files].sort((a, b) => a.timestamp - b.timestamp);
            let freedSize = 0;

            // 逐个删除最旧的文件，直到有足够空间
            for (const file of sortedFiles) {
                await EbookDB.deleteFile(file.fileName);
                freedSize += file.size;

                if (totalSize - freedSize + requiredSize <= this.maxTotalSize) {
                    return true;
                }
            }

            // 所有文件都删了还是不够
            return false;
        }
    };

    // 4. 对外暴露的存储API（整合上述功能）
    const EbookStorage = {
        // 保存文件（自动分块和空间检查）
        async save(fileName, content, fileType = 'binary') {
            try {
                // 大文件分块
                const chunks = ChunkManager.splitContent(content);
                const requiredSize = EbookDB.calculateSize(chunks);

                // 检查并清理空间
                const hasSpace = await CacheManager.ensureSpace(requiredSize);
                if (!hasSpace) {
                    throw new Error('存储空间不足，无法保存文件');
                }

                // 保存到IndexedDB
                return await EbookDB.saveFile(fileName, chunks, fileType);
            } catch (error) {
                console.error('保存文件失败:', error);
                return false;
            }
        },

        // 读取文件（自动合并分块）
        async read(fileName) {
            try {
                const file = await EbookDB.getFile(fileName);
                if (!file) return null;

                // 合并分块
                return ChunkManager.mergeChunks(file.content);
            } catch (error) {
                console.error('读取文件失败:', error);
                return null;
            }
        },

        // 删除文件
        async delete(fileName) {
            try {
                return await EbookDB.deleteFile(fileName);
            } catch (error) {
                console.error('删除文件失败:', error);
                return false;
            }
        },

        // 检查文件是否存在
        async exists(fileName) {
            try {
                const file = await EbookDB.getFile(fileName);
                return !!file;
            } catch (error) {
                return false;
            }
        },

        // 清理所有缓存
        async clearAll() {
            try {
                const files = await EbookDB.getAllFiles();
                for (const file of files) {
                    await EbookDB.deleteFile(file.fileName);
                }
                return true;
            } catch (error) {
                console.error('清理缓存失败:', error);
                return false;
            }
        },

        // 获取缓存文件列表及大小
        async getCacheInfo() {
            try {
                const files = await EbookDB.getAllFiles();
                const totalSize = files.reduce((sum, file) => sum + file.size, 0);
                return {
                    files: files.map(file => ({
                        name: file.fileName,
                        size: file.size,
                        type: file.type,
                        lastAccessed: new Date(file.timestamp).toLocaleString()
                    })),
                    totalSize
                };
            } catch (error) {
                console.error('获取缓存信息失败:', error);
                return { files: [], totalSize: 0 };
            }
        }
    };

    // 5. 中文字符编码处理（修复btoa问题）
    function utf8ToBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }

    function base64ToUtf8(str) {
        return decodeURIComponent(escape(atob(str)));
    }
    /**
 * 从index.json获取文件列表并依次缓存
 */
    async function fetchAllFiles() {
        // 创建进度显示元素
        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background: rgba(255,255,255,0.9);
        z-index: 9999;
        font-family: Arial, sans-serif;
        transition: opacity 0.5s ease;
    `;

        const progressText = document.createElement('div');
        progressText.style.cssText = `font-size: 18px; color: #333; margin-bottom: 15px;`;
        progressText.textContent = '缓存进度: 0%';

        const progressBarContainer = document.createElement('div');
        progressBarContainer.style.cssText = `
        width: 80%;
        max-width: 600px;
        height: 24px;
        background: #e0e0e0;
        border-radius: 12px;
        overflow: hidden;
    `;

        const progressBar = document.createElement('div');
        progressBar.style.cssText = `
        height: 100%;
        width: 0%;
        background: #4CAF50;
        border-radius: 12px;
        transition: width 0.3s ease;
    `;

        const statusText = document.createElement('div');
        statusText.style.cssText = `
        font-size: 14px;
        color: #666;
        margin-top: 15px;
        max-width: 80%;
        text-align: center;
        word-break: break-all;
    `;
        statusText.textContent = '准备开始缓存...';

        progressBarContainer.appendChild(progressBar);
        progressContainer.append(progressText, progressBarContainer, statusText);
        document.body.appendChild(progressContainer);

        // 带超时和重试的fetch函数
        const fetchWithRetry = async (url, maxRetries = 3, timeout = 10000) => {
            let retries = 0;

            while (retries < maxRetries) {
                try {
                    // 创建控制器用于超时控制
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeout);

                    const response = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeoutId); // 清除超时

                    if (!response.ok) {
                        throw new Error(`HTTP错误: ${response.status}`);
                    }

                    return response; // 成功返回响应

                } catch (error) {
                    retries++;
                    // 如果是最后一次重试失败，则抛出错误
                    if (retries >= maxRetries) {
                        throw new Error(`经过${maxRetries}次重试后仍失败: ${error.message}`);
                    }

                    // 等待一段时间后重试（指数退避策略）
                    const delay = 1000 * Math.pow(2, retries); // 1s, 2s, 4s...
                    console.log(`第${retries}次重试失败，将在${delay}ms后重试: ${url}`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };

        // 核心缓存逻辑
        const baseUrl = "http://sxz.school.zykj.org/i_res/";

        const timestamp = new Date().getTime();
        const indexUrl = `${baseUrl}index.json`;

        try {
            statusText.textContent = '正在获取文件索引...';
            const indexResponse = await fetchWithRetry(indexUrl);
            const items = await indexResponse.json();
            const files = items.filter(item => item.type === "file");
            const total = files.length;
            let completed = 0;
            let failed = 0;

            statusText.textContent = `发现 ${total} 个文件，准备缓存...`;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileUrl = baseUrl + file.path; // 编码路径防止错误
                const currentFileIndex = i + 1;

                try {
                    statusText.textContent = `正在缓存 (${currentFileIndex}/${total}): ${file.path}`;
                    console.log(`开始缓存第${currentFileIndex}个文件: ${file.path}`);

                    // 使用带重试的fetch
                    await fetchWithRetry(fileUrl);

                    completed++;
                    const progress = Math.round((completed / total) * 100);
                    progressBar.style.width = `${progress}%`;
                    progressText.textContent = `缓存进度: ${progress}% (成功: ${completed}/${total})`;
                    statusText.textContent = `已完成 (${currentFileIndex}/${total}): ${file.path}`;

                } catch (error) {
                    failed++;
                    console.error(`文件 ${file.path} 最终缓存失败:`, error);
                    statusText.textContent = `缓存失败 (${currentFileIndex}/${total}，重试3次后): ${file.path}`;
                }
            }

            // 缓存完成处理
            statusText.textContent = `全部完成！共 ${total} 个文件，成功 ${completed} 个，失败 ${failed} 个`;
            setTimeout(() => {
                progressContainer.style.opacity = '0';
                setTimeout(() => progressContainer.remove(), 500);
            }, 2000);

        } catch (error) {
            console.error('整体错误:', error);
            progressText.textContent = '缓存中断';
            statusText.textContent = `错误: ${error.message}`;

            setTimeout(() => {
                progressContainer.style.opacity = '0';
                setTimeout(() => progressContainer.remove(), 500);
            }, 3000);
        }
    }
    // 执行文件缓存流程
    function createFullscreenDiv(title = "全屏面板") {
        // 创建全屏容器
        const fullscreenDiv = document.createElement('div');
        fullscreenDiv.id = "fullscreenDiv";
        fullscreenDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background-color: #fff;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        box-shadow: 0 0 10px rgba(0,0,0,0.2);
    `;

        // 创建标题栏
        const titleBar = document.createElement('div');
        titleBar.style.cssText = `
        height: 50px;
        background-color: #f5f5f5;
        border-bottom: 1px solid #e0e0e0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 20px;
        box-sizing: border-box;
    `;

        // 标题文本
        const titleText = document.createElement('div');
        titleText.style.cssText = `
        font-size: 16px;
        font-weight: 600;
        color: #333;
    `;
        titleText.textContent = title;

        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = `
        width: 30px;
        height: 30px;
        border: none;
        background-color: transparent;
        cursor: pointer;
        font-size: 20px;
        color: #666;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s;
    `;
        closeBtn.innerHTML = '×';
        closeBtn.title = '关闭';

        // 按钮悬停效果
        closeBtn.addEventListener('mouseover', () => {
            closeBtn.style.backgroundColor = '#eee';
            closeBtn.style.color = '#f44336';
        });
        closeBtn.addEventListener('mouseout', () => {
            closeBtn.style.backgroundColor = 'transparent';
            closeBtn.style.color = '#666';
        });

        // 关闭功能
        closeBtn.addEventListener('click', () => {
            // 添加入场动画
            fullscreenDiv.style.opacity = '0';
            fullscreenDiv.style.transform = 'scale(0.95)';
            // 动画结束后移除元素
            setTimeout(() => {
                fullscreenDiv.remove();
            }, 300);
        });

        // 内容区域（可自定义内容）
        const contentArea = document.createElement('div');
        contentArea.style.cssText = `
        flex: 1;
        padding: 20px;
        overflow: auto;
    `;
        contentArea.innerHTML = '<p>这里是全屏面板的内容区域</p>';

        // 组装元素
        titleBar.append(titleText, closeBtn);
        fullscreenDiv.append(titleBar, contentArea);

        // 添加入场动画
        fullscreenDiv.style.opacity = '0';
        fullscreenDiv.style.transform = 'scale(0.95)';
        fullscreenDiv.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

        // 添加到页面
        document.body.appendChild(fullscreenDiv);

        // 触发动画
        setTimeout(() => {
            fullscreenDiv.style.opacity = '1';
            fullscreenDiv.style.transform = 'scale(1)';
        }, 10);

        // 返回创建的元素，方便后续操作
        return {
            container: fullscreenDiv,
            titleBar: titleBar,
            contentArea: contentArea,
            closeBtn: closeBtn
        };
    }

    // 自定义alert函数（保持不变）
    function alert(message) {
        return new Promise((resolve) => {
            // 创建模态框容器
            const modalContainer = document.createElement('div');
            modalContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            -webkit-tap-highlight-color: transparent;
        `;

            // 创建模态框主体
            const modal = document.createElement('div');
            modal.style.cssText = `
            background: white;
            border-radius: 12px;
            width: 92%;
            max-width: 500px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
            overflow: hidden;
        `;

            // 创建内容区域
            const content = document.createElement('div');
            content.textContent = message;
            content.style.cssText = `
            padding: 24px 20px;
            font-size: 16px;
            color: #333;
            line-height: 1.5;
            text-align: center;
            word-break: break-word;
white-space: pre-wrap;
        `;

            // 创建按钮容器
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = `
            display: flex;
            border-top: 1px solid #eee;
        `;

            // 创建确认按钮
            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = '确定';
            confirmBtn.style.cssText = `
            flex: 1;
            padding: 16px;
            font-size: 16px;
            color: #007aff;
            background: transparent;
            border: none;
            cursor: pointer;
            font-weight: 600;
        `;

            // 按钮交互效果
            confirmBtn.addEventListener('touchstart', () => confirmBtn.style.background = '#f0f0f0');
            confirmBtn.addEventListener('touchend', () => confirmBtn.style.background = 'transparent');
            confirmBtn.addEventListener('mouseover', () => confirmBtn.style.background = '#f5f5f5');
            confirmBtn.addEventListener('mouseout', () => confirmBtn.style.background = 'transparent');

            // 关闭模态框
            const closeModal = () => {
                document.body.removeChild(modalContainer);
                resolve();
            };

            // 绑定按钮事件
            confirmBtn.addEventListener('click', closeModal);

            // 组装模态框
            buttonContainer.appendChild(confirmBtn);
            modal.append(content, buttonContainer);
            modalContainer.appendChild(modal);
            document.body.appendChild(modalContainer);
        });
    }
    const PdfIdMapper = {
        // 存储文件名到ID的映射
        setMapping(pdfId, fileName) {
            try {
                const mappings = JSON.parse(localStorage.getItem('pdfIdMappings') || '{}');
                mappings[pdfId] = fileName;
                localStorage.setItem('pdfIdMappings', JSON.stringify(mappings));
            } catch (e) {
                console.error('Failed to save PDF ID mapping:', e);
            }
        },

        // 获取ID对应的文件名
        getFileName(pdfId) {
            try {
                const mappings = JSON.parse(localStorage.getItem('pdfIdMappings') || '{}');
                return mappings[pdfId] || null;
            } catch (e) {
                console.error('Failed to get PDF ID mapping:', e);
                return null;
            }
        },

        // 生成唯一PDF ID
        generatePdfId(fileName) {
            // 处理中文字符编码
            const encodedName = utf8ToBase64(fileName)
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            return `pdf_${encodedName}_${Date.now()}`;
        }
    };

    // 7. 电子书列表主函数（核心修改：PDF打开方式改为iframe）
    async function showBookList() {
        // 创建全屏弹出窗口容器
        const modalContainer = document.createElement('div');
        modalContainer.style.cssText = `
position: fixed;
top: 0;
left: 0;
width: 100%;
height: 100%;
background: rgba(0, 0, 0, 0.5);
display: flex;
justify-content: center;
align-items: center;
z-index: 9999;
-webkit-tap-highlight-color: transparent;
`;

        // 创建窗口主体
        const modal = document.createElement('div');
        modal.style.cssText = `
background: white;
border-radius: 12px;
width: 92%;
max-width: 800px;
max-height: 90vh;
box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
overflow: hidden;
display: flex;
flex-direction: column;
`;

        // 创建标题栏和按钮（已移除清除缓存按钮）
        const header = document.createElement('div');
        header.style.cssText = `
padding: 16px 20px;
background: #f5f5f5;
border-bottom: 1px solid #eee;
font-size: 18px;
font-weight: 600;
color: #333;
display: flex;
justify-content: space-between;
align-items: center;
`;
        header.textContent = '电子书列表';

        const headerButtons = document.createElement('div');
        headerButtons.style.display = 'flex';

        const syncBtn = document.createElement('button');
        syncBtn.textContent = '同步列表';
        syncBtn.style.cssText = `
padding: 6px 12px;
font-size: 14px;
color: #007aff;
background: transparent;
border: 1px solid #007aff;
border-radius: 4px;
cursor: pointer;
margin-right: 10px;
`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
width: 36px;
height: 36px;
border: none;
background: transparent;
border-radius: 50%;
font-size: 20px;
color: #666;
cursor: pointer;
display: flex;
align-items: center;
justify-content: center;
`;

        // 按钮交互效果
        syncBtn.addEventListener('touchstart', () => syncBtn.style.background = '#f0f0f0');
        syncBtn.addEventListener('touchend', () => syncBtn.style.background = 'transparent');
        syncBtn.addEventListener('mouseover', () => syncBtn.style.background = '#f5f5f5');
        syncBtn.addEventListener('mouseout', () => syncBtn.style.background = 'transparent');

        closeBtn.addEventListener('touchstart', () => closeBtn.style.background = '#e0e0e0');
        closeBtn.addEventListener('touchend', () => closeBtn.style.background = 'transparent');
        closeBtn.addEventListener('mouseover', () => closeBtn.style.background = '#e0e0e0');
        closeBtn.addEventListener('mouseout', () => closeBtn.style.background = 'transparent');

        headerButtons.append(syncBtn, closeBtn);  // 已移除清除缓存按钮
        header.appendChild(headerButtons);

        // 创建内容容器
        const contentContainer = document.createElement('div');
        contentContainer.style.cssText = `
flex: 1;
overflow: hidden;
display: flex;
flex-direction: column;
`;

        const initialMessage = document.createElement('div');
        initialMessage.style.cssText = `
padding: 40px 20px;
text-align: center;
color: #666;
font-size: 16px;
flex: 1;
display: flex;
align-items: center;
justify-content: center;
`;
        initialMessage.textContent = '点击"同步列表"获取电子书';
        contentContainer.appendChild(initialMessage);

        modal.append(header, contentContainer);
        modalContainer.appendChild(modal);
        document.body.appendChild(modalContainer);

        // 关闭窗口函数
        const closeModal = () => {
            // 重置所有列表项的背景色
            const listItems = document.querySelectorAll('.book-list-item');
            listItems.forEach(item => {
                item.style.background = 'transparent';
            });
            modalContainer.remove();
        };

        closeBtn.addEventListener('click', closeModal);

        // 本地存储辅助函数
        const loadFromLocalStorage = () => {
            const storedBooks = localStorage.getItem('bookList');
            if (storedBooks) {
                try {
                    return JSON.parse(storedBooks);
                } catch (e) {
                    console.error('Failed to parse stored books:', e);
                    localStorage.removeItem('bookList');
                }
            }
            return null;
        };

        const saveToLocalStorage = (books) => {
            try {
                localStorage.setItem('bookList', JSON.stringify(books));
            } catch (e) {
                console.error('Failed to save books to localStorage:', e);
            }
        };

        const saveServerIp = (ip) => {
            try {
                localStorage.setItem('serverIp', ip);
            } catch (e) {
                console.error('Failed to save server IP:', e);
            }
        };

        const getServerIp = () => {
            try {
                return localStorage.getItem('serverIp') || '';
            } catch (e) {
                console.error('Failed to get server IP:', e);
                return '';
            }
        };

        // 保存和获取TXT阅读进度
        const saveReadingProgress = (fileKey, scrollTop) => {
            try {
                const progressData = JSON.parse(localStorage.getItem('readingProgress') || '{}');
                progressData[fileKey] = scrollTop;
                localStorage.setItem('readingProgress', JSON.stringify(progressData));
            } catch (e) {
                console.error('Failed to save reading progress:', e);
            }
        };

        const getReadingProgress = (fileKey) => {
            try {
                const progressData = JSON.parse(localStorage.getItem('readingProgress') || '{}');
                return progressData[fileKey] || 0;
            } catch (e) {
                console.error('Failed to get reading progress:', e);
                return 0;
            }
        };

        // IP输入弹窗
        const promptServerIp = async () => {
            return new Promise((resolve) => {
                const ipModalContainer = document.createElement('div');
                ipModalContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;

                const ipModal = document.createElement('div');
                ipModal.style.cssText = `
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 400px;
        padding: 24px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
    `;

                const title = document.createElement('div');
                title.textContent = '请输入服务器IP';
                title.style.cssText = `
        font-size: 18px;
        font-weight: 600;
        color: #333;
        margin-bottom: 16px;
        text-align: center;
    `;

                const input = document.createElement('input');
                input.type = 'text';
                input.style.cssText = `
        width: 100%;
        padding: 12px 16px;
        border: 1px solid #ddd;
        border-radius: 8px;
        font-size: 16px;
        margin-bottom: 20px;
        box-sizing: border-box;
    `;
                const lastIp = getServerIp();
                if (lastIp) input.value = lastIp;
                else input.placeholder = '例如: 192.168.1.100:8765';

                const btnContainer = document.createElement('div');
                btnContainer.style.display = 'flex';
                btnContainer.style.gap = '10px';

                const cancelBtn = document.createElement('button');
                cancelBtn.textContent = '取消';
                cancelBtn.style.cssText = `
        flex: 1;
        padding: 12px;
        font-size: 16px;
        border: 1px solid #ddd;
        border-radius: 8px;
        background: transparent;
        color: #666;
        cursor: pointer;
    `;

                const confirmBtn = document.createElement('button');
                confirmBtn.textContent = '确认';
                confirmBtn.style.cssText = `
        flex: 1;
        padding: 12px;
        font-size: 16px;
        border: none;
        border-radius: 8px;
        background: #007aff;
        color: white;
        cursor: pointer;
        font-weight: 600;
    `;

                cancelBtn.addEventListener('click', () => {
                    ipModalContainer.remove();
                    resolve(null);
                });

                confirmBtn.addEventListener('click', () => {
                    const ip = input.value.trim();
                    if (ip) {
                        saveServerIp(ip);
                        ipModalContainer.remove();
                        resolve(ip);
                    } else {
                        input.style.borderColor = '#ff3b30';
                        input.placeholder = '请输入有效的服务器IP和端口';
                    }
                });

                btnContainer.append(cancelBtn, confirmBtn);
                ipModal.append(title, input, btnContainer);
                ipModalContainer.appendChild(ipModal);
                document.body.appendChild(ipModalContainer);
            });
        };

        // 创建通用加载提示
        const createLoadingContainer = (title) => {
            const loadingContainer = document.createElement('div');
            loadingContainer.className = 'loading-container';
            loadingContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(255, 255, 255, 0.9);
    z-index: 10000;
    display: flex;
    flex-direction: column;
    -webkit-tap-highlight-color: transparent;
`;

            const loadingHeader = document.createElement('div');
            loadingHeader.style.cssText = `
    padding: 16px 20px;
    background: #f5f5f5;
    border-bottom: 1px solid #eee;
    font-size: 18px;
    font-weight: 600;
    color: #333;
`;
            loadingHeader.textContent = title;

            const loadingContent = document.createElement('div');
            loadingContent.style.cssText = `
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
`;

            const spinner = document.createElement('div');
            spinner.style.cssText = `
    width: 40px;
    height: 40px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #007aff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 20px;
`;

            const loadingText = document.createElement('div');
            loadingText.textContent = '正在加载...';
            loadingText.style.cssText = `
    font-size: 16px;
    color: #666;
`;

            // 添加旋转动画
            const style = document.createElement('style');
            style.textContent = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;
            document.head.appendChild(style);

            loadingContent.append(spinner, loadingText);
            loadingContainer.append(loadingHeader, loadingContent);

            return loadingContainer;
        };

        // 渲染书籍列表（优化：先显示格子，后显示名称）
        const renderBooks = async (books) => {
            contentContainer.innerHTML = '';

            const listContainer = document.createElement('div');
            listContainer.style.cssText = `
    flex: 1;
    overflow-y: auto;
`;
            contentContainer.appendChild(listContainer);

            if (books.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.style.cssText = `
        padding: 40px 20px;
        text-align: center;
        color: #666;
        font-size: 16px;
    `;
                emptyMsg.textContent = '暂无电子书';
                listContainer.appendChild(emptyMsg);
                return;
            }

            // 先创建所有列表项框架（格子）
            books.forEach(book => {
                const bookItem = document.createElement('div');
                bookItem.className = 'book-list-item';
                bookItem.dataset.bookUrl = book.url; // 用于后续匹配
                bookItem.style.cssText = `
        padding: 16px 20px;
        border-bottom: 1px solid #eee;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;

                // 显示占位内容
                bookItem.innerHTML = `
        <div>
            <span style="font-size: 16px; color: #ccc; background: #f5f5f5; height: 20px; width: 60%; display: inline-block; border-radius: 4px;"></span>
            <span style="margin-left: 8px; font-size: 12px; color: #ccc; background: #f5f5f5; padding: 2px 6px; border-radius: 4px; height: 16px; width: 30px; display: inline-block;"></span>
        </div>
        <span style="font-size: 14px; color: #ccc;">查看 &gt;</span>
    `;

                listContainer.appendChild(bookItem);
            });

            // 延迟加载内容，实现先显示格子后显示名称的效果
            setTimeout(async () => {
                const bookItems = listContainer.querySelectorAll('.book-list-item');

                for (let i = 0; i < books.length; i++) {
                    const book = books[i];
                    const bookItem = bookItems[i];

                    if (!bookItem || bookItem.dataset.bookUrl !== book.url) continue;

                    const isPdf = book.url.toLowerCase().endsWith('.pdf');
                    const isTxt = book.url.toLowerCase().endsWith('.txt');
                    const fileType = isPdf ? 'PDF' : isTxt ? 'TXT' : '文件';
                    const fileName = book.url.split('/').pop();

                    // 检查是否有阅读进度
                    const hasProgress = isTxt && getReadingProgress(fileName) > 0;

                    bookItem.innerHTML = `
            <div>
                <span style="font-size: 16px; color: #333;">${book.name}</span>
                <span style="margin-left: 8px; font-size: 12px; color: #999; background: #f5f5f5; padding: 2px 6px; border-radius: 4px;">${fileType}</span>
                ${hasProgress ?
                            '<span style="margin-left: 8px; font-size: 12px; color: #ff9500; background: #fff7e6; padding: 2px 6px; border-radius: 4px;">有阅读进度</span>' : ''}
            </div>
            <span style="font-size: 14px; color: #007aff;">查看 &gt;</span>
            `;

                    // 添加点击事件（在内容加载完成后）
                    bookItem.addEventListener('click', async () => {
                        const serverIp = getServerIp();

                        if (isPdf) {
                            // 显示PDF加载提示
                            const loadingContainer = createLoadingContainer(book.name);
                            document.body.appendChild(loadingContainer);
                            modalContainer.remove();

                            try {
                                const pdfContent = await EbookStorage.read(fileName);

                                if (pdfContent) {
                                    const pdfId = PdfIdMapper.generatePdfId(fileName);
                                    PdfIdMapper.setMapping(pdfId, fileName);

                                    const iframeContainer = document.createElement('div');
                                    iframeContainer.style.cssText = `
                            position: fixed;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            background: #fff;
                            z-index: 10000;
                        `;

                                    // 仅保留右上角关闭按钮，无标题栏
                                    const closeBtn = document.createElement('button');
                                    closeBtn.textContent = '×';
                                    closeBtn.style.cssText = `
                            width: 44px;
                            height: 44px;
                            border: none;
                            background: rgba(255, 255, 255, 0.8);
                            border-radius: 50%;
                            font-size: 24px;
                            color: #333;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            position: absolute;
                            top: 16px;
                            right: 16px;
                            z-index: 10001; /* 确保在iframe上层 */
                            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                        `;

                                    // 按钮交互效果
                                    closeBtn.addEventListener('touchstart', () => closeBtn.style.background = 'rgba(240, 240, 240, 0.8)');
                                    closeBtn.addEventListener('touchend', () => closeBtn.style.background = 'rgba(255, 255, 255, 0.8)');
                                    closeBtn.addEventListener('mouseover', () => closeBtn.style.background = 'rgba(240, 240, 240, 0.8)');
                                    closeBtn.addEventListener('mouseout', () => closeBtn.style.background = 'rgba(255, 255, 255, 0.8)');

                                    closeBtn.addEventListener('click', () => {
                                        iframeContainer.remove();
                                        document.body.appendChild(modalContainer);
                                        bookItem.style.background = 'transparent';
                                    });

                                    const iframe = document.createElement('iframe');
                                    iframe.src = `http://sxz.school.zykj.org/i_res/pdfview/web/viewer.html#${pdfId}`;
                                    iframe.style.cssText = `
                            width: 100%;
                            height: 100%;
                            border: none;
                        `;

                                    // 等待iframe加载完成后移除加载提示
                                    iframe.onload = () => {
                                        loadingContainer.remove();
                                    };

                                    iframeContainer.append(closeBtn, iframe);
                                    document.body.appendChild(iframeContainer);
                                } else {
                                    // 从服务器获取PDF
                                    const result = await fetchFileContent(serverIp, book.url, fileName, true);
                                    if (result) {
                                        const pdfContent = await EbookStorage.read(fileName);
                                        if (pdfContent) {
                                            const pdfId = PdfIdMapper.generatePdfId(fileName);
                                            PdfIdMapper.setMapping(pdfId, fileName);

                                            const iframeContainer = document.createElement('div');
                                            iframeContainer.style.cssText = `
                                    position: fixed;
                                    top: 0;
                                    left: 0;
                                    width: 100%;
                                    height: 100%;
                                    background: #fff;
                                    z-index: 10000;
                                `;

                                            // 仅保留右上角关闭按钮，无标题栏
                                            const closeBtn = document.createElement('button');
                                            closeBtn.textContent = '×';
                                            closeBtn.style.cssText = `
                                    width: 44px;
                                    height: 44px;
                                    border: none;
                                    background: rgba(255, 255, 255, 0.8);
                                    border-radius: 50%;
                                    font-size: 24px;
                                    color: #333;
                                    cursor: pointer;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    position: absolute;
                                    top: 16px;
                                    right: 16px;
                                    z-index: 10001; /* 确保在iframe上层 */
                                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                                `;

                                            // 按钮交互效果
                                            closeBtn.addEventListener('touchstart', () => closeBtn.style.background = 'rgba(240, 240, 240, 0.8)');
                                            closeBtn.addEventListener('touchend', () => closeBtn.style.background = 'rgba(255, 255, 255, 0.8)');
                                            closeBtn.addEventListener('mouseover', () => closeBtn.style.background = 'rgba(240, 240, 240, 0.8)');
                                            closeBtn.addEventListener('mouseout', () => closeBtn.style.background = 'rgba(255, 255, 255, 0.8)');

                                            closeBtn.addEventListener('click', () => {
                                                iframeContainer.remove();
                                                document.body.appendChild(modalContainer);
                                                bookItem.style.background = 'transparent';
                                            });

                                            const iframe = document.createElement('iframe');
                                            iframe.src = `viewer.html#${pdfId}`;
                                            iframe.style.cssText = `
                                    width: 100%;
                                    height: 100%;
                                    border: none;
                                `;

                                            // 等待iframe加载完成后移除加载提示
                                            iframe.onload = () => {
                                                loadingContainer.remove();
                                            };

                                            iframeContainer.append(closeBtn, iframe);
                                            document.body.appendChild(iframeContainer);
                                        } else {
                                            loadingContainer.remove();
                                            alert('无法加载PDF内容');
                                            document.body.appendChild(modalContainer);
                                        }
                                    } else {
                                        loadingContainer.remove();
                                        alert('获取PDF失败');
                                        document.body.appendChild(modalContainer);
                                    }
                                }
                            } catch (error) {
                                console.error('PDF加载错误:', error);
                                loadingContainer.remove();
                                alert('PDF加载失败');
                                document.body.appendChild(modalContainer);
                            }
                        } else if (isTxt) {
                            // 显示TXT加载提示
                            const loadingContainer = createTxtLoadingContainer(book.name);
                            document.body.appendChild(loadingContainer);
                            modalContainer.remove();

                            try {
                                let content;
                                if (await EbookStorage.exists(fileName)) {
                                    content = await EbookStorage.read(fileName);
                                } else {
                                    content = await fetchFileContent(serverIp, book.url, fileName, false);
                                }

                                if (content) {
                                    loadingContainer.remove();
                                    openTxtContent(content, book.name, fileName);
                                } else {
                                    loadingContainer.remove();
                                    alert('无法加载TXT内容');
                                    document.body.appendChild(modalContainer);
                                }
                            } catch (error) {
                                console.error('加载TXT内容失败:', error);
                                loadingContainer.remove();
                                alert('加载TXT内容失败');
                                document.body.appendChild(modalContainer);
                            }
                        } else {
                            alert('不支持的文件格式');
                            bookItem.style.background = 'transparent';
                        }
                    });

                    // 交互样式
                    bookItem.addEventListener('touchstart', () => bookItem.style.background = '#f0f0f0');
                    bookItem.addEventListener('touchend', () => bookItem.style.background = 'transparent');
                    bookItem.addEventListener('mouseover', () => bookItem.style.background = '#f5f5f5');
                    bookItem.addEventListener('mouseout', () => bookItem.style.background = 'transparent');
                    bookItem.addEventListener('click', () => {
                        setTimeout(() => bookItem.style.background = 'transparent', 100);
                    });

                    // 逐个显示，增强加载感
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }, 300); // 延迟显示内容，确保格子先渲染出来
        };

        // 创建TXT加载容器
        const createTxtLoadingContainer = (fileName) => {
            const loadingContainer = document.createElement('div');
            loadingContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: white;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    -webkit-tap-highlight-color: transparent;
`;

            const loadingHeader = document.createElement('div');
            loadingHeader.style.cssText = `
    padding: 16px 20px;
    background: #f5f5f5;
    border-bottom: 1px solid #eee;
    font-size: 18px;
    font-weight: 600;
    color: #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
`;
            loadingHeader.textContent = fileName;

            const loadingCloseBtn = document.createElement('button');
            loadingCloseBtn.textContent = '×';
            loadingCloseBtn.style.cssText = `
    width: 36px;
    height: 36px;
    border: none;
    background: transparent;
    border-radius: 50%;
    font-size: 20px;
    color: #666;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
`;

            loadingCloseBtn.addEventListener('click', () => {
                loadingContainer.remove();
                document.body.appendChild(modalContainer);
            });

            loadingHeader.appendChild(loadingCloseBtn);

            const loadingContent = document.createElement('div');
            loadingContent.style.cssText = `
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
`;

            const spinner = document.createElement('div');
            spinner.style.cssText = `
    width: 40px;
    height: 40px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #007aff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 20px;
`;

            const loadingText = document.createElement('div');
            loadingText.textContent = '正在加载...';
            loadingText.style.cssText = `
    font-size: 16px;
    color: #666;
`;

            loadingContent.append(spinner, loadingText);
            loadingContainer.append(loadingHeader, loadingContent);

            return loadingContainer;
        };

        // 文件获取函数
        const fetchFileContent = (serverIp, filePath, fileName, isBinary) => {
            return new Promise((resolve) => {
                const ws = new WebSocket(`ws://${serverIp}`);

                ws.onopen = () => {
                    console.log('WebSocket连接已打开，请求文件:', filePath);
                    ws.send(JSON.stringify({
                        type: 'get_file',
                        path: filePath
                    }));
                };

                ws.onmessage = async (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'file_content' && data.path === filePath) {
                            const success = await EbookStorage.save(
                                fileName,
                                data.content,
                                isBinary ? 'binary' : 'text'
                            );
                            ws.close();
                            resolve(success ? (isBinary ? true : data.content) : null);
                        }
                    } catch (e) {
                        console.error('解析文件内容失败:', e);
                        resolve(null);
                    }
                };

                ws.onerror = (error) => {
                    console.error('WebSocket错误:', error);
                    resolve(null);
                };

                ws.onclose = () => {
                    console.log('WebSocket连接已关闭');
                };
            });
        };

        // 获取电子书列表（优化：增强加载提示）
        const fetchBookList = async () => {
            const serverIp = await promptServerIp();
            if (!serverIp) {
                return false;
            }

            // 显示列表加载提示
            const loadingContainer = createLoadingContainer('电子书列表');
            document.body.appendChild(loadingContainer);
            modalContainer.remove();

            try {
                return new Promise((resolve) => {
                    const ws = new WebSocket(`ws://${serverIp}`);

                    ws.onopen = () => {
                        ws.send(JSON.stringify({ type: 'get_book_list' }));
                    };

                    ws.onmessage = async (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.type === 'book_list') {
                                const books = data.books;
                                saveToLocalStorage(books);

                                // 移除加载提示，显示列表
                                loadingContainer.remove();
                                document.body.appendChild(modalContainer);

                                if (books.length === 0) {
                                    renderBooks(books);
                                    ws.close();
                                    return resolve(true);
                                }

                                const total = books.length;
                                let completed = 0;

                                // 更新内容容器为进度显示
                                contentContainer.innerHTML = '';
                                const progressContainer = document.createElement('div');
                                progressContainer.style.cssText = `
        padding: 40px 20px;
        text-align: center;
        color: #666;
        font-size: 16px;
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    `;

                                const progressText = document.createElement('div');
                                progressText.textContent = '正在准备文件...';
                                progressText.style.marginBottom = '16px';

                                const progressBarContainer = document.createElement('div');
                                progressBarContainer.style.cssText = `
        width: 80%;
        height: 8px;
        background: #eee;
        border-radius: 4px;
        overflow: hidden;
    `;

                                const progressBar = document.createElement('div');
                                progressBar.style.cssText = `
        height: 100%;
        background: #007aff;
        width: 0%;
        transition: width 0.3s ease;
    `;

                                progressBarContainer.appendChild(progressBar);
                                progressContainer.append(progressText, progressBarContainer);
                                contentContainer.appendChild(progressContainer);

                                for (const book of books) {
                                    try {
                                        completed++;
                                        const progress = Math.round((completed / total) * 100);
                                        const fileName = book.url.split('/').pop();
                                        progressText.textContent = `正在准备文件 ${completed}/${total} (${book.name})`;
                                        progressBar.style.width = `${progress}%`;

                                        if (!(await EbookStorage.exists(fileName))) {
                                            await fetchFileContent(serverIp, book.url, fileName,
                                                book.url.toLowerCase().endsWith('.pdf'));
                                        }
                                    } catch (e) {
                                        console.error(`准备文件 ${book.name} 失败:`, e);
                                    }
                                }

                                progressText.textContent = '准备完成，正在加载列表...';
                                progressBar.style.width = '100%';

                                await new Promise(resolve => setTimeout(resolve, 500));
                                renderBooks(books);
                                ws.close();
                                resolve(true);
                            }
                        } catch (error) {
                            console.error('解析书籍列表失败:', error);
                            loadingContainer.remove();
                            document.body.appendChild(modalContainer);
                            resolve(false);
                        }
                    };

                    ws.onerror = (error) => {
                        console.error('WebSocket错误:', error);
                        loadingContainer.remove();
                        document.body.appendChild(modalContainer);
                        alert("无法连接到服务器");
                        resolve(false);
                    };

                    ws.onclose = () => {
                        console.log('WebSocket连接已关闭');
                    };
                });
            } catch (error) {
                console.error('获取书籍列表错误:', error);
                loadingContainer.remove();
                document.body.appendChild(modalContainer);
                alert("获取列表失败");

                const storedBooks = loadFromLocalStorage();
                if (storedBooks) {
                    renderBooks(storedBooks);
                } else {
                    contentContainer.innerHTML = '';
                    const errorMsg = document.createElement('div');
                    errorMsg.style.cssText = `
            padding: 40px 20px;
            text-align: center;
            color: #ff3b30;
            font-size: 16px;
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
                    errorMsg.textContent = '同步失败，且无本地缓存数据';
                    contentContainer.appendChild(errorMsg);
                }
                return false;
            }
        };

        // 打开TXT内容
        const openTxtContent = (content, fileName, storageKey) => {
            const txtContainer = document.createElement('div');
            txtContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: white;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    -webkit-tap-highlight-color: transparent;
`;

            const txtHeader = document.createElement('div');
            txtHeader.style.cssText = `
    padding: 16px 20px;
    background: #f5f5f5;
    border-bottom: 1px solid #eee;
    font-size: 18px;
    font-weight: 600;
    color: #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
`;
            txtHeader.textContent = fileName;

            const txtCloseBtn = document.createElement('button');
            txtCloseBtn.textContent = '×';
            txtCloseBtn.style.cssText = `
    width: 36px;
    height: 36px;
    border: none;
    background: transparent;
    border-radius: 50%;
    font-size: 20px;
    color: #666;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
`;

            // 保存进度并关闭
            txtCloseBtn.addEventListener('click', () => {
                const scrollTop = contentWrapper.scrollTop;
                saveReadingProgress(storageKey, scrollTop);
                txtContainer.remove();
                document.body.appendChild(modalContainer);
            });

            // 监听窗口关闭事件，确保进度被保存
            window.addEventListener('beforeunload', () => {
                const scrollTop = contentWrapper.scrollTop;
                saveReadingProgress(storageKey, scrollTop);
            });

            txtHeader.appendChild(txtCloseBtn);

            const contentWrapper = document.createElement('div');
            contentWrapper.style.cssText = `
    flex: 1;
    overflow: auto;
    padding: 20px;
`;

            // 监听滚动事件，定期保存进度
            let progressSaveTimer;
            contentWrapper.addEventListener('scroll', () => {
                clearTimeout(progressSaveTimer);
                progressSaveTimer = setTimeout(() => {
                    saveReadingProgress(storageKey, contentWrapper.scrollTop);
                }, 500);
            });

            const contentElement = document.createElement('div');
            contentElement.style.cssText = `
    font-size: 16px;
    line-height: 1.8;
    color: #333;
    white-space: pre-wrap;
    word-wrap: break-word;
`;
            contentElement.textContent = content;

            contentWrapper.appendChild(contentElement);
            txtContainer.append(txtHeader, contentWrapper);
            document.body.appendChild(txtContainer);

            // 恢复上次阅读进度
            const savedProgress = getReadingProgress(storageKey);
            if (savedProgress > 0) {
                setTimeout(() => {
                    contentWrapper.scrollTop = savedProgress;
                }, 100);
            }
        };

        // 按钮事件绑定
        syncBtn.addEventListener('click', fetchBookList);

        // 加载本地列表
        const storedBooks = loadFromLocalStorage();
        if (storedBooks) {
            renderBooks(storedBooks);
        }
    }






    // 全屏iframe打开电子书
    function openBookInIframe(relativeUrl) {
        // 创建全屏容器
        const fullscreenContainer = document.createElement('div');
        fullscreenContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: #000;
        z-index: 9999;
        display: flex;
        flex-direction: column;
    `;

        // 创建标题栏（含关闭按钮）
        const titleBar = document.createElement('div');
        titleBar.style.cssText = `
        height: 50px;
        background: #f5f5f5;
        border-bottom: 1px solid #eee;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 0 16px;
    `;

        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = `
        width: 36px;
        height: 36px;
        border: none;
        background: transparent;
        border-radius: 50%;
        font-size: 20px;
        color: #666;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
        closeBtn.innerHTML = '×';

        // 按钮交互效果
        closeBtn.addEventListener('touchstart', () => closeBtn.style.background = '#e0e0e0');
        closeBtn.addEventListener('touchend', () => closeBtn.style.background = 'transparent');
        closeBtn.addEventListener('mouseover', () => closeBtn.style.background = '#e0e0e0');
        closeBtn.addEventListener('mouseout', () => closeBtn.style.background = 'transparent');

        // 关闭功能
        closeBtn.addEventListener('click', () => {
            fullscreenContainer.style.opacity = '0';
            setTimeout(() => fullscreenContainer.remove(), 300);
        });

        titleBar.appendChild(closeBtn);

        // 创建iframe
        const iframe = document.createElement('iframe');
        const fullUrl = `http://sxz.school.zykj.org${relativeUrl}`;
        iframe.src = `http://sxz.school.zykj.org/i_res/pdfview/web/viewer.html#${fullUrl}`;
        iframe.style.cssText = `
        flex: 1;
        width: 100%;
        height: calc(100% - 50px);
        border: none;
    `;

        // 组装并添加到页面
        fullscreenContainer.append(titleBar, iframe);
        document.body.appendChild(fullscreenContainer);

        // 添加入场动画
        fullscreenContainer.style.opacity = '0';
        setTimeout(() => {
            fullscreenContainer.style.transition = 'opacity 0.3s ease';
            fullscreenContainer.style.opacity = '1';
        }, 10);
    }


    // 自定义prompt函数（取消时返回空字符串）
    function customPrompt(message, defaultValue = '') {
        return new Promise((resolve) => { // 只保留resolve，不使用reject
            // 创建模态框容器
            const modalContainer = document.createElement('div');
            modalContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            -webkit-tap-highlight-color: transparent;
        `;

            // 创建模态框主体
            const modal = document.createElement('div');
            modal.style.cssText = `
            background: white;
            border-radius: 12px;
            width: 92%;
            max-width: 500px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
            overflow: hidden;
        `;

            // 创建消息区域
            const messageEl = document.createElement('div');
            messageEl.textContent = message;
            messageEl.style.cssText = `
            padding: 24px 20px 16px;
            font-size: 16px;
            color: #333;
            line-height: 1.5;
        `;

            // 创建输入框
            const input = document.createElement('input');
            input.type = 'text';
            input.value = defaultValue;
            input.style.cssText = `
            width: calc(100% - 40px);
            margin: 0 20px 24px;
            padding: 12px 14px;
            font-size: 16px;
            border: 1px solid #ddd;
            border-radius: 6px;
            box-sizing: border-box;
        `;

            // 创建按钮容器
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = `
            display: flex;
            border-top: 1px solid #eee;
        `;

            // 创建取消按钮
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.style.cssText = `
            flex: 1;
            padding: 16px;
            font-size: 16px;
            color: #333;
            background: transparent;
            border: none;
            cursor: pointer;
            border-right: 1px solid #eee;
        `;

            // 创建确认按钮
            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = '确定';
            confirmBtn.style.cssText = `
            flex: 1;
            padding: 16px;
            font-size: 16px;
            color: #007aff;
            background: transparent;
            border: none;
            cursor: pointer;
            font-weight: 600;
        `;

            // 按钮交互效果
            [cancelBtn, confirmBtn].forEach(btn => {
                btn.addEventListener('touchstart', () => btn.style.background = '#f0f0f0');
                btn.addEventListener('touchend', () => btn.style.background = 'transparent');
                btn.addEventListener('mouseover', () => btn.style.background = '#f5f5f5');
                btn.addEventListener('mouseout', () => btn.style.background = 'transparent');
            });

            // 关闭模态框并返回结果
            const closeModal = (result) => {
                document.body.removeChild(modalContainer);
                resolve(result);
            };

            // 绑定按钮事件
            cancelBtn.addEventListener('click', () => {
                closeModal(""); // 取消时返回空字符串
            });

            confirmBtn.addEventListener('click', () => {
                closeModal(input.value); // 确认时返回输入值
            });

            // 支持Enter键确认
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    closeModal(input.value);
                }
            });

            // 点击外部关闭视为取消
            modalContainer.addEventListener('click', (e) => {
                if (e.target === modalContainer) {
                    closeModal(""); // 点击外部也返回空字符串
                }
            });

            // 支持ESC键取消
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    closeModal("");
                    document.removeEventListener('keydown', handleEsc);
                }
            };
            document.addEventListener('keydown', handleEsc);

            // 组装模态框
            buttonContainer.append(cancelBtn, confirmBtn);
            modal.append(messageEl, input, buttonContainer);
            modalContainer.appendChild(modal);
            document.body.appendChild(modalContainer);

            // 自动聚焦输入框
            input.focus();
        });
    }


    function showSelect(options) {
        // 返回Promise，用于异步返回选中结果
        return new Promise((resolve, reject) => {
            // 创建模态框容器
            const modalContainer = document.createElement('div');
            modalContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            -webkit-tap-highlight-color: transparent;
        `;

            // 创建模态框主体
            const modal = document.createElement('div');
            modal.style.cssText = `
            background: white;
            border-radius: 12px;
            width: 92%;
            max-width: 500px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
            max-height: 85vh;
            display: flex;
            flex-direction: column;
        `;

            // 创建标题
            const title = document.createElement('div');
            title.textContent = '菜单 (c163de89b0b8f003)';//彩蛋^_^
            title.style.cssText = `
            padding: 18px 20px;
            font-size: 18px;
            font-weight: 600;
            border-bottom: 1px solid #eee;
            color: #333;
        `;

            // 创建选项列表容器（带粗滚动条）
            const listContainer = document.createElement('div');
            listContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 8px 0;
            scrollbar-gutter: stable;
        `;

            // 粗滚动条样式
            const style = document.createElement('style');
            style.textContent = `
            #customSelectListContainer::-webkit-scrollbar {
                width: 14px;
            }
            #customSelectListContainer::-webkit-scrollbar-track {
                background: #f1f1f1;
                border-radius: 7px;
                margin: 10px 0;
            }
            #customSelectListContainer::-webkit-scrollbar-thumb {
                background: #a0a0a0;
                border-radius: 7px;
                border: 2px solid #f1f1f1;
                min-height: 40px;
            }
            #customSelectListContainer::-webkit-scrollbar-thumb:hover {
                background: #777;
            }
            #customSelectListContainer {
                scrollbar-width: 14px;
                scrollbar-color: #a0a0a0 #f1f1f1;
            }
        `;
            listContainer.id = 'customSelectListContainer';
            document.head.appendChild(style);

            // 创建选项列表
            const list = document.createElement('ul');
            list.style.cssText = `
            list-style: none;
            margin: 0;
            padding: 0;
        `;

            // 关闭模态框的通用函数
            const closeModal = (result = null, isCancel = false) => {
                document.body.removeChild(modalContainer);
                document.head.removeChild(style);
                document.removeEventListener('keydown', handleEsc);
                if (isCancel) {
                    reject(new Error('用户取消选择')); // 取消时reject
                } else {
                    resolve(result); // 选中时resolve返回结果
                }
            };

            // 添加选项
            options.forEach((option, index) => {
                const item = document.createElement('li');
                item.textContent = option;
                item.style.cssText = `
                padding: 18px 20px;
                border-bottom: 1px solid #f5f5f5;
                cursor: pointer;
                transition: background 0.2s;
                font-size: 16px;
                color: #555;
            `;

                // 点击选项 - 返回选中的选项和索引
                item.addEventListener('click', () => {
                    closeModal({
                        value: option,
                        index: index
                    });
                });

                // 触摸和鼠标反馈
                item.addEventListener('touchstart', () => item.style.background = '#f0f0f0');
                item.addEventListener('touchend', () => item.style.background = 'transparent');
                item.addEventListener('mouseover', () => item.style.background = '#f5f5f5');
                item.addEventListener('mouseout', () => item.style.background = 'transparent');

                list.appendChild(item);
            });

            // 点击模态框外部关闭（视为取消）
            modalContainer.addEventListener('click', (e) => {
                if (e.target === modalContainer) {
                    closeModal(null, true);
                }
            });

            // ESC键关闭（视为取消）
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    closeModal(null, true);
                }
            };
            document.addEventListener('keydown', handleEsc);

            // 组装模态框
            listContainer.appendChild(list);
            modal.append(title, listContainer);
            modalContainer.appendChild(modal);
            document.body.appendChild(modalContainer);
        });
    }
    function showInIframe(url) {
        // 尝试获取已存在的容器
        let container = document.getElementById('full-iframe-container');

        if (container) {
            // 复用现有容器并更新URL
            const iframe = container.querySelector('iframe');
            if (iframe) iframe.src = url;
            container.style.display = 'block';
            return;
        }

        // 创建容器元素
        container = document.createElement('div');
        container.id = 'full-iframe-container';
        Object.assign(container.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            zIndex: '9999',
            backgroundColor: '#fff'
        });

        // 创建iframe
        const iframe = document.createElement('iframe');
        iframe.src = url;
        Object.assign(iframe.style, {
            width: '100%',
            height: '100%',
            border: 'none'
        });

        // 创建关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        Object.assign(closeBtn.style, {
            position: 'absolute',
            top: '10px',
            right: '10px',
            zIndex: '10000',
            padding: '8px 12px',
            fontSize: '16px',
            cursor: 'pointer',
            backgroundColor: '#ff4444',
            color: 'white',
            border: 'none',
            borderRadius: '4px'
        });
        closeBtn.onclick = () => {
            container.style.display = 'none';
            iframe.src = 'about:blank';
        };

        // 组装并添加到页面
        container.append(iframe, closeBtn);
        document.body.appendChild(container);
    }

    async function settings() {
        const jsFileUrl = await customPrompt('请输入JS文件URL');
        if (!jsFileUrl) {
            return;
        }
        fetch(jsFileUrl)
            .then(response => {
                // 检查请求是否成功
                if (!response.ok) {
                    throw new Error(`请求失败，状态码: ${response.status}`);
                }
                // 读取响应内容为文本
                return response.text();
            })
            .then(async jsContent => {
                // 将JS内容存储到localStorage
                await alert('警告：刷入自定义JS后默认脚本将被覆盖！\n如需返回，请重启程序。')
                localStorage.setItem('injuredJs', jsContent);
                await alert('成功获取并存储JS文件！\n请重启程序以应用更改。');
            })
            .catch(async error => {
                // 处理错误情况
                await alert(`获取JS文件失败: ${error.message}`);
            });
    }
    async function blowser() {
        const browserUrl = await customPrompt('请输入浏览器URL(要包含http://或https://)');
        if (browserUrl) {
            showInIframe(browserUrl);
        } else {
            await alert('未输入浏览器URL');
        }
    }
    async function reader() {
        showBookList();
    }

    async function showPrompt() {
        const promptText = await showSelect(["刷入自定义JS", "打开网页", "小说阅读器", "手动加载资源"]);
        switch (promptText.value) {
            case '打开网页':
                blowser();
                break;
            case '刷入自定义JS':
                settings();
                break;
            case '小说阅读器':
                reader();
                break;
            case '手动加载资源':
                fetchAllFiles();
                break;
            default:
                await alert('无效的输入');
        }
    }
    // 寻找包含"我的订阅"文本的目标li元素
    function findTargetLi() {
        // 先通过类名和属性筛选可能的元素
        const candidates = document.querySelectorAll('li.ant-menu-item.ant-menu-item-selected[role="menuitem"]');

        // 遍历候选元素，检查内部是否包含"我的订阅"文本
        for (const item of candidates) {
            const span = item.querySelector('span');
            if (span && span.textContent.trim() === '我的订阅') {
                return item;
            }
        }
        return null;
    }

    // 存储点击时间的数组
    let clickTimes = [];

    // 点击事件处理函数
    function handleClick() {
        const now = Date.now();

        // 添加当前时间并过滤2秒前的记录
        clickTimes.push(now);
        clickTimes = clickTimes.filter(time => now - time <= 2000);

        // 检查是否达到7次点击
        if (clickTimes.length >= 7) {
            showPrompt();
            clickTimes = []; // 重置计数
        }
    }

    // 尝试绑定事件，未找到则每0.5秒重试
    function tryBindEvent() {
        const targetLi = findTargetLi();
        if (targetLi) {
            targetLi.addEventListener('click', handleClick);
            console.log('已成功找到目标元素并绑定事件');
        } else {
            console.log('未找到目标元素，0.5秒后重试...');
            setTimeout(tryBindEvent, 500); // 0.5秒后再次尝试
        }
    }

    // 启动首次检测
    tryBindEvent();
}
