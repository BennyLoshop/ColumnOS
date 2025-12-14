from appUtils import *


@retry(max_retry=10, delay=1)
def pushOta(otaFilePath, aliasList):
    ID6 = "APPSTO"

    uploadUser = store.getAnyUser()
    ossUrl = uploadFileToOss(uploadUser[0], uploadUser[1], otaFilePath)

    otaBody = {
        "type": "OTA",
        "origin": "system",
        "title": "系统更新 - 2025.12.13",
        "updateUrl": ossUrl,
        "description": "本次更新包含性能优化和 Bug 修复",
    }

    otaBody = json.dumps(otaBody)

    for i in aliasList:
        token = store.getTokenByAlias(i)
        apiHost = store.getApiHostByAlias(i)
        print("推送 OTA 到:", token, apiHost)
        push_to_inbox(otaBody, ID6, token, apiHost)

if __name__ == "__main__":
    store.load()
    alias_list = [u['alias'] for u in store.db['users']]
    pushOta("./appStoreServer/appIndex.json",alias_list)