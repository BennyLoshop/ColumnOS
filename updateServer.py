import base64
import json
import random
import string
import time
import requests
import oss2
import hashlib
import os
from datetime import datetime
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad


def login(userName: str, pwd: str, apiHost: str) -> str:
    """登录获取 token"""
    url = f"{apiHost}/api/TokenAuth/Login"
    data = {"userName": userName, "password": pwd}
    resp = requests.post(url, json=data)
    resp.raise_for_status()
    j = resp.json()
    if not j.get("success"):
        raise Exception("登录失败: " + str(j))
    return j["result"]["accessToken"]


def uploadFileToOss(token: str, apiHost: str, filePath: str) -> str:
    """上传本地文件到 OSS，返回可访问 URL"""
    if not os.path.isfile(filePath):
        raise ValueError(f"{filePath} 不是有效文件")

    # 1. 获取用户信息
    user_info_url = f"{apiHost}/api/services/app/User/GetInfoAsync"
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(user_info_url, headers=headers)
    resp.raise_for_status()
    user_data = resp.json()
    user_id = str(user_data["result"]["id"])

    # 2. 构造 GenerateTokenV2Async 参数
    fc, fr, ft, fe, fo = "note_v2", "res", 2, "", "0"
    nonce = "".join(random.choices(string.hexdigits.lower(), k=16))
    ts = int(time.time() * 1000)
    raw_str = f"{user_id}+{fc}+{fr}+{ft}+{fe}+{fo}+{nonce}+{ts}"
    sign = hashlib.md5(raw_str.encode("utf-8")).hexdigest().upper()

    body = {
        "fc": 1,
        "fr": 1,
        "ft": ft,
        "fe": fe,
        "fo": fo,
        "nonce": nonce,
        "ts": ts,
        "sign": sign,
    }
    token_url = f"{apiHost}/api/services/app/ObjectStorage/GenerateTokenV2Async"
    token_resp = requests.post(token_url, json=body, headers=headers)
    token_resp.raise_for_status()
    r = token_resp.json()["result"]

    # 3. 初始化 OSS 客户端
    auth = oss2.StsAuth(r["accessKeyId"], r["accessKeySecret"], r["securityToken"])
    bucket = oss2.Bucket(auth, "oss-cn-hangzhou.aliyuncs.com", r["bucket"])

    # 4. 构造远程路径
    date_str = time.strftime("%Y%m%d")
    file_name = os.path.basename(filePath)
    remote_file = f"{fc}/{fr}/{user_id}/{date_str}/{nonce}/{file_name}"

    # 5. 上传
    bucket.put_object_from_file(remote_file, filePath)

    url = f"https://{r['bucket']}.oss-cn-hangzhou.aliyuncs.com/{remote_file}"
    print("上传成功:", url)
    return url


# -------------------- AES key 生成 --------------------
def aeskey():
    e = ":F0wKU!Qg3}UkbW+w[:9|D3-5h=:T;7t#_GZ4#G;~ZNSq{8;}QIP>'{q.lje"
    t = datetime.now()
    n = t.year
    r = t.month
    o = t.day
    i = 33 + o * r * 33
    a = chr(i % 94 + 33)
    s = e[o + r]
    c = n * r * o % len(e)
    u = e[:c]
    l = e[c:]
    f = (l + u)[:14]
    return f"{a}{f}{s}"

AES_KEY = aeskey().encode('utf-8')

# -------------------- AES 加解密 --------------------
def aes_encrypt(data: str) -> str:
    cipher = AES.new(AES_KEY, AES.MODE_ECB)
    encrypted = cipher.encrypt(pad(data.encode('utf-8'), AES.block_size))
    return base64.b64encode(encrypted).decode('utf-8')

def aes_decrypt(enc: str) -> str:
    cipher = AES.new(AES_KEY, AES.MODE_ECB)
    decrypted = unpad(cipher.decrypt(base64.b64decode(enc)), AES.block_size)
    return decrypted.decode('utf-8')

