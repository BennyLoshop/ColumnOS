from flask import Flask, jsonify, request, abort, render_template
from pathlib import Path
import json
import tempfile
import os
from appUtils import uploadFileToOss, store
from appServer import pushOta

app = Flask(__name__)

DATA_FILE = Path("./appStoreServer/appIndex.json")


# ---------- 工具函数 ----------


def load_apps():
    if not DATA_FILE.exists():
        return []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_apps(apps):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(apps, f, ensure_ascii=False, indent=2)


def find_app(apps, app_id):
    return next((a for a in apps if a["appId"] == app_id), None)


# ---------- API ----------


@app.route("/")
def admin():
    return render_template("admin.html")


# 获取所有应用
@app.route("/apps", methods=["GET"])
def get_apps():
    return jsonify(load_apps())


@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "missing file"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "empty filename"}), 400

    # 保存到临时文件
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        file.save(tmp.name)
        temp_path = tmp.name

    try:
        # 取一个可用 OSS 用户
        upload_user = store.getAnyUser()
        oss_url = uploadFileToOss(
            upload_user[0],
            upload_user[1],
            temp_path
        )

        return jsonify({
            "url": oss_url
        })

    finally:
        # 清理临时文件
        try:
            os.remove(temp_path)
        except Exception:
            pass


# 获取单个应用
@app.route("/apps/<app_id>", methods=["GET"])
def get_app(app_id):
    apps = load_apps()
    app_item = find_app(apps, app_id)
    if not app_item:
        abort(404, "App not found")
    return jsonify(app_item)


# 新增应用
@app.route("/apps", methods=["POST"])
def create_app():
    data = request.json
    if not data or "appId" not in data:
        abort(400, "Missing appId")

    apps = load_apps()
    if find_app(apps, data["appId"]):
        abort(409, "App already exists")

    data.setdefault("appVersion", "0.0.0")
    data.setdefault("snapshots", [])
    data.setdefault("description", "")
    data.setdefault("appIcon", "")
    data.setdefault("appLink", "")

    apps.append(data)
    save_apps(apps)
    return jsonify(data), 201


# 更新应用
@app.route("/apps/<app_id>", methods=["PUT"])
def update_app(app_id):
    data = request.json
    if not data:
        abort(400, "Invalid JSON")

    apps = load_apps()
    app_item = find_app(apps, app_id)
    if not app_item:
        abort(404, "App not found")

    # 允许更新的字段
    for key in [
        "appName",
        "appVersion",
        "appIcon",
        "description",
        "snapshots",
        "appLink",
    ]:
        if key in data:
            app_item[key] = data[key]

    save_apps(apps)
    return jsonify(app_item)

@app.route('/push')
def push():
    store.load()
    alias_list = [u['alias'] for u in store.db['users']]
    pushOta("./appStoreServer/appIndex.json",alias_list)
    return {"success":True}

# 删除应用
@app.route("/apps/<app_id>", methods=["DELETE"])
def delete_app(app_id):
    apps = load_apps()
    new_apps = [a for a in apps if a["appId"] != app_id]

    if len(new_apps) == len(apps):
        abort(404, "App not found")

    save_apps(new_apps)
    return jsonify({"ok": True})


# ---------- 启动 ----------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
