const key = "columnos-secret-key-/nHm\\4+:";
const base = '😊';
const pageId = 10;

class UnicodeDataHider {
  /**
   * 初始化时设置基础字符，后续将基于该字符进行编码。
   * @param {string} base 基础字符，例如 '😊'
   */
  constructor(base) {
    this.base = base;
  }

  /**
   * 将字符转换为对应的 Unicode 变体选择器字符。
   * @param {string} char 单个字符
   * @returns {string}
   */
  static charToVariationSelector(char) {
    const byte = char.codePointAt(0); // 等价于 Python 的 ord(char)

    if (byte < 16) {
      return String.fromCodePoint(0xFE00 + byte);
    } else {
      return String.fromCodePoint(0xE0100 + (byte - 16));
    }
  }

  /**
   * 将字符串编码为隐藏在基础字符后的 Unicode 变体选择器字符串。
   * @param {string} data 普通字符串
   * @returns {string}
   */
  encode(data) {
    let encoded = this.base;

    for (const char of data) {
      encoded += UnicodeDataHider.charToVariationSelector(char);
    }

    return encoded;
  }

  /**
   * 将 Unicode 变体选择器字符反向转换为原始字符。
   * @param {string} c 单个字符
   * @returns {string|null}
   */
  static variationSelectorToChar(c) {
    const cp = c.codePointAt(0);

    if (cp >= 0xFE00 && cp <= 0xFE0F) {
      return String.fromCodePoint(cp - 0xFE00);
    } else if (cp >= 0xE0100 && cp <= 0xE01EF) {
      return String.fromCodePoint((cp - 0xE0100) + 16);
    } else {
      return null;
    }
  }

  /**
   * 解码隐藏在 Unicode 变体选择器中的字符串数据。
   * @param {string} encoded 编码后的字符串
   * @returns {string}
   */
  decode(encoded) {
    let result = [];
    let started = false;

    for (const c of encoded) {
      const char = UnicodeDataHider.variationSelectorToChar(c);
      if (char !== null) {
        result.push(char);
        started = true;
      } else if (started) {
        break;
      }
    }

    return result.join('');
  }
}

// 加密函数
function aesEncode(plainText) {
  // plainText: ASCII 或 UTF-8 字符串
  // secretKey: 密钥字符串
  const encrypted = CryptoJS.AES.encrypt(plainText, key);
  return encrypted.toString(); // 返回 Base64 字符串
}

// 解密函数
function aesDecode(cipherText) {
  // cipherText: 加密后的 Base64 字符串
  const decrypted = CryptoJS.AES.decrypt(cipherText, key);
  return decrypted.toString(CryptoJS.enc.Utf8); // 返回原文
}

/**
 * 发送评论函数
 * @param {string} content 评论内容
 * @param {number} pageId specialPageId
 * @param {string} token Bearer Token
 * @param {string} apiHost API Host，例如 "http://sxz.api.zykj.org"
 * @returns {Promise<Object>} 返回接口 JSON
 */
async function sendComment(content, pageId, token, apiHost) {
  const url = `${apiHost}/api/services/app/appWebSite/CreateCommentAsync`;

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*"
  };

  const body = JSON.stringify({
    specialPageId: pageId,
    content: content
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body
    });
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || "接口返回失败");
    }
    return data.result;
  } catch (err) {
    console.error("发送评论出错:", err);
    return { success: false, error: { message: err.message } };
  }
}

/**
 * 删除评论
 * @param {number} commentId 评论 ID
 * @param {string} token Bearer Token
 * @param {string} apiHost API Host，例如 "http://sxz.api.zykj.org"
 * @returns {Promise<Object>} 返回接口 JSON
 * @throws {Error} 如果接口返回 success=false 或请求失败
 */
async function removeComment(commentId, token, apiHost) {
  const url = `${apiHost}/api/services/app/appWebSite/RemovePageCommentAsync?id=${commentId}`;

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json, text/plain, */*"
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: null
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || "接口返回失败");
    }

    return data.result;  // 成功返回
  } catch (err) {
    throw new Error(`删除评论失败: ${err.message}`);
  }
}

/**
 * 获取评论列表
 * @param {number} pageId specialPageId
 * @param {string} token Bearer Token
 * @param {string} apiHost API Host，例如 "http://sxz.api.zykj.org"
 * @param {Object} options 可选参数：
 *        {boolean} publicOnly - 仅公共评论，默认 false
 *        {number} skipCount - 分页起始，默认 0
 *        {number} maxResultCount - 每页数量，默认 20
 *        {boolean} myOnly - 仅我自己的评论，默认 true
 * @returns {Promise<Object>} 返回接口 result 对象
 * @throws {Error} 接口返回 success=false 或请求失败
 */
async function getComments(pageId, token, apiHost, options = {}) {
  const {
    publicOnly = false,
    skipCount = 0,
    maxResultCount = 20,
    myOnly = true
  } = options;

  const url = `${apiHost}/api/services/app/appWebSite/GetPagedCommentsAndRepliesAsync`;

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*"
  };

  const body = JSON.stringify({
    pageId,
    publicOnly,
    skipCount,
    maxResultCount,
    myOnly
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || "接口返回失败");
    }

    return data.result; // 返回 { totalCount, items: [...] }
  } catch (err) {
    throw new Error(`获取评论失败: ${err.message}`);
  }
}

