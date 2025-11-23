// 全局缓存当前弹窗 promise
window._ensurePasswordPromise = null;

async function ensurePassword(defaultPwd = "") {
    // 如果已有弹窗正在运行，直接等待它的 promise 并返回同样结果
    if (window._ensurePasswordPromise) {
        return window._ensurePasswordPromise;
    }

    window._ensurePasswordPromise = new Promise(async (resolve) => {
        try {
            // 先尝试从 VFS 读取
            const blob = await window.globalVfs.getFile("/systemdata/settings/authsettings.json");
            if (blob) {
                const text = await blob.text();
                const json = JSON.parse(text);
                const password = json.password || "";
                if (password && password.length > 0) {
                    resolve(password);
                    window._ensurePasswordPromise = null;
                    return;
                }
            }

            // 如果已有默认密码直接返回
            if (defaultPwd && defaultPwd.length > 0) {
                resolve(defaultPwd);
                window._ensurePasswordPromise = null;
                return;
            }

            // ------------------ 创建 modal ------------------
            const modelOverlay = document.createElement('div');
            Object.assign(modelOverlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.8)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 100000
            });

            const modelBox = document.createElement('div');
            Object.assign(modelBox.style, {
                width: '320px',
                padding: '20px',
                borderRadius: '12px',
                backgroundColor: '#2b2b2b',
                color: '#ddd',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif'
            });

            const title = document.createElement('div');
            title.textContent = '请输入中育账号的密码';
            Object.assign(title.style, { fontSize: '18px', fontWeight: 'bold', textAlign: 'center' });

            const input = document.createElement('input');
            input.type = 'password';
            input.placeholder = '用户密码';
            Object.assign(input.style, {
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #555',
                backgroundColor: '#1e1e1e',
                color: '#ddd',
                outline: 'none'
            });

            const btnContainer = document.createElement('div');
            Object.assign(btnContainer.style, { display: 'flex', justifyContent: 'flex-end', gap: '12px' });

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            Object.assign(cancelBtn.style, {
                padding: '6px 12px', borderRadius: '6px', border: 'none', backgroundColor: '#555', color: '#ddd', cursor: 'pointer'
            });
            cancelBtn.onclick = () => {
                modelOverlay.remove();
                resolve(null);
                window._ensurePasswordPromise = null;
            };

            const okBtn = document.createElement('button');
            okBtn.textContent = '确认';
            Object.assign(okBtn.style, {
                padding: '6px 12px', borderRadius: '6px', border: 'none', backgroundColor: '#1a73e8', color: '#fff', cursor: 'pointer'
            });
            okBtn.onclick = async () => {
                const pwd = input.value.trim();
                if (!pwd) return;

                try {
                    const blob = new Blob([JSON.stringify({ password: pwd }, null, 2)], { type: 'application/json' });
                    await window.globalVfs.setFile("/systemdata/settings/authsettings.json", blob);
                    console.log("密码已保存");
                } catch (e) {
                    console.error("保存密码失败", e);
                }

                modelOverlay.remove();
                resolve(pwd);
                window._ensurePasswordPromise = null;
            };

            btnContainer.appendChild(cancelBtn);
            btnContainer.appendChild(okBtn);
            modelBox.appendChild(title);
            modelBox.appendChild(input);
            modelBox.appendChild(btnContainer);
            modelOverlay.appendChild(modelBox);
            document.body.appendChild(modelOverlay);

            input.focus();
        } catch (err) {
            console.error("ensurePassword 弹窗失败:", err);
            resolve(null);
            window._ensurePasswordPromise = null;
        }
    });

    return window._ensurePasswordPromise;
}

// 全局可用
window.ensurePassword = ensurePassword;

//
// 解析 JWT payload
//
function parseJwt(token) {
    try {
        const payload = token.split(".")[1];
        return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
        return null;
    }
}

//
// 初始化 loginInf（只执行一次）
//
window.initLogin = async function () {
    if (window.loginInf) return window.loginInf;

    const url = new URL(window.location.href);
    const apiHost = url.searchParams.get("apiHost");
    const baseToken = url.searchParams.get("apiToken"); // URL 里的初始 accessToken

    if (!apiHost || !baseToken) {
        console.error("缺少 apiHost 或 apiToken");
        return null;
    }

    // 解析 JWT 用户名
    const jwt = parseJwt(baseToken);
    const userName = jwt?.["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"];
    if (!userName) {
        console.error("URL 中 apiToken 无法解析用户名");
        return null;
    }

    // 获取密码（来自 ensurePassword）
    const password = await ensurePassword("");

    const expireAt = jwt?.exp ? jwt.exp * 1000 : Date.now() + 3600 * 1000;

    // 初始化 loginInf
    window.loginInf = {
        accessToken: baseToken,
        expireAt,
        refreshToken: null,
        refreshExpireAt: 0,
        userName,
        password,
        apiHost
    };

    return window.loginInf;
};

//
// 刷新 Token
//
window.refreshToken = async function () {
    const info = window.loginInf;
    if (!info.refreshToken) return null;

    try {
        const resp = await fetch(`${info.apiHost}/api/TokenAuth/RefreshToken`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "refreshtoken": info.refreshToken,
                "Authorization": `Bearer ${info.accessToken}` // 过期也必须带
            }
        });

        const json = await resp.json();
        if (!json.success) return null;

        const r = json.result;

        info.accessToken = r.accessToken;
        info.refreshToken = r.refreshToken;
        info.expireAt = Date.now() + r.expireInSeconds * 1000;
        info.refreshExpireAt = Date.now() + r.refreshExpireInSeconds * 1000;

        return info.accessToken;
    } catch (e) {
        console.error("刷新 token 出错：", e);
        return null;
    }
};

