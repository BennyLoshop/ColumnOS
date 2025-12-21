async function waitVapp() {
  if (window.vapp) return window.vapp;
  return new Promise(resolve => {
    const timer = setInterval(() => {
      if (window.vapp) {
        clearInterval(timer);
        resolve(window.vapp);
      }
    }, 100);
  });
}
function injectFontAwesomeWoff(woffBlobUrl) {
  if (!woffBlobUrl) return;
  const css = `
@font-face {
  font-family: 'FontAwesome';
  src: url('${woffBlobUrl}') format('woff');
  font-weight: normal;
  font-style: normal;
}
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
(async () => {
  const vapp = await waitVapp();
  injectFontAwesomeWoff(URL.createObjectURL(await vapp.getAppFile('/fontawesome-webfont.woff')));
  forEach(await getConfig(), function (contactInfo) {
    addContact(contactInfo);
  });
  forEach(document.querySelectorAll('.contact'), function (contact) {
    contact.addEventListener('click', focusSelectedContact);
  });
})();

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

async function addConfig(config) {
  const list = await getConfig();

  list.push({
    firstName: config.firstName || "",
    lastName: config.lastName || "",
    color: randomColor({ luminosity: 'light' }), // 自动生成
    apihost: config.apihost || "",
    signalid: config.signalid || "",
    password: config.password || ""
  });

  await writeJsonFile(CONFIG_PATH, list);
}

async function delConfig(firstName, lastName) {
  let list = await getConfig();

  list = list.filter(item => !(item.firstName === firstName && item.lastName === lastName));

  await writeJsonFile(CONFIG_PATH, list);
}

async function updateConfig(firstName, lastName, newConfig) {
  const list = await getConfig();

  const idx = list.findIndex(item => item.firstName === firstName && item.lastName === lastName);
  if (idx === -1) return;

  list[idx] = {
    ...list[idx],
    ...newConfig
  };

  await writeJsonFile(CONFIG_PATH, list);
}

async function getConfigByCfg(firstName, lastName) {
  const list = await getConfig(); // 使用之前写好的 getConfig()

  // 返回匹配的第一个对象，如果没有返回 null
  return list.find(item => item.firstName === firstName && item.lastName === lastName) || null;
}


// Utility Function
// Takes any collection with a length property that can be
// emumerated numerically. Each item has it's own callback
function forEach(collection, action, scope) {
  for (var i = 0; i < collection.length; i++) {
    action.call(scope, collection[i], i);
  }
}


//       <span class="last-name">
//     <td>
//   </tr>
//
//   <tr class="contact">
//     ...
//   </tr>
// </tbody>
var contactList = document.querySelector('#contactList tbody');
function addContact(contactInfo) {
  var contact = document.createElement('tr'),
    contactImgWrapper = document.createElement('td'),
    contactImg = document.createElement('div'),
    contactName = document.createElement('td'),
    firstName = document.createElement('span'),
    lastName = document.createElement('span');

  // Add classes to each element in a contact <tr>
  contact.classList.add('contact');
  contactName.classList.add('contact-name');
  firstName.classList.add('first-name');
  lastName.classList.add('last-name');
  contactImgWrapper.classList.add('contact-image');

  // Add the color to the contact-color <td> -> <div>
  contactImg.style.backgroundColor = contactInfo['color'];
  contactImg.setAttribute('data-image-color', contactInfo['color']);


  // Append each element to the contact <tr>
  // starting with the inner most element
  firstName.appendChild(document.createTextNode(contactInfo['firstName']));
  lastName.appendChild(document.createTextNode(contactInfo['lastName']));
  contactImgWrapper.appendChild(contactImg);
  contact.appendChild(contactImgWrapper);
  contactName.appendChild(firstName);
  contactName.appendChild(document.createTextNode(' '));
  contactName.appendChild(lastName);
  contact.appendChild(contactName);

  // Append the contact to the contact list
  contactList.appendChild(contact);
}

// Use the contactInformation collection to build the contact list
getId = window.parent.getCachedGtS;

let isHome = true;
// Event listener for table cells
// Use CSS directly to bring the selected tab into focus
// Rely on CSS Transitions for the animation
async function focusSelectedContact(event) {
  document.querySelector('#sortToggle').style.display = 'block';
  document.querySelector('#addToggle').style.display = 'none';
  document.querySelector('#delToggle').style.display = 'block';
  document.querySelector('#idToggle').style.display = 'none';
  isHome = false;
  var currentTarget = event.currentTarget,
    appBody = document.querySelector('.app-body'),
    rect = currentTarget.getBoundingClientRect(),
    appBarRect = appBody.getBoundingClientRect(),
    translate = appBarRect.top - rect.top + 171,
    root = document.querySelector('html'),
    menuToggleIcon = document.querySelector('#menuToggle i'),
    contactInfo = document.querySelector('.contact-info'),
    color = currentTarget.querySelector('.contact-image div').getAttribute('data-image-color'),
    firstName = currentTarget.querySelector('.contact-name').querySelector('.first-name').textContent,
    lastName = currentTarget.querySelector('.contact-name').querySelector('.last-name').textContent;

  console.log('Selected contact:', firstName, lastName);

  cfg = await getConfigByCfg(firstName, lastName);
  if (cfg) {
    document.querySelector('#input-username').value = cfg.firstName || '';
    document.querySelector('#input-apihost').value = cfg.apihost || '';
    document.querySelector('#input-signalid').value = cfg.signalid || '';
    document.querySelector('#input-password').value = cfg.password || '';
  } else {
    document.querySelector('#input-username').value = '';
    document.querySelector('#input-apihost').value = '';
    document.querySelector('#input-signalid').value = '';
    document.querySelector('#input-password').value = '';
  }

  // Add the initial styles to the selected contact
  currentTarget.classList.remove('previously-selected');
  currentTarget.classList.add('selected-contact');

  // Hide the contacts that weren't clicked
  root.classList.add('hide-contacts');
  root.classList.remove('show-contacts');

  // Reposition the selected contact table cell
  currentTarget.style.webkitTransform = 'translateY(' + translate + 'px)';
  currentTarget.style.transform = 'translateY(' + translate + 'px)';
  currentTarget.offsetHeight; // Force a redraw so the animation works

  // Apply a gradient to the table's background
  appBody.style.backgroundImage = 'linear-gradient(' + color + ' 0%, #fff 100%)';
  appBody.style.backgroundPosition = '0 0';
  appBody.style.overflow = 'hidden';

  // Change the menu button icons
  menuToggleIcon.classList.remove('fa-bars');
  menuToggleIcon.classList.add('fa-arrow-left');
  contactInfo.classList.add('visible');
  contactInfo.style.display = 'block';
}

// Attach the focusSelectedContact event listener to each table cell
forEach(document.querySelectorAll('.contact'), function (contact) {
  contact.addEventListener('click', focusSelectedContact);
});

async function showGtId(id) {
  const modal = document.getElementById('gt-id-modal');
  const input = document.getElementById('gt-signalid');
  input.value = id;

  modal.classList.add('modal-visible');

  return new Promise(resolve => {
    const btnOk = document.getElementById('gt-ok');
    const closeModal = () => {
      modal.classList.remove('modal-visible');
      btnOk.removeEventListener('click', closeModal);
      resolve({ signalid: id });
    };
    btnOk.addEventListener('click', closeModal);
  });
}

// Event listener for the menu button
// Undo all of the css set by focusSelectedContact
function showAllContacts() {
  document.querySelector('#sortToggle').style.display = 'none';
  document.querySelector('#addToggle').style.display = 'block';
  document.querySelector('#delToggle').style.display = 'none';
  document.querySelector('#idToggle').style.display = 'block';
  if (isHome) {
    console.log("Already Home");
    if (window.vapp.params?.return) window.parent.createVApp(window.vapp.params?.return);
    else vapp.exit();
    return;
  }
  isHome = true;

  var appBody = document.querySelector('.app-body'),
    selectedContact = document.querySelector(".selected-contact"),
    menuToggleIcon = document.querySelector('#menuToggle i'),
    contactInfo = document.querySelector('.contact-info');

  // Slide the selected contact back into its original position
  selectedContact.style.webkitTransform = '';
  selectedContact.style.transform = '';
  selectedContact.offsetHeight; // Force a redraw so the browser doesn't skip the animation

  // Remove the gradient on the table's background
  appBody.style.backgroundPosition = '';
  appBody.style.overflow = 'auto';

  // Revert the menu button icons
  contactInfo.classList.remove('visible');

  // After the selected contact is in position (the transition is complete)
  // display the other contacts again
  setTimeout(function () {
    var root = document.querySelector('html');
    root.classList.add('show-contacts');
    root.classList.remove('hide-contacts');
    selectedContact.classList.remove('selected-contact');

  }, 250);
}
async function showAddModel() {
  return new Promise((resolve) => {
    const modal = document.getElementById("add-contact-modal");
    const inputFirstName = document.getElementById("add-firstName");
    const inputPassword = document.getElementById("add-password");
    const inputApihost = document.getElementById("add-apihost");
    const inputSignalid = document.getElementById("add-signalid");
    const btnCancel = document.getElementById("add-cancel");
    const btnOk = document.getElementById("add-ok");

    inputFirstName.value = "";
    inputPassword.value = "";
    inputSignalid.value = "";

    // 显示模态
    modal.classList.add("modal-visible");

    // 取消
    btnCancel.onclick = () => {
      modal.classList.remove("modal-visible");
      resolve(null);
    };

    // 确定
    btnOk.onclick = () => {
      const firstName = inputFirstName.value.trim();
      const password = inputPassword.value.trim();
      const apihostRaw = inputApihost.value.trim();
      const signalid = inputSignalid.value.trim();

      const hostPart = apihostRaw.replace(/^https?:\/\//, '').split('.')[0];
      const lastName = '@' + hostPart;

      const result = {
        firstName,
        lastName,
        apihost: apihostRaw.startsWith('http') ? apihostRaw : 'http://' + apihostRaw,
        signalid,
        password
      };

      modal.classList.remove("modal-visible");
      resolve(result);
    };

    // 点击遮罩关闭
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.classList.remove("modal-visible");
        resolve(null);
      }
    };
  });
}

// Attach the showAllContacts event listener to the menu button
document.querySelector('#menuToggle').addEventListener('click', showAllContacts);
function setInputAbility(editable) {
  const inputs = document.querySelectorAll('.contact-info input');
  const sortToggle = document.querySelector('#sortToggle').querySelector('i');

  inputs.forEach(input => {
    const id = input.id;

    // 永远只读的字段
    const alwaysReadonly =
      id === 'input-username' || id === 'input-apihost';

    if (editable && !alwaysReadonly) {
      input.readOnly = false;
      input.classList.remove('readonly');
      input.classList.add('editable');
      sortToggle.classList.remove('fa-pencil');
      sortToggle.classList.add('fa-floppy-o');
    } else {
      input.readOnly = true;
      input.classList.add('readonly');
      input.classList.remove('editable');
      sortToggle.classList.remove('fa-floppy-o');
      sortToggle.classList.add('fa-pencil');
    }
  });
}
let isEditing = false;
async function editContact() {
  if (isEditing) {
    console.log('Save contact clicked');
    setInputAbility(false);
    isEditing = false;
    const firstName = document.querySelector('#input-username').value;
    const lastName = '@' + document.querySelector('#input-apihost').value.replace(/^https?:\/\//, '').split('.')[0];
    const apihost = document.querySelector('#input-apihost').value;
    const signalid = document.querySelector('#input-signalid').value;
    const password = document.querySelector('#input-password').value;
    config = {
      'firstName': firstName,
      'lastName': lastName,
      'apihost': apihost,
      'signalid': signalid,
      'password': password
    };
    console.log('Updated contact config:', config);
    await updateConfig(firstName, lastName, config);
    return;
  } else {
    isEditing = true;
    console.log('Edit contact clicked');
    setInputAbility(true);
  }
}
document.querySelector('#sortToggle').addEventListener('click', editContact);
document.querySelector('#addToggle').addEventListener('click', async () => {
  console.log('Add contact clicked');
  config = await showAddModel();
  if (!config) {
    console.log('Add contact cancelled');
    return;
  }
  if (await getConfigByCfg(config.firstName, config.lastName)) {
    alert('联系人已存在！');
    return;
  }
  console.log('New contact config:', config);
  await addConfig(config);
  addContact({
    ...config,
    color: randomColor({ luminosity: 'light' })
  });
  forEach(document.querySelectorAll('.contact'), function (contact) {
    contact.addEventListener('click', focusSelectedContact);
  });
});
document.querySelector('#delToggle').addEventListener('click', async () => {
  console.log('Delete contact clicked');
  const firstName = document.querySelector('#input-username').value;
  const lastName = '@' + document.querySelector('#input-apihost').value.replace(/^https?:\/\//, '').split('.')[0];
  const confirmed = confirm(`确定要删除联系人 ${firstName} ${lastName} 吗？`);
  if (!confirmed) return;

  showAllContacts();
  await delConfig(firstName, lastName);

  // 从界面上移除联系人
  const contacts = document.querySelectorAll('.contact');
  contacts.forEach(contact => {
    const fn = contact.querySelector('.first-name').textContent;
    const ln = contact.querySelector('.last-name').textContent;
    if (fn === firstName && ln === lastName) {
      contact.remove();
    }
  });

  // 返回联系人列表视图
});

document.querySelector('#idToggle').addEventListener('click', async () => {
  const id = await getId();
  await showGtId(id);
});