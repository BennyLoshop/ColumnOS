// =================== 自动刷新 apps 列表 ===================

async function autoRefreshAppList(interval = 2000) {
    while (true) {
        const start = Date.now();
        try {
            const list = await getAppList();  // 获取最新应用列表
            await setAppList(list);                 // 更新全局 apps
        } catch (e) {
            console.error("刷新应用列表失败:", e);
        }
        const elapsed = Date.now() - start;
        // 等待 interval - 已耗时间，确保至少间隔 interval 毫秒
        await new Promise(resolve => setTimeout(resolve, Math.max(0, interval - elapsed)));
    }
}



autoRefreshAppList(100);//1