/**
 * 回复指定评论
 * @param {number} commentId 评论 ID
 * @param {string} replyContent 回复内容
 * @param {string} token Bearer Token
 * @param {string} apiHost API Host，例如 "http://sxz.api.zykj.org"
 * @returns {Promise<Object>} 返回接口 JSON
 * @throws {Error} 接口返回 success=false 或请求失败
 */
async function replyComment(commentId, token, apiHost) {
  const url = `${apiHost}/api/services/app/appWebSite/ReplyCommentAsync`;

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*"
  };

  const body = JSON.stringify({
    id: commentId
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || "接口返回失败");
    }

    return data.result; // 成功返回
  } catch (err) {
    throw new Error(`回复评论失败: ${err.message}`);
  }
}

/**
 * 删除评论回复
 * @param {number} replyId 回复 ID
 * @param {string} token Bearer Token
 * @param {string} apiHost API Host，例如 "http://sxz.api.zykj.org"
 * @returns {Promise<Object>} 返回接口 JSON
 * @throws {Error} 接口返回 success=false 或请求失败
 */
async function removeReply(replyId, token, apiHost) {
  const url = `${apiHost}/api/services/app/appWebSite/RemovePageReplyAsync?id=${replyId}`;

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json, text/plain, */*"
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: null
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || "接口返回失败");
    }

    return data.result; // 成功返回
  } catch (err) {
    throw new Error(`删除回复失败: ${err.message}`);
  }
}

class PushContent {
  constructor(identify, message, token, apiHost) {
    this.identify = identify;
    this.message = message;
    this.apiHost = apiHost;
    this.token = token;
    this.hider = new UnicodeDataHider(base);
  }

  splitByLength(str, len = 90) {
    const result = [];
    for (let i = 0; i < str.length; i += len) {
      result.push(str.slice(i, i + len));
    }
    return result;
  }

  handle() {
    let message = this.message;
    message = aesEncode(message);
    let content = [];
    const hider = this.hider;
    const slides = this.splitByLength(message, 100);
    for (let slide of slides) {
      const encoded = slide;
      //const encoded = hider.encode(encoded);
      content.push(encoded);
    }
    return content;
  }

  genHeader() {
    const identify = this.identify;
    let header = { "type": "dhijlmo", "identify": identify };
    header = JSON.stringify(header);
    header = aesEncode(header);
    //header = this.hider.encode(header);
    return header;
  }

  async send() {
    try {
      const contents = this.handle();
      const header = this.genHeader();

      const id = await sendComment(header, pageId, this.token, this.apiHost);
      console.log("推送评论 ID:", id);
      console.debug("推送内容:", header, pageId, this.token, this.apiHost);

      for (let content of contents) {
        await replyComment(id, content, this.token, this.apiHost);
        console.debug("推送回复内容:", content, id, this.token, this.apiHost);
      }

      return true;
    } catch (err) {
      console.error("推送内容失败:", err);
      return false;
    }
  }
}

class PullContent {
  constructor(item) {
    this.item = item;
  }

  content() {
    const sortedReplies = this.item.replies
      .slice()
      .sort((a, b) => a.id - b.id);
    let content = '';
    for (const reply of sortedReplies) {
      let part = reply.reply;
      content += part;
    }
    content = aesDecode(content);

    return content;
  }

  header() {
    try {
      let header = this.item.comment;
      console.log("PullContent header:", header);
      header = aesDecode(header);
      return JSON.parse(header);
    } catch (err) {
      console.error("解析 header 失败:", err);
      return null;
    }
  }
}

async function getPushV2(token, apiHost) {
 
}

async function pushToInboxV2(text, id6, token, apiHost) {
  try {
    const pusher = new PushContent(id6, text, token, apiHost);
    const success = await pusher.send();
    return success;
  } catch (err) {
    console.error("推送内容失败:", err);
    return false;
  }
}
