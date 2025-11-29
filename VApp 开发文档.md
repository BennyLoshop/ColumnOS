# VApp 开发文档

VApp 是 ColumnOS 中用于在隔离的 iframe 环境中运行应用的核心类。应用通过 `window.vapp` API 与系统交互,实现文件操作、应用间通信和云同步等功能。

## 一、VApp 类构造

### 构造函数

```js
new VApp(vfs, rootURL, vfsRoot = "/", options = {})
```

**参数说明:**

+   `vfs`: VFS 实例,用于文件系统操作
+   `rootURL`: 应用的根 URL (如 `"http://appdata/"`)
+   `vfsRoot`: VFS 中的根路径 (系统应用为 `/system/app/{appId}/`,用户应用为 `/app/{appId}/`)
+   `options`: 启动参数对象,可包含任意自定义字段

### 创建应用实例

系统通过 `createVApp()` 函数创建应用:

```js
// 系统应用路径: /system/app/{appId}/  
// 用户应用路径: /app/{appId}/  
const vapp = new VApp(  
    window.globalVfs,   
    "http://appdata/",   
    "/system/app/com.columnos.files/",  
    { file: "/documents/example.pdf" }  
);  
vapp.bind("column-os-iframe-com.columnos.files");  
vapp.load("index.html");
```

* * *

## 二、window.vapp API 详解

应用在 iframe 中通过 `window.vapp` 访问系统功能 。

### 2.1 vapp.params - 启动参数

包含启动应用时传入的所有参数。

**Demo: PDF 阅读器接收文件路径**

```js
// 父窗口启动应用  
window.parent.createVApp("com.columnos.reader.pdf", {   
    file: "/documents/report.pdf",  
    page: 5,  
    zoom: 1.5  
});  
  
// 应用内部读取参数  
const filePath = vapp.params.file;    // "/documents/report.pdf"  
const startPage = vapp.params.page;   // 5  
const zoomLevel = vapp.params.zoom;   // 1.5
```

* * *

### 2.2 vapp.globalVfs - 虚拟文件系统

全局 VFS 实例引用,提供完整的文件系统操作 。

**主要方法:**

| 方法 | 说明 | 返回值 |
| --- | --- | --- |
| `getFile(path)` | 读取文件 | `Promise<Blob | null>` |
| `setFile(path, blob)` | 写入文件 | `Promise<void>` |
| `deleteFile(path)` | 删除文件 | `Promise<void>` |
| `dir(path)` | 列出目录 | `Promise<Array>` |
| `createDir(path)` | 创建目录 | `Promise<void>` |
| `deleteDir(path)` | 删除目录 | `Promise<void>` |
| `renameFile(oldPath, newName)` | 重命名文件 | `Promise<void>` |
| `renameDir(path, newName)` | 重命名目录 | `Promise<void>` |

**Demo: 文件管理器应用**

```js
// 等待 vapp 初始化  
while (!window.vapp || !window.vapp.globalVfs) {  
    await new Promise(resolve => setTimeout(resolve, 100));  
}  
  
const vfs = window.vapp.globalVfs;  
  
// 列出目录内容  
const items = await vfs.dir("/documents");  
items.forEach(item => {  
    console.log(item.name, item.isDir ? "(文件夹)" : "(文件)");  
});  
  
// 读取文本文件  
const blob = await vfs.getFile("/documents/note.txt");  
const text = await blob.text();  
console.log("文件内容:", text);  
  
// 写入新文件  
const newContent = new Blob(["Hello ColumnOS"], { type: "text/plain" });  
await vfs.setFile("/documents/greeting.txt", newContent);  
  
// 创建目录  
await vfs.createDir("/documents/backup");  
  
// 重命名文件  
await vfs.renameFile("/documents/old.txt", "new.txt");  
  
// 删除文件  
await vfs.deleteFile("/documents/temp.txt");
```

* * *

### 2.3 vapp.globalUtils - 高级工具

提供文件下载、解压等高级功能 。

**主要方法:**

| 方法 | 说明 |
| --- | --- |
| `downloadFile(url, path)` | 下载远程文件到 VFS |
| `unzipFile(zipPath, targetDir)` | 解压 ZIP 文件 |
| `_runJs(jsPath)` | 执行 VFS 中的 JS 文件 |

**Demo: 下载和解压资源包**

```js
const utils = window.vapp.globalUtils;  
  
// 下载远程文件  
await utils.downloadFile(  
    "https://example.com/assets.zip",   
    "/downloads/assets.zip"  
);  
  
// 解压到指定目录  
await utils.unzipFile(  
    "/downloads/assets.zip",   
    "/app/myapp/resources/"  
);  
  
// 执行 VFS 中的脚本  
await utils._runJs("/app/myapp/init.js");
```

