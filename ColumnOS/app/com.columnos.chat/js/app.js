(async () => {
    // -------------------- 永远等待 vapp --------------------
    async function waitVappForever() {
        return new Promise(resolve => {
            if (window.vapp) return resolve(window.vapp);
            const timer = setInterval(() => {
                if (window.vapp) {
                    clearInterval(timer);
                    resolve(window.vapp);

                    async function initUserAlias() {
                        if (!window.vapp) return null;

                        const username = window.vapp.getUsername?.();
                        const apiHost = window.vapp.getApiHost?.();

                        if (!username || !apiHost) return null;

                        const hostFirstPart = apiHost.split("/")[2]?.split(".")[0] || apiHost;
                        window.userAlias = `${username}@${hostFirstPart}`;
                        console.log("当前用户 alias:", window.userAlias);
                        return window.userAlias;
                    }

                    initUserAlias();
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
    const nickModal = document.getElementById("nick-modal");
    const nickInput = document.getElementById("nick-input");
    const nickSaveBtn = document.getElementById("nick-save-btn");
    const nickCancelBtn = document.getElementById("nick-cancel-btn");
    const userNickText = document.getElementById("user-nick");
    const editNickBtn = document.getElementById("edit-nick-btn");
    const addContactModal = document.getElementById("add-contact-modal");
    const addContactBtn = document.getElementById("add-contact-btn");
    const addContactCancelBtn = document.getElementById("add-contact-cancel-btn");
    const addContactSaveBtn = document.getElementById("add-contact-save-btn");
    const inputUsername = document.getElementById("contact-username");
    const inputApiHost = document.getElementById("contact-apihost");
    const inputPassword = document.getElementById("contact-password");

    addContactBtn.onclick = () => {
        inputUsername.value = "";
        inputApiHost.value = "http://sxz.api.zykj.org";
        inputPassword.value = "";
        addContactModal.style.display = "flex";
    };

    addContactCancelBtn.onclick = () => addContactModal.style.display = "none";

    addContactSaveBtn.onclick = async () => {
        const username = inputUsername.value.trim();
        const password = inputPassword.value.trim();
        const apiHost = inputApiHost.value.trim();
        if (!username || !password || !apiHost) return alert("请填写完整信息");

        const hostFirstPart = apiHost.split("/")[2]?.split(".")[0] || apiHost;
        const alias = `${username}@${hostFirstPart}`;

        await window.vapp.tokenStore.updateUser(username, password, apiHost, alias);
        await chatSessions.add(alias);

        const myNick = await userNick.getNick(window.userAlias);
        await sendCfgUpdate(alias, myNick);

        await refreshContacts();
        addContactModal.style.display = "none";
    };


    editNickBtn.onclick = async () => {
        nickInput.value = userNickText.textContent;
        nickModal.style.display = "flex";
    };

    nickCancelBtn.onclick = () => nickModal.style.display = "none";

    nickSaveBtn.onclick = async () => {
        const newNick = nickInput.value.trim();
        if (!newNick) return;

        await userNick.setNick(window.userAlias, newNick);

        const aliases = await chatSessions.list();
        for (const alias of aliases) await sendCfgUpdate(alias, newNick);

        userNickText.textContent = newNick;
        await refreshContacts();

        nickModal.style.display = "none";
    };

    let currentAlias = null;
    let currentChatLog = null;
    let polling = false;

    // -------------------- 渲染消息 --------------------
    function appendMessageToUI(text, type) {
        const div = document.createElement("div");
        div.className = `message ${type}`;
        div.textContent = text;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
    }

    // -------------------- 懒加载消息 --------------------
    const PAGE_SIZE = 20;
    let renderedIndex = null;

    async function renderMessagesLazy() {
        if (!currentChatLog) return;
        await currentChatLog.load();
        const messages = currentChatLog.messages;

        if (renderedIndex === null) {
            // 初次渲染最新消息
            renderedIndex = messages.length;
            const start = Math.max(0, renderedIndex - PAGE_SIZE);
            const batch = messages.slice(start, renderedIndex);

            batch.forEach(msg => {
                const div = document.createElement("div");
                div.className = `message ${msg.type}`;
                div.textContent = msg.msg;
                messagesEl.appendChild(div);
            });
            renderedIndex = start;

            // 延迟 100ms 再滚动到底部
            setTimeout(() => {
                messagesEl.scrollTop = messagesEl.scrollHeight;
            }, 200);

            return;
        }
        if (renderedIndex === null) {
            // 初次渲染：最新 PAGE_SIZE 条消息
            renderedIndex = messages.length;
            const start = Math.max(0, renderedIndex - PAGE_SIZE);
            const batch = messages.slice(start, renderedIndex);

            batch.forEach(msg => {
                const div = document.createElement("div");
                div.className = `message ${msg.type}`;
                div.textContent = msg.msg;
                messagesEl.appendChild(div);
            });

            renderedIndex = start;

            // ⚡ 确保渲染完成后滚动到底部
            requestAnimationFrame(() => {
                messagesEl.scrollTop = messagesEl.scrollHeight;
            });

            return;
        }

        // 滚动顶部加载历史消息
        const start = Math.max(0, renderedIndex - PAGE_SIZE);
        const batch = messages.slice(start, renderedIndex);

        const prevScrollHeight = messagesEl.scrollHeight;

        batch.reverse().forEach(msg => {
            const div = document.createElement("div");
            div.className = `message ${msg.type}`;
            div.textContent = msg.msg;
            messagesEl.prepend(div);
        });

        // 保持滚动位置
        messagesEl.scrollTop = messagesEl.scrollHeight - prevScrollHeight;
        renderedIndex = start;
    }


    messagesEl.addEventListener("scroll", async () => {
        if (messagesEl.scrollTop === 0) {
            await renderMessagesLazy();
        }
    });

    // -------------------- 联系人 --------------------
    async function refreshContacts() {
        const aliases = await chatSessions.list();
        contactsEl.innerHTML = "";
        for (const alias of aliases) {
            const li = document.createElement("li");
            const nick = await userNick.getNick(alias);
            const hostPart = alias.split("@")[1] || alias;
            li.innerHTML = `${nick} <span class="alias-badge">@${hostPart}</span>`;
            li.onclick = () => { selectContact(alias); };
            if (alias === currentAlias) li.classList.add("active");
            contactsEl.appendChild(li);
        }
    }


    async function selectContact(alias) {
        currentAlias = alias;
        const nick = await userNick.getNick(alias);
        const hostPart = alias.split("@")[1] || alias;
        chatTitle.innerHTML = `聊天: ${nick} <span class="alias-badge">@${hostPart}</span>`;

        messagesEl.innerHTML = "";
        currentChatLog = new ChatLog(vfs, alias);
        renderedIndex = null;
        await renderMessagesLazy();

        await refreshContacts();

        if (!polling) { polling = true; pollMessages(); }
    }



    // -------------------- 发送消息 --------------------
    async function sendMessage() {
        const text = inputMessage.value.trim();
        if (!text || !currentAlias) return;
        inputMessage.value = "";

        const targetAlias = currentAlias;
        const targetChatLog = currentChatLog;

        const pendingDiv = appendMessageToUI(text, "pending");

        const token = await window.vapp.tokenStore.getTokenByAlias(targetAlias);
        const apiHost = await window.vapp.tokenStore.getApiHostByAlias(targetAlias);
        if (!token || !apiHost) {
            pendingDiv.textContent = text + " (发送失败)";
            pendingDiv.classList.remove("pending");
            pendingDiv.classList.add("received");
            return;
        }

        const msgObj = {
            type: "msg",
            from: window.userAlias,
            session: "single",
            msg: text
        };

        const id6 = "MSG001";

        try {
            await vapp.pushToInbox(JSON.stringify(msgObj), id6, token, apiHost);

            await targetChatLog.append({
                id: id6 + "-" + Date.now(),
                type: "sent",
                ...msgObj
            });

            if (currentAlias === targetAlias) {
                pendingDiv.classList.remove("pending");
                pendingDiv.classList.add("sent");
            } else {
                pendingDiv.remove();
            }

        } catch (e) {
            if (currentAlias === targetAlias) {
                pendingDiv.textContent = text + " (发送失败)";
                pendingDiv.classList.remove("pending");
                pendingDiv.classList.add("received");
            } else {
                pendingDiv.remove();
            }
        }
    }

    class UserNick {
        constructor(vfs, path = "/data/com.columnos.chat/userNickName.json") {
            this.vfs = vfs;
            this.path = path;
            this.nickMap = {};  // alias -> nickname
            this.loaded = false;
        }

        async load() {
            if (this.loaded) return;
            const blob = await this.vfs.getFile(this.path);
            if (blob) {
                try { this.nickMap = JSON.parse(await blob.text()); }
                catch (e) { this.nickMap = {}; }
            }
            this.loaded = true;
        }

        async save() {
            const blob = new Blob([JSON.stringify(this.nickMap, null, 2)], { type: "application/json" });
            await this.vfs.setFile(this.path, blob);
        }

        async setNick(alias, nickname) {
            await this.load();
            this.nickMap[alias] = nickname;
            await this.save();
        }

        async getNick(alias) {
            await this.load();
            return this.nickMap[alias] || alias;
        }
    }

    const userNick = new UserNick(vfs);

    async function sendCfgUpdate(targetAlias, nickname) {
        const msgObj = {
            type: "cfg_update",
            from: window.userAlias,
            cfg_nickName: nickname
        };
        const id6 = "MSG001";
        const token = await window.vapp.tokenStore.getTokenByAlias(targetAlias);
        const apiHost = await window.vapp.tokenStore.getApiHostByAlias(targetAlias);
        if (!token || !apiHost) return;
        try { await vapp.pushToInbox(JSON.stringify(msgObj), id6, token, apiHost); } catch (e) { console.warn("发送cfg失败", targetAlias, e); }
    }
    document.getElementById("send-message").onclick = sendMessage;

    // -------------------- 消息轮询 --------------------
    async function pollMessages() {
        while (true) {
            try {
                const id6 = "MSG001";
                const items = await window.vapp.chunkStore.search(id6);
                console.log("轮询到消息:", items);

                if (items && items.length) {
                    for (const str of items) {
                        try {
                            const msgObj = JSON.parse(str);

                            if (!msgObj.from) continue;
                            console.log("处理消息来自:", msgObj.from);
                            console.log("当前聊天对象:", currentAlias);
                            console.log("消息内容:", msgObj);
                            console.log("消息类型:", msgObj.type);

                            if (msgObj.type === "cfg_update" && msgObj.cfg_nickName) {
                                await userNick.setNick(msgObj.from, msgObj.cfg_nickName);
                                console.log("收到昵称更新:", msgObj.from, msgObj.cfg_nickName);
                                if (msgObj.from === currentAlias) await refreshContacts();
                                continue;
                            }

                            const allAliases = await chatSessions.list();
                            if (!allAliases.includes(msgObj.from)) continue;

                            const log = new ChatLog(vfs, msgObj.from);
                            await log.load();

                            const saved = {
                                id: Date.now() + "-" + Math.random(),
                                type: "received",
                                ...msgObj
                            };

                            await log.append(saved);

                            if (currentAlias === msgObj.from) {
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

            await new Promise(r => setTimeout(r, 500));
        }
    }



    await refreshContacts();
    if (!polling) { polling = true; pollMessages(); }
    const nick = await userNick.getNick(window.userAlias);
    // 如果没有设置过昵称，显示默认 alias
    document.getElementById("user-nick").textContent = nick || window.userAlias;
})();