# -------------------- chunk --------------------
def chunk(text, type6, chunk_size=510, prefix_overhead=None):
    if prefix_overhead is None:
        prefix_overhead = 6 + 1 + 36 + 1 + 10
    if not type6.isalnum() or len(type6) != 6:
        raise ValueError("type 必须6位字母数字")

    base64_text = base64.b64encode(text.encode('utf-8')).decode('utf-8')
    content_size = chunk_size - prefix_overhead
    total_chunks = (len(base64_text) + content_size - 1) // content_size

    group_id = ''.join(random.choice('0123456789abcdef') for _ in range(32))
    segments = []

    for i in range(total_chunks):
        chunk_content = base64_text[i*content_size:(i+1)*content_size]
        prefix = f"{type6}>{group_id}@{i}~{total_chunks-1}:"
        segments.append(prefix + chunk_content)

    return segments

# -------------------- 获取用户名 --------------------
def get_username_from_token(token):
    try:
        payload = json.loads(base64.b64decode(token.split(".")[1] + "==").decode())
        return payload.get("username") or payload.get("sub") or "unknown"
    except Exception:
        return "unknown"

# -------------------- pushToInbox --------------------
def push_to_inbox(text, id6, token, api_host):
    headers = {"Authorization": f"Bearer {token}"}

    # -------- 获取或创建 Inbox ID --------
    q = aes_encrypt(f"parentid=0&isNoteNode=true&timestamp={int(time.time() * 1000)}")
    resp = requests.get(f"{api_host}/CloudNotes/api/Notes/GetByParentId?{q}", headers=headers)
    result = resp.json()
    if result.get("code") != 0 or not result.get("data"):
        raise RuntimeError("获取笔记失败")
    
    notes_data = json.loads(aes_decrypt(result["data"]))
    inbox = next((n for n in notes_data.get("noteList", [])
                  if n.get("fileUrl") == "ColumnOS Push Service Inbox v2" and n.get("type") == 0), None)

    if inbox:
        inbox_id = inbox["fileId"]
    else:
        new_id = ''.join(random.choice('abcdef0123456789') for _ in range(32))
        payload = {
            "fileId": new_id,
            "fileName": "ColumnOS Push Service Inbox v2",
            "fileUrl": "ColumnOS Push Service Inbox v2",
            "parentId": "0",
            "type": "0"
        }
        encrypted = aes_encrypt(json.dumps(payload))
        create_resp = requests.post(f"{api_host}/CloudNotes/api/Notes/AddOrUpdate",
                                    headers={**headers, "Content-Type": "application/json"},
                                    data=encrypted).json()
        if create_resp.get("code") == 0:
            inbox_id = new_id
        else:
            raise RuntimeError("创建 Inbox 失败")

    # -------- 上传 chunks --------
    items = chunk(text, id6)
    for block in items:
        part1 = block[:255]
        part2 = block[255:] if len(block) > 255 else ""

        payload = {
            "fileId": ''.join(random.choice('abcdef0123456789') for _ in range(32)),
            "fileName": part1,
            "fileUrl": part2,
            "parentId": inbox_id,
            "type": "0"
        }
        encrypted = aes_encrypt(json.dumps(payload))

        # 重试上传
        for attempt in range(10):
            try:
                upload_resp = requests.post(f"{api_host}/CloudNotes/api/Notes/AddOrUpdate",
                                            headers={**headers, "Content-Type": "application/json"},
                                            data=encrypted).json()
                if upload_resp.get("code") == 0:
                    print(f"子节点上传成功: {payload['fileId']}")
                    break
                else:
                    print(f"上传失败（第 {attempt+1} 次）:", upload_resp)
            except Exception as e:
                print(f"请求异常（第 {attempt+1} 次）:", e)
            time.sleep(0.2)
        else:
            print(f"子节点上传失败，已重试 10 次: {payload['fileId']}")

    return True

#token = login("24wuyixuan","cfc8522bc8db","http://sxz.api.zykj.org")
#push_to_inbox("dsaffassssssssdd","xxxxxx",token,"http://sxz.api.zykj.org",) 