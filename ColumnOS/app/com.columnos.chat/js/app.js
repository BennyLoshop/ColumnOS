(async () => {
    // -------------------- 永远等待 vapp --------------------
    async function waitVappForever() {
        return new Promise(resolve => {
            if (window.vapp) return resolve(window.vapp);
            const timer = setInterval(() => {
                if (window.vapp) {
                    clearInterval(timer);
                    resolve(window.vapp);
                }
            }, 100);
        });
    }

    const vapp = await waitVappForever();
    const vfs = vapp.globalVfs;

    // -------------------- ChatSessions --------------------
    class ChatSessions {
        constructor(vfs, path = "/data/com.columnos.chat/single/sessions.json") {
            this.vfs = vfs;
            this.path = path;
            this.sessions = [];
            this.loaded = false;
        }

        async load() {
            if (this.loaded) return;
            const blob = await this.vfs.getFile(this.path);
            if (blob) {
                try { this.sessions = JSON.parse(await blob.text()); }
                catch (e) { this.sessions = []; }
            }
            this.loaded = true;
        }

        async save() {
            const blob = new Blob([JSON.stringify(this.sessions, null, 2)], { type: "application/json" });
            await this.vfs.setFile(this.path, blob);
        }

        async add(alias) {
            await this.load();
            if (!this.sessions.includes(alias)) {
                this.sessions.push(alias);
                await this.save();
            }
        }

        async list() {
            await this.load();
            return this.sessions;
        }
    }

    // -------------------- ChatLog --------------------
    class ChatLog {
        constructor(vfs, alias) {
            this.vfs = vfs;
            this.alias = alias;
            this.path = `/data/com.columnos.chat/session/${alias}.json`;
            this.messages = [];
            this.loaded = false;
            this.seenMessages = new Set(); // 避免重复
        }

        async load() {
            if (this.loaded) return;
            const blob = await this.vfs.getFile(this.path);
            if (blob) {
                try {
                    this.messages = JSON.parse(await blob.text());
                    this.messages.forEach(m => this.seenMessages.add(m.id || m.msg));
                } catch (e) { this.messages = []; }
            }
            this.loaded = true;
        }

        async save() {
            const blob = new Blob([JSON.stringify(this.messages, null, 2)], { type: "application/json" });
            await this.vfs.setFile(this.path, blob);
        }

        async append(msgObj) {
            if (this.seenMessages.has(msgObj.id || msgObj.msg)) return;
            this.messages.push(msgObj);
            this.seenMessages.add(msgObj.id || msgObj.msg);
            await this.save();
        }

        async getAll() {
            await this.load();
            return this.messages;
        }
    }

    const chatSessions = new ChatSessions(vfs);
    window.chatSessions = chatSessions;

    // -------------------- UI Elements --------------------
    const contactsEl = document.getElementById("contacts");
    const chatTitle = document.getElementById("chat-title");
    const messagesEl = document.getElementById("messages");
    const inputMessage = document.getElementById("message-input");

    let currentAlias = null;
    let currentChatLog = null;
    let polling = false;

    function appendMessageToUI(text, type) {
        const div = document.createElement("div");
        div.className = `message ${type}`;
        div.textContent = text;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight + 1000;
    }

    async function refreshContacts() {
        const aliases = await chatSessions.list();
        contactsEl.innerHTML = "";
        aliases.forEach(alias => {
            const li = document.createElement("li");
            const [username, hostPart] = alias.split("@");

            li.innerHTML = `${username} <span class="alias-badge">@${hostPart}</span>`;
            li.onclick = () => { selectContact(alias); };
            if (alias === currentAlias) li.classList.add("active");
            contactsEl.appendChild(li);
        });
    }


    async function selectContact(alias) {
        currentAlias = alias;

        // 处理 alias，分离用户名和 host
        const [username, hostPart] = alias.split("@");

        // 更新聊天标题，host 放在 badge
        chatTitle.innerHTML = `聊天: ${username} <span class="alias-badge">@${hostPart}</span>`;

        messagesEl.innerHTML = "";
        currentChatLog = new ChatLog(vfs, alias);
        await currentChatLog.load();

        const msgs = await currentChatLog.getAll();
        msgs.forEach(m => appendMessageToUI(m.msg, m.type));


        await refreshContacts();

        if (!polling) {
            polling = true;
            pollMessages(); // 开始轮询
        }
    }


    // -------------------- 添加联系人 --------------------
    async function addContactHandler() {
        const username = document.getElementById("new-username").value.trim();
        const password = document.getElementById("new-password").value.trim();
        const apiHost = document.getElementById("new-apihost").value.trim();
        if (!username || !password || !apiHost) return alert("请填写完整信息");

        // 生成 alias，不带 http://
        const hostFirstPart = apiHost.split("/")[2]?.split(".")[0] || apiHost;
        const alias = `${username}@${hostFirstPart}`;

        await window.vapp.tokenStore.updateUser(username, password, apiHost, alias);
        await chatSessions.add(alias);
        await refreshContacts();
        alert("联系人添加成功");
    }

    document.getElementById("add-contact").onclick = addContactHandler;

    // -------------------- 发送消息 --------------------
    async function sendMessage() {
        const text = inputMessage.value.trim();
        if (!text || !currentAlias) return;
        inputMessage.value = "";

        const token = await window.vapp.tokenStore.getTokenByAlias(currentAlias);
        console.log(currentAlias);
        const apiHost = await window.vapp.tokenStore.getApiHostByAlias(currentAlias);
        if (!token || !apiHost) return alert("获取 token 失败");

        const msgObj = {
            from: currentAlias,
            session: "single",
            msg: text
        };

        const id6 = "MSG001";
        await vapp.pushToInbox(JSON.stringify(msgObj), id6, token, apiHost);

        await currentChatLog.append({ id: id6 + "-" + Date.now(), type: "sent", ...msgObj });
        appendMessageToUI(text, "sent");
    }
    document.getElementById("send-message").onclick = sendMessage;

    // -------------------- 消息轮询 --------------------
    async function pollMessages() {
        while (true) {
            if (currentAlias && currentChatLog) {
                try {
                    const id6 = "MSG001";
                    const items = await window.vapp.chunkStore.search(id6);
                    console.log("轮询到消息:", items);
                    if (items && items.length) {
                        for (const str of items) {
                            try {
                                const msgObj = JSON.parse(str);
                                console.log("解析到消息对象:", msgObj);
                                if (msgObj.session === "single" && msgObj.from !== currentAlias) {
                                    await currentChatLog.append({ id: Date.now() + "-" + Math.random(), type: "received", ...msgObj });
                                    appendMessageToUI(msgObj.msg, "received");
                                }
                            } catch (e) {
                                console.warn("解析消息失败:", str);
                            }
                        }
                    }
                } catch (e) {
                    console.error("轮询出错:", e);
                }
            }
            await new Promise(r => setTimeout(r, 500));
        }
    }

    await refreshContacts();
})();
