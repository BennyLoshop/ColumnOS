// app.js - 深度测试 系统解锁逻辑（使用 vfs:src 加载）

const $ = id => document.getElementById(id);
const stateTitle = $('stateTitle');
const stateDetail = $('stateDetail');
const statusIcon = $('statusIcon');
const unlockBtn = $('unlockBtn');
const lockBtn = $('lockBtn');
const refreshBtn = $('refreshBtn');
const notice = $('notice');

function setStatus(type, title, detail){
  statusIcon.className = 'status-dot ' + (type || '');
  stateTitle.textContent = title;
  stateDetail.textContent = detail || '';
}

async function blobToText(blob){
  if (!blob) return null;
  try{
    return await blob.text();
  }catch(e){
    return new Promise((resolve, rej) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => rej(r.error);
      r.readAsText(blob);
    });
  }
}

async function readFiles(){
  if (!window.vapp || !window.vapp.globalVfs){
    setStatus('err', '环境错误', 'window.vapp.globalVfs 不可用');
    notice.textContent = '需要宿主环境提供 vfs 支持。';
    return;
  }

  try{
    setStatus('warn','读取中…','正在获取 /system/safety.js 与应用内文件');
    unlockBtn.disabled = lockBtn.disabled = true;

    const sysBlob = await window.vapp.globalVfs.getFile('/system/safety.js');
    const appBlob = await window.vapp.getAppFile('/safety.js').catch(()=>null);
    const appUBlob = await window.vapp.getAppFile('/safety_unlocked.js').catch(()=>null);

    const sysText = await blobToText(sysBlob);
    const appText = await blobToText(appBlob);
    const appUText = await blobToText(appUBlob);

    if (appUText && sysText === appUText){
      setStatus('ok','当前解锁状态：已解锁','/system/safety.js 与 safety_unlocked.js 一致');
      unlockBtn.disabled = true;
      lockBtn.disabled = false;
      notice.textContent = '系统处于已解锁状态。';
      return;
    }

    if (appText && sysText === appText){
      setStatus('warn','当前解锁状态：未解锁','/system/safety.js 与 safety.js 一致');
      unlockBtn.disabled = false;
      lockBtn.disabled = true;
      notice.textContent = '系统处于上锁状态。';
      return;
    }

    setStatus('err','系统解锁状态异常','与 safety.js 与 safety_unlocked.js 均不一致');
    unlockBtn.disabled = !appUText;
    lockBtn.disabled = !appText;
    notice.textContent = '可手动选择覆盖为已解锁或上锁状态。';

  }catch(e){
    console.error(e);
    setStatus('err','读取失败', e.message || e);
    notice.textContent = '读取出错：' + (e.message || e);
  }
}

async function writeSystemSafety(blob){
  return window.vapp.globalVfs.setFile('/system/safety.js', blob);
}

unlockBtn.addEventListener('click', async ()=>{
  try{
    setStatus('warn','正在解锁…','覆盖 /system/safety.js');
    unlockBtn.disabled = lockBtn.disabled = true;

    const src = await window.vapp.getAppFile('/safety_unlocked.js');
    await writeSystemSafety(src);

    notice.textContent = '已写入，重新检查中…';
    await readFiles();
  }catch(e){
    console.error(e);
    setStatus('err','解锁失败', e.message || e);
    notice.textContent = '解锁失败：' + (e.message || e);
  }
});

lockBtn.addEventListener('click', async ()=>{
  try{
    setStatus('warn','正在上锁…','覆盖 /system/safety.js');
    unlockBtn.disabled = lockBtn.disabled = true;

    const src = await window.vapp.getAppFile('/safety.js');
    await writeSystemSafety(src);

    notice.textContent = '已写入，重新检查中…';
    await readFiles();
  }catch(e){
    console.error(e);
    setStatus('err','上锁失败', e.message || e);
    notice.textContent = '上锁失败：' + (e.message || e);
  }
});

refreshBtn.addEventListener('click', async ()=>{
  refreshBtn.disabled = true;
  await readFiles();
  refreshBtn.disabled = false;
});

(async()=>{
  // 等待 vapp 与 globalVfs
  while (!(window.vapp && window.vapp.globalVfs && window.vapp.getAppFile)) {
    await new Promise(r=>setTimeout(r,100));
  }
  await readFiles();
})();
