var ChunkStore = function (vfsPath) {
    this.store = {};
    this.vfsPath = vfsPath || null;

    // 尝试从 VFS 初始化
    (async () => {
        if (this.vfsPath && window.globalVfs) {
            try {
                const blob = await window.globalVfs.getFile(this.vfsPath);
                if (blob) {
                    const text = await blob.text();
                    this.store = JSON.parse(text);
                    console.log("ChunkStore 从 VFS 恢复成功");
                }
            } catch (e) {
                console.warn("ChunkStore 恢复失败:", e);
            }
        }
    })();
};

ChunkStore.prototype._save = async function () {
    if (this.vfsPath && window.globalVfs) {
        try {
            const blob = new Blob([JSON.stringify(this.store, null, 2)], { type: 'application/json' });
            await window.globalVfs.setFile(this.vfsPath, blob);
        } catch (e) {
            console.error("ChunkStore 保存到 VFS 失败:", e);
        }
    }
};

ChunkStore.prototype.inbox = async function (segment) {
    var match = segment.match(/^([a-zA-Z0-9]{6})>([0-9a-fA-F\-]+)@(\d+)~(\d+):(.*)$/);
    if (!match) return false;

    var type = match[1],
        groupID = match[2],
        index = parseInt(match[3]),
        maxIndex = parseInt(match[4]),
        content = match[5];

    if (!this.store[type]) this.store[type] = {};
    if (!this.store[type][groupID]) this.store[type][groupID] = { maxIndex: maxIndex, chunks: {}, resolveQueue: [] };

    var group = this.store[type][groupID];
    group.chunks[index] = content;

    // 收齐触发等待队列
    if (Object.keys(group.chunks).length === maxIndex + 1) {
        while (group.resolveQueue.length > 0) {
            var r = group.resolveQueue.shift();
            var combined = [];
            for (var i = 0; i <= maxIndex; i++) combined.push(group.chunks[i]);
            var text = decodeURIComponent(escape(atob(combined.join(''))));
            r([text]);
        }
    }

    await this._save(); // 保存到 VFS
    return true;
};

ChunkStore.prototype.search = async function (type, wait) {
    var self = this;
    wait = wait || false;

    if (!wait) {
        if (!self.store[type]) return null;
        var result = [];
        for (var groupID in self.store[type]) {
            var group = self.store[type][groupID];
            if (Object.keys(group.chunks).length === group.maxIndex + 1) {
                var combined = [];
                for (var i = 0; i <= group.maxIndex; i++) combined.push(group.chunks[i]);
                var text = decodeURIComponent(escape(atob(combined.join(''))));
                result.push(text);
                delete self.store[type][groupID];
            }
        }
        await this._save(); // 保存修改
        return result.length > 0 ? result : null;
    } else {
        return new Promise(function (resolve) {
            if (!self.store[type]) self.store[type] = {};
            for (var groupID in self.store[type]) {
                var group = self.store[type][groupID];
                if (Object.keys(group.chunks).length === group.maxIndex + 1) {
                    var combined = [];
                    for (var i = 0; i <= group.maxIndex; i++) combined.push(group.chunks[i]);
                    var text = decodeURIComponent(escape(atob(combined.join(''))));
                    delete self.store[type][groupID];
                    resolve([text]);
                    (async () => { await self._save(); })();
                    break;
                } else {
                    group.resolveQueue.push(resolve);
                }
            }
        });
    }
};

ChunkStore.prototype.status = function () {
    var result = {};
    for (var type in this.store) {
        result[type] = {};
        for (var groupID in this.store[type]) {
            var group = this.store[type][groupID];
            var missing = [];
            for (var i = 0; i <= group.maxIndex; i++) {
                if (group.chunks[i] === undefined) missing.push(i);
            }
            result[type][groupID] = missing;
        }
    }
    return result;
};

ChunkStore.prototype.loadMsg = async function (type, msg) {
    if (!this.store[type]) this.store[type] = {};

    // 生成一个唯一的 groupID
    var groupID = 'load-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

    // 与 chunk / inbox 保持一致的 base64 编码
    var base64Text = btoa(unescape(encodeURIComponent(msg)));

    // 构造一个“已完成”的 chunk 组
    this.store[type][groupID] = {
        maxIndex: 0,
        chunks: {
            0: base64Text
        },
        resolveQueue: []
    };

    await this._save();
    return true;
};


// ================== chunk 函数 ==================
function chunk(text, type, chunkSize, prefixOverhead) {
    chunkSize = chunkSize || 510;
    prefixOverhead = prefixOverhead || (6 + 1 + 36 + 1 + 10); // type>UUID@i~max:

    if (!/^[a-zA-Z0-9]{6}$/.test(type)) throw new Error("type 必须6位字母数字");

    var base64Text = btoa(unescape(encodeURIComponent(text)));
    var contentSize = chunkSize - prefixOverhead;
    var totalChunks = Math.ceil(base64Text.length / contentSize);

    var groupID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });

    var segments = [];
    for (var i = 0; i < totalChunks; i++) {
        var chunkContent = base64Text.slice(i * contentSize, (i + 1) * contentSize);
        var prefix = type + '>' + groupID + '@' + i + '~' + (totalChunks - 1) + ':';
        segments.push(prefix + chunkContent);
    }
    return segments;
}
// chunk 函数保持不变
window.chunk = chunk;

// 创建 VFS 存储的 ChunkStore 示例
window.chunkStore = new ChunkStore("/systemdata/chunkstore.json");
