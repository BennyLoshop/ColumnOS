# ColumnOS

运行在在线专栏里的WebOS，可拓展，部署简便，纯本地。

## ColumnOS.js

本项目搭载了`ColumnOS.js`，提供了虚拟文件系统（基于IndexedDb）和轻量App框架。

使用文档如下：

明白

### 概述

**ColumnOS.js** 是一个前端文件系统与应用框架库，实现了：

* **虚拟文件系统 (VFS)**：模拟文件和目录操作
* **虚拟应用 (VApp)**：在 iframe 中加载 HTML/JS/CSS 文件
* **可视化文件管理器**：动态生成 HTML 文件树与文件列表
* **支持 HTTP 下纯前端运行**

特点：

* 完全前端实现，无需 Service Worker
* 可加载 HTML/JS/CSS/JSON/TXT 文件
* 支持动态 DOM 创建
* 文件和目录操作完整

### 核心类

#### 1. `VFS`

**用途**：模拟文件系统，管理文件和目录

**构造函数**：

```js
myVfs = new VFS("NAME");
```

**方法**：


| 方法                            | 参数             | 返回值           | 描述                                       |
| ------------------------------- | ---------------- | ---------------- | ------------------------------------------ |
| `uploadFileFromPrompt()`        | 无               | `Promise`        | 弹窗上传文件到当前目录                     |
| `dir(path)`                     | `string`         | `Promise<Array>` | 返回指定路径的文件列表，包含`{name,isDir}` |
| `getFile(path)`                 | `string`         | `Promise<Blob>`  | 获取文件的 Blob                            |
| `setFile(path, blob)`           | `string, Blob`   | `Promise`        | 保存文件到指定路径                         |
| `renameFile(oldPath, newName)`  | `string, string` | `Promise`        | 重命名文件                                 |
| `deleteFile(path)`              | `string`         | `Promise`        | 删除文件                                   |
| `createDir(path)`               | `string`         | `Promise`        | 创建目录                                   |
| `renameDir(oldPath, newName)`   | `string, string` | `Promise`        | 重命名目录                                 |
| `deleteDir(path)`               | `string`         | `Promise`        | 删除目录                                   |
| `downloadFile(url, path)`       | `string, string` | `Promise`        | 下载远程文件到 VFS                         |
| `unzipFile(zipPath, targetDir)` | `string, string` | `Promise`        | 解压 ZIP 文件                              |
| `_runJs(jsPath)`                | `string`         | `Promise`        | 执行 VFS 中的 JS 文件                      |

#### 2. `VApp`

**用途**：在 iframe 中加载文件，支持相对 URL

**构造函数**：

```js
myVApp = new VApp(myVfs, "http://appdata/");
```

**方法**：


| 方法             | 参数     | 描述                                          |
| ---------------- | -------- | --------------------------------------------- |
| `bind(selector)` | `string` | 绑定 iframe 容器，如果不存在会创建全屏 iframe |
| `load(url)`      | `string` | 加载指定 URL 或 Blob 文件到 iframe            |
| `reload()`       | 无       | 重新加载当前文件                              |
| `destroy()`      | 无       | 卸载 iframe                                   |

### 使用示例

```js
// 创建 VFS
const myVfs = new VFS("MyVFS");

// 创建 VApp（可选）
const myVApp = new VApp(myVfs, "http://appdata/");
myVApp.bind("#appIframe");

// 加载首页
myVApp.load("http://appdata/index.html");

// 创建文件管理器
const model = createFileManagerModel(myVfs, { container: document.body });

// 上传文件
myVfs.uploadFileFromPrompt();

// 文件操作
myVfs.setFile("/docs/hello.txt", new Blob(["Hello World"], {type:"text/plain"}));
myVfs.renameFile("/docs/hello.txt","greet.txt");
myVfs.deleteFile("/docs/greet.txt");

// 下载远程文件
myVfs.downloadFile("https://example.com/file.txt","/ss/s.txt");

// 解压 ZIP
myVfs.unzipFile("/ss/s.zip","/ss/zip/");

// 执行 JS
myVfs._runJs("/s/s/ff.js");
```

### 注意事项

1. **HTTP 下可用**，无需 HTTPS
2. **iframe 支持相对 URL**，但所有资源路径需要通过 VFS 或 Blob URL
3. **动态 HTML**：文件管理器完全由 JS 创建，无需静态 DOM
4. **拖拽上传**：支持多文件同时上传
5. **右键菜单**：支持文件/目录操作（查看、删除、重命名）

### 推荐配合工具

* **JSZip**：用于 `unzipFile` 功能
* **Blob URL**：用于 `_runJs` 或 HTML 文件查看