//
// 重新登录
//
window.reLogin = async function () {
    const info = window.loginInf;
    if (!info) return null;

    try {
        const resp = await fetch(`${info.apiHost}/api/TokenAuth/Login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userName: info.userName,
                password: info.password
            })
        });

        const json = await resp.json();
        if (!json.success) return null;

        const r = json.result;

        info.accessToken = r.accessToken;
        info.refreshToken = r.refreshToken;
        info.expireAt = Date.now() + r.expireInSeconds * 1000;
        info.refreshExpireAt = Date.now() + r.refreshExpireInSeconds * 1000;

        return info.accessToken;
    } catch (e) {
        console.error("重新登录失败", e);
        return null;
    }
};

//
// 主函数：获取 Token
//
window.getToken = async function () {
    // 初始化 loginInf（只执行一次）
    const info = await window.initLogin();
    if (!info) return null;

    const now = Date.now();

    // accessToken 未过期 → 直接返回
    if (now < info.expireAt) {
        return info.accessToken;
    }

    // accessToken 过期，但 refreshToken 未过期 → 刷新 token
    if (info.refreshToken && now < info.refreshExpireAt) {
        const newToken = await window.refreshToken();
        if (newToken) return newToken;
    }

    // 两个都过期 → 重新登录
    return await window.reLogin();
};
// tokenStore.js --- 适用于 ColumnOS 的通用 CommonJS 风格（无 module.exports）

(function (global) {

    function TokenStore(path) {
        this.path = path;
        this.db = { users: [] };
        this.loaded = false;
    }

    /* -------------------- 加载 / 保存 -------------------- */

    TokenStore.prototype.load = async function () {
        if (this.loaded) return;

        const blob = await global.globalVfs.getFile(this.path);
        if (blob) {
            try {
                const txt = await blob.text();
                this.db = JSON.parse(txt);
            } catch (e) {
                console.error("tokenStore JSON 解析失败:", e);
            }
        }
        if (!this.db.users) this.db.users = [];

        this.loaded = true;
    };

    TokenStore.prototype.save = async function () {
        const blob = new Blob([JSON.stringify(this.db, null, 2)], {
            type: "application/json"
        });
        await global.globalVfs.setFile(this.path, blob);
    };

    /* -------------------- 查找用户 -------------------- */

    TokenStore.prototype.findUser = function (username, apiHost) {
        return this.db.users.find(function (u) {
            return u.username === username && u.apiHost === apiHost;
        });
    };

    TokenStore.prototype.findUserByAlias = function (alias) {
        return this.db.users.find(function (u) {
            return u.alias === alias;
        });
    };

    /* -------------------- 更新 / 新增用户 -------------------- */

    TokenStore.prototype.updateUser = async function (username, password, apiHost, alias) {
        await this.load();

        var u = this.findUser(username, apiHost);

        if (!u) {
            u = {
                username: username,
                password: password,
                apiHost: apiHost,
                alias: alias || "",
                accessToken: "",
                refreshToken: "",
                expireAt: 0,
                refreshExpireAt: 0
            };
            this.db.users.push(u);
        } else {
            u.password = password;
            if (alias) u.alias = alias;
        }

        await this.save();
    };

    /* -------------------- API 调用 -------------------- */

    TokenStore.prototype._login = async function (u) {
        try {
            var resp = await fetch(u.apiHost + "/api/TokenAuth/Login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userName: u.username,
                    password: u.password
                })
            });

            var json = await resp.json();
            if (!json.success) return null;

            var r = json.result;
            u.accessToken = r.accessToken;
            u.refreshToken = r.refreshToken;
            u.expireAt = Date.now() + r.expireInSeconds * 1000;
            u.refreshExpireAt = Date.now() + r.refreshExpireInSeconds * 1000;

            await this.save();
            return u.accessToken;

        } catch (e) {
            console.error("登录失败:", e);
            return null;
        }
    };

    TokenStore.prototype._refreshToken = async function (u) {
        try {
            var resp = await fetch(u.apiHost + "/api/TokenAuth/RefreshToken", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "refreshtoken": u.refreshToken,
                    "Authorization": "Bearer " + u.accessToken
                }
            });

            var json = await resp.json();
            if (!json.success) return null;

            var r = json.result;
            u.accessToken = r.accessToken;
            u.refreshToken = r.refreshToken;
            u.expireAt = Date.now() + r.expireInSeconds * 1000;
            u.refreshExpireAt = Date.now() + r.refreshExpireInSeconds * 1000;

            await this.save();
            return u.accessToken;

        } catch (e) {
            console.error("刷新 token 出错:", e);
            return null;
        }
    };

    /* -------------------- 获取 Token -------------------- */

    TokenStore.prototype._getToken = async function (u) {
        var now = Date.now();

        if (u.accessToken && now < u.expireAt) {
            return u.accessToken;
        }

        if (u.refreshToken && now < u.refreshExpireAt) {
            var tk = await this._refreshToken(u);
            if (tk) return tk;
        }

        return await this._login(u);
    };

    TokenStore.prototype.getTokenByUsername = async function (username, apiHost) {
        await this.load();

        var u = this.findUser(username, apiHost);
        if (!u) return null;

        return await this._getToken(u);
    };

    TokenStore.prototype.getTokenByAlias = async function (alias) {
        await this.load();

        var u = this.findUserByAlias(alias);
        if (!u) return null;

        return await this._getToken(u);
    };

    TokenStore.prototype.getApiHostByAlias = async function (alias) {
        await this.load();
        const u = this.findUserByAlias(alias);
        return u ? u.apiHost : null;
    };


    /* -------------------- 暴露到 global（真正的 CommonJS 风格） -------------------- */

    global.TokenStore = TokenStore;

})(window);
window.tokenStore = new TokenStore("/systemdata/tokenstore.json");