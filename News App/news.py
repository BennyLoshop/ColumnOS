import requests
from bs4 import BeautifulSoup
import re
import html
import json
from datetime import datetime
from updateUtils import *

def fetchZbNews(url: str):
    headers = {"User-Agent": "Mozilla/5.0"}

    res = requests.get(url, headers=headers)
    res.encoding = "utf-8"  # 防止乱码

    soup = BeautifulSoup(res.text, "html.parser")

    # -----------------------------
    # 1. 标题
    # -----------------------------
    title_tag = soup.select_one("h1.article-title")
    title = title_tag.get_text(strip=True) if title_tag else ""

    # -----------------------------
    # 2. meta description
    # -----------------------------
    meta_desc_tag = soup.find("meta", {"name": "description"})
    description = meta_desc_tag["content"] if meta_desc_tag else ""

    # -----------------------------
    # 3. 正文内容段落数组
    # -----------------------------
    content = [
        p.get_text(strip=True)
        for p in soup.select("#article-body p")
        if p.get_text(strip=True)
    ]

    return {"title": title, "description": description, "content": content}

def fetchHotNews(url):
    headers = {"User-Agent": "Mozilla/5.0"}
    res = requests.get(url, headers=headers)
    res.encoding = "utf-8"
    soup = BeautifulSoup(res.text, "html.parser")

    results = []

    # 找到 div.order-240
    container = soup.find("div", class_="order-240")
    if not container:
        return results

    # 在 container 内找 astro-island
    astro_islands = container.find_all("astro-island")
    for island in astro_islands:
        props_str = island.get("props")
        if not props_str:
            continue

        # 反转义 HTML 实体
        props_str = html.unescape(props_str)

        try:
            props = json.loads(props_str)
        except:
            continue

        # initialData 是 [0, {...}]
        initial_data_list = props.get("initialData", [])
        if len(initial_data_list) < 2:
            continue
        initial_data = initial_data_list[1]  # 真实 dict

        # daily 新闻数组是 initial_data["daily"][1]
        daily_list = initial_data.get("daily", [])
        if not daily_list or len(daily_list) < 2:
            continue
        news_array = daily_list[1]

        for _, item in news_array:
            title = item.get("title", [0, ""])[1]
            url_path = item.get("url", [0, ""])[1]
            if url_path.startswith("/"):
                url_full = "https://www.zaobao.com" + url_path
            else:
                url_full = url_path
            results.append({"title": title, "url": url_full})

    return results

def genDailyPush():
    url = "https://www.zaobao.com"
    data = fetchHotNews(url)
    
    pushBody = {
        "type": "daily_news",
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "data": []
    }
    
    for item in data:
        print("Fetching news:", item["title"])
        news_url = item["url"]
        news_data = fetchZbNews(news_url)
        pushBody["data"].append(news_data)
        
    return pushBody

def push(body, aliasList):
    ID6 = "NEWS00"
    for i in aliasList:
        token = store.getTokenByAlias(i)
        apiHost = store.getApiHostByAlias(i)
        print("推送到:", token, apiHost)
        push_to_inbox(body, ID6, token, apiHost)


def dailyPushToAllUsers():
    pushBody = genDailyPush()
    file = "daily_news_push.json"
    with open(file, "w", encoding="utf-8") as f:    
        json.dump(pushBody, f, ensure_ascii=False, indent=4)
    uploadUser = store.getAnyUser()
    url = uploadFileToOss(uploadUser[0], uploadUser[1], file)
    push_body = {
        "url": url
    }
    push_body = json.dumps(push_body)
    store.load()
    alias_list = [u['alias'] for u in store.db['users']]
    push(push_body, alias_list)
    

if __name__ == "__main__":
    while True:
        match input(">"):
            case "push":
                dailyPushToAllUsers()
                print("推送完成")
            case "list":
                store.load()
                list = store.db.get("users", [])
                for i in list:
                    print(f"user<{i['alias']}> \n{i['apiHost']} \n{i['password']}\n\n")
            case "update":
                username = input("username:")
                password = input("password:")
                apiHost = input("apiHost:")
                store.updateUser(alias(username,apiHost), username, password, apiHost)
            case "delete":
                a = input("alias:")
                store.load()
                user = store.findUserByAlias(a)
                if user:
                    store.db["users"] = [u for u in store.db["users"] if u["alias"] != a]
                    store.save()
                    print("删除成功")
                else:
                    print("用户不存在")
            case "exit":
                break
            case _:
                print("未知命令")