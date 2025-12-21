var initialMouse = 0;
var slideMovementTotal = 0;
var mouseIsDown = false;
var slider = $('#slider');
let unlocked = false;
window.aesEncrypt = window.parent.aesEncrypt;
window.aesDecrypt = window.parent.aesDecrypt;

slider.on('mousedown touchstart', function (event) {
	mouseIsDown = true;
	slideMovementTotal = $('#button-background').width() - $(this).width() + 10;
	initialMouse = event.clientX || event.originalEvent.touches[0].pageX;
});

$(document.body, '#slider').on('mouseup touchend', function (event) {
	if (unlocked)
		return;
	if (!mouseIsDown)
		return;
	mouseIsDown = false;
	var currentMouse = event.clientX || event.changedTouches[0].pageX;
	var relativeMouse = currentMouse - initialMouse;

	if (relativeMouse < slideMovementTotal) {
		$('.slide-text').fadeTo(300, 1);
		slider.animate({
			left: "-10px"
		}, 300);
		return;
	}
	slider.addClass('unlocked');
	$('#locker').html(`<svg xmlns="http://www.w3.org/2000/svg" height="48px" viewBox="0 -960 960 960" width="48px" fill="#1f1f1f"><path d="M198-278q-57-57-87.5-129.5T80-560q0-80 30.5-152.5T198-842l35 35q-49 50-76 113.5T130-560q0 70 27 133.5T233-313l-35 35Zm92-92q-38-38-58-87t-20-103q0-54 20-103t58-87l35 35q-30 31-46.5 71T262-560q0 44 16.5 83.5T325-405l-35 35Zm160 250v-354q-28-9-44.5-33T389-560q0-38 26.5-64.5T480-651q38 0 64.5 26.5T571-560q0 29-16.5 53T510-474v354h-60Zm220-250-35-35q30-32 46.5-71.5T698-560q0-44-16.5-83.5T635-715l35-35q38 38 58 87t20 103q0 54-20 103t-58 87Zm92 92-35-35q49-50 76-113.5T830-560q0-70-27-133.5T727-807l35-35q57 57 87.5 129.5T880-560q0 80-30.5 152.5T762-278Z"/></svg><div style="width:0.5ch;height:1em;"></div><span class="slide-text-ok" id="ok-text-id">正在下线</span>`);
	$('#ok-text-id').fadeTo(300, 1);
	unlocked = true;
	setGtS();
});

$(document.body).on('mousemove touchmove', function (event) {
	if (!mouseIsDown)
		return;

	var currentMouse = event.clientX || event.originalEvent.touches[0].pageX;
	var relativeMouse = currentMouse - initialMouse;
	var slidePercent = 1 - (relativeMouse / slideMovementTotal);

	$('.slide-text').fadeTo(0, slidePercent);

	if (relativeMouse <= 0) {
		slider.css({ 'left': '-10px' });
		return;
	}
	if (relativeMouse >= slideMovementTotal + 10) {
		slider.css({ 'left': slideMovementTotal + 'px' });
		return;
	}
	slider.css({ 'left': relativeMouse - 10 });
});


const CONFIG_PATH = "/systemdata/gt/config.json";
async function readJsonFile(path, defaultValue) {
	try {
		const blob = await vapp.globalVfs.getFile(path);
		const text = await blob.text();
		return JSON.parse(text);
	} catch (e) {
		return defaultValue;
	}
}

/* 写入 JSON 文件（自动创建） */
async function writeJsonFile(path, data) {
	const blob = new Blob(
		[JSON.stringify(data, null, 2)],
		{ type: "application/json" }
	);
	await vapp.globalVfs.setFile(path, blob);
}
async function getConfig() {
	return await readJsonFile(CONFIG_PATH, []);
}

async function loadGtUsers() {
	const config = await getConfig();
	for (const user of config) {

		username = user.firstName;
		apiHost = user.apihost;
		password = user.password;
		alias = "gt:" + user.firstName + user.lastName;
		console.log("Loading GT user:", username, apiHost, alias);
		await vapp.tokenStore.updateUser(username, password, apiHost, alias);
	}
}
async function setGtS() {
	await loadGtUsers();
	const text = document.getElementById("ok-text-id");
	text.innerText = "正在下线";
	const config = await getConfig();
	total = config.length;
	let count = 0;
	text.innerText = `正在下线 (${count}/${total})`;
	for (const user of config) {
		count += 1;
		text.innerText = `正在下线 (${count}/${total})`;
		username = user.firstName;
		apiHost = user.apihost;
		password = user.password;
		alias = "gt:" + user.firstName + user.lastName;
		console.log("Loading GT user:", username, apiHost, alias);
		token = await vapp.tokenStore.getTokenByAlias(alias);
		console.log("Got token:", token);
		if (!token) {
			console.error("无法获取 token，跳过用户:", username);
			continue;
		}
		await sendGtS(token, apiHost, user.signalid);
	}
	text.innerText = "下线完成";
}

async function sendGtS(token,apiHost,id) {
    
    // 2. 构造数据并加密
    const payload = {
        fileId:id,
        fileName: Array.from({ length: 8 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 62))).join(''),
        fileUrl: "gt signal",
        parentId: "0",
        type: "0"
    };

    let encryptedData;
    try {
        encryptedData = window.aesEncrypt(JSON.stringify(payload));
    } catch (e) {
        console.error("加密数据失败", e);
        return null;
    }

    // 3. 发送 POST 请求
    
        const resp = await fetch(`${apiHost}/CloudNotes/api/Notes/AddOrUpdate`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: encryptedData
        });
        const result = await resp.json();
        return true;
    
}