* * *

### 2.4 vapp.chunkStore - 分块存储

用于处理大数据分块传输的存储系统,适用于云同步场景 。

**主要方法:**

+   `search(identifier)` - 搜索特定标识符的数据块
+   `inbox(segment)` - 接收数据分段
+   `wait(type, groupID, timeout)` - 等待数据收集完成

**Demo: 云端文件导入**

```js
const chunkStore = window.vapp.chunkStore;  
  
// 搜索云端文件数据 (标识符: FILE00)  
const items = await chunkStore.search("FILE00");  
  
// 处理每个文件  
for (const itemStr of items) {  
    const item = JSON.parse(itemStr);  
    const fileName = item.fileName;  
    const base64Data = item.base64;  
      
    // Base64 解码  
    const binaryString = atob(base64Data);  
    const bytes = new Uint8Array(binaryString.length);  
    for (let i = 0; i < binaryString.length; i++) {  
        bytes[i] = binaryString.charCodeAt(i);  
    }  
      
    // 保存到 VFS  
    const blob = new Blob([bytes], { type: "application/octet-stream" });  
    await vapp.globalVfs.setFile("/downloads/" + fileName, blob);  
      
    console.log("已导入:", fileName);  
}
```

* * *

### 2.5 vapp.pushToInbox - 云端推送

将数据推送到云端收件箱,配合 chunkStore 实现云同步 。

**函数签名:**

```js
pushToInbox(text, id6, token, apiHost)
```

**参数:**

+   `text` - 要推送的文本内容
+   `id6` - 6位标识符 (如 "FILE00")
+   `token` - 认证令牌
+   `apiHost` - API 服务器地址

**Demo: 上传文件到云端**

```js
// 读取文件并转换为 Base64  
const blob = await vapp.globalVfs.getFile("/documents/report.pdf");  
const arrayBuffer = await blob.arrayBuffer();  
const bytes = new Uint8Array(arrayBuffer);  
const base64 = btoa(String.fromCharCode(...bytes));  
  
// 构造数据对象  
const data = JSON.stringify({  
    fileName: "report.pdf",  
    base64: base64,  
    timestamp: Date.now()  
});  
  
// 推送到云端  
const success = await vapp.pushToInbox(  
    data,  
    "FILE00",  
    vapp.tokenStore.getToken(),  
    "https://api.example.com"  
);  
  
if (success) {  
    alert("上传成功");  
}
```

* * *

### 2.6 vapp.getAppFile() - 应用文件访问

获取应用目录下的文件,路径相对于应用的 `vfsRoot`。

**Demo: 加载应用资源**

```js
// 加载应用图标  
const iconBlob = await vapp.getAppFile("/img/icon.png");  
const iconUrl = URL.createObjectURL(iconBlob);  
document.getElementById("app-icon").src = iconUrl;  
  
// 加载配置文件  
const configBlob = await vapp.getAppFile("/config.json");  
const configText = await configBlob.text();  
const config = JSON.parse(configText);
```

* * *

### 2.7 vapp.location - 虚拟位置对象

> 当前暂未实现此API

代理的 location 对象,提供虚拟的 URL 信息 。

**可用属性:**

+   `vapp.location.href` - 完整 URL
+   `vapp.location.search` - 查询字符串
+   `vapp.location.hash` - URL hash
+   `vapp.location.pathname` - 路径名

**Demo: 读取 URL 参数**

```js
// 假设启动时传入: { href: "http://app/?id=123#section2" }  
console.log(vapp.location.href);     // "http://app/?id=123#section2"  
console.log(vapp.location.search);   // "?id=123"  
console.log(vapp.location.hash);     // "#section2"  
console.log(vapp.location.pathname); // "/"
```

* * *

### 2.8 vapp.exit() - 退出应用

关闭当前应用并返回主屏幕 VAppHost.js:335-352 。

**Demo: 退出按钮**

```js
document.getElementById("close-btn").onclick = () => {  
    vapp.exit();  
};
```

* * *

## 三、系统覆盖功能

### 3.1 alert() 覆盖

系统覆盖原生 `alert()`,显示为 toast 提示,1秒后自动消失  。

**Demo:**

```js
alert("操作成功");  // 显示 toast,无需点击确认  
alert("文件已保存");
```

* * *

### 3.2 文件输入劫持

所有 `<input type="file">` 被劫持,打开 VFS 文件选择器而非系统文件选择器 。

**Demo: 文件上传**

```html
<input type="file" id="file-input" />  
<script>  
document.getElementById("file-input").onchange = async (e) => {  
    const file = e.target.files[0];  
    console.log("选择的文件:", file.name);  
      
    // 读取文件内容  
    const text = await file.text();  
    console.log("文件内容:", text);  
};  
</script>
```

