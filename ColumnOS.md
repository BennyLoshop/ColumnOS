# ColumnOS.js 文档

## 配置部分

```js
const debug = true; // debug 模式
const DEP_DIR = "/dependence/"; // 依赖存放路径
const DEPENDENCIES = [
    { name: "jszip.min.js", url: debug ? "http://127.0.0.1/i_res/jszip.min.js" : "/i_res/jszip.min.js" }
    // 可拓展更多依赖
];
```

* `debug`: 是否开启调试模式。
* `DEP_DIR`: 所有依赖保存到 VFS 的目录。
* `DEPENDENCIES`: 初始依赖列表，包含名称和 URL。

---

## 工具函数

### `loadScript(src)`

动态加载 JS 脚本。

```js
async function loadScript(src)
```

* **参数**
  * `src` - 脚本路径或 blob URL
* **返回**
  * Promise，加载完成后 resolve

---

### `joinPaths(base, name)`

路径拼接函数。

```js
function joinPaths(base, name)
```

* **参数**
  * `base` - 基础路径
  * `name` - 文件或文件夹名
* **返回**
  * 拼接后的路径字符串

---

## VFS 类

用于虚拟文件系统管理（基于 IndexedDB）。

```js
class VFS
```

### 构造函数

```js
new VFS(name)
```

* **参数**
  * `name` - 数据库名称

### 方法列表


| 方法                           | 描述                               |
| ------------------------------ | ---------------------------------- |
| `_initDB()`                    | 初始化 IndexedDB，创建`files`store |
| `_tx(mode)`                    | 获取事务对象                       |
| `_normalize(path)`             | 格式化路径                         |
| `_guessMime(path)`             | 根据扩展名猜测 MIME 类型           |
| `setFile(path, blob)`          | 保存文件到 VFS                     |
| `getFile(path)`                | 从 VFS 获取文件                    |
| `deleteFile(path)`             | 删除文件                           |
| `renameFile(oldPath, newName)` | 重命名文件                         |
| `createDir(path)`              | 创建文件夹                         |
| `deleteDir(path)`              | 删除文件夹及其子文件               |
| `renameDir(path, newName)`     | 重命名文件夹及其子文件             |
| `dir(path)`                    | 列出目录下文件和文件夹             |
| `uploadFileFromPrompt()`       | 打开文件选择窗口并上传到 VFS       |

### 依赖管理


| 方法                        | 描述                                          |
| --------------------------- | --------------------------------------------- |
| `createDirIfNotExist(path)` | 创建目录（如果不存在）                        |
| `loadDependency(name, url)` | 下载依赖并保存到 VFS；如果已存在，从 VFS 加载 |
| `initDependencies(list)`    | 初始化依赖，默认加载`DEPENDENCIES`            |

---

## VApp 类

用于在 `<iframe>` 中加载 VFS 文件，并处理所有相对 URL。

```js
class VApp
```

### 构造函数

```js
new VApp(vfs, rootURL)
```

* **参数**
  * `vfs` - VFS 实例
  * `rootURL` - 根路径，VFS 中的相对文件会基于此路径

### 方法列表


| 方法                        | 描述                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `blind(selector)`           | 绑定或创建 iframe，用于显示 VFS 文件                                |
| `_replaceAllUrls(rootNode)` | 替换 iframe 内部的相对 URL，支持`src`,`srcset`,`href`,`form action` |
| `_patchIframe()`            | 监控 DOM 变化和拦截 fetch / XHR 请求                                |
| `load(url)`                 | 在 iframe 中加载 VFS 文件                                           |

---

## VFSUtils 类

提供文件下载、解压和执行 JS 文件的工具方法。

```js
class VFSUtils
```

### 构造函数

```js
new VFSUtils(vfs)
```

* **参数**
  * `vfs` - VFS 实例

### 方法列表


| 方法                            | 描述                                       |
| ------------------------------- | ------------------------------------------ |
| `downloadFile(url, path)`       | 下载远程文件并保存到 VFS                   |
| `unzipFile(zipPath, targetDir)` | 解压 zip 文件到 VFS 指定目录（依赖 JSZip） |
| `_runJs(jsPath)`                | 执行 VFS 内的 JS 文件                      |

---

## 全局变量

* `window.VFS` - VFS 类
* `window.VApp` - VApp 类
* `window.VFSUtils` - VFSUtils 类
* `window.loadScript` - 动态加载脚本函数
* `window.DEP_DIR` - 依赖目录
* `window.DEPENDENCIES` - 依赖列表
* `window.debug` - debug 开关
* `window.globalVfs` - 全局 VFS 实例
* `window.globalUtils` - 全局 VFSUtils 实例

---

## 自动初始化

```js
(async function(){
    const vfs = new VFS("globalVfs");
    await vfs.initDependencies();
    console.log("All dependencies loaded into globalVfs.");
    window.globalVfs = vfs;
    window.globalUtils = new VFSUtils(vfs);
})();
```

* 自动创建全局 VFS
* 初始化依赖（首次缺失会下载）
* 之后从 VFS 本地加载依赖

---

## 使用示例

```js
// 下载依赖文件到 VFS
await globalVfs.loadDependency("jszip.min.js", "/i_res/jszip.min.js");

// 下载并保存远程文件
await globalUtils.downloadFile("https://example.com/file.txt", "/docs/file.txt");

// 解压 ZIP 文件
await globalUtils.unzipFile("/docs/archive.zip", "/docs/unzipped/");

// 执行 VFS 内的 JS
await globalUtils._runJs("/docs/script.js");

// 创建 VApp iframe 并加载文件
const app = new VApp(globalVfs, "/docs/");
app.blind("#appFrame");
await app.load("/docs/index.html");
```
