import requests
import threading
from queue import Queue
from concurrent.futures import ThreadPoolExecutor
import time

# ================== 配置区 ==================

LOGIN_URL = "http://sxz.api.zykj.org/api/TokenAuth/Login"
DELETE_URL = "http://sxz.api.zykj.org/api/services/app/appWebSite/RemovePageCommentAsync?id={}"

USERNAME = "24wuyixuan"
PASSWORD = "cfc8522bc8db"   # 你 fetch 里用的那个

THREADS = 20
START_ID = 214000
END_ID   = 214999   # 自行调整

# ===========================================


def login(username, password):
    """登录，返回 accessToken"""
    payload = {
        "userName": username,
        "password": password,
        "clientType": 1
    }

    headers = {
        "Accept": "*/*",
        "Content-Type": "application/json",
    }

    r = requests.post(LOGIN_URL, json=payload, headers=headers, timeout=10)
    r.raise_for_status()
    data = r.json()

    if not data.get("success"):
        raise RuntimeError(f"登录失败: {data.get('error')}")

    return data["result"]["accessToken"]


def remove_comment(comment_id, token):
    """删除评论"""
    headers = {
        "accept": "application/json, text/plain, */*",
        "appname": "WebClient",
        "appversion": "0",
        "authorization": f"Bearer {token}",
        "cache-control": "no-cache",
        "pragma": "no-cache",
    }

    return requests.post(
        DELETE_URL.format(comment_id),
        headers=headers,
        timeout=10
    )


def worker(worker_id, queue):
    """线程 worker：自己登录、自己续 token"""
    try:
        token = login(USERNAME, PASSWORD)
        print(f"[T{worker_id}] 登录成功")
    except Exception as e:
        print(f"[T{worker_id}] 初始登录失败: {e}")
        return

    while True:
        try:
            comment_id = queue.get_nowait()
        except:
            return

        while True:
            try:
                r = remove_comment(comment_id, token)

                # token 失效
                if r.status_code == 401:
                    print(f"[T{worker_id}] 401，重新登录")
                    token = login(USERNAME, PASSWORD)
                    continue

                if r.status_code != 200:
                    print(f"[T{worker_id}] {comment_id} HTTP {r.status_code}")
                    break

                data = r.json()
                if data.get("success"):
                    print(f"[T{worker_id}] ✅ 删除 {comment_id}")
                else:
                    print(f"[T{worker_id}] ❌ {comment_id} {data.get('error')}")

                break

            except Exception as e:
                print(f"[T{worker_id}] 异常 {comment_id}: {e}")
                time.sleep(1)

        queue.task_done()


def main():
    q = Queue()

    for cid in range(START_ID, END_ID + 1):
        q.put(cid)

    with ThreadPoolExecutor(max_workers=THREADS) as executor:
        for i in range(THREADS):
            executor.submit(worker, i, q)

    q.join()
    print("全部完成")


if __name__ == "__main__":
    main()
