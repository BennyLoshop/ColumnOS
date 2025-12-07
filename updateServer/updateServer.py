from flask import Flask, request, jsonify, render_template
import os
from werkzeug.utils import secure_filename
from updateUtils import TokenStore, alias, pushOta

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = "uploads"
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

store = TokenStore("TokenStore/tokens.json")


# -------------------- 用户管理页面 --------------------
@app.route("/users_page")
def users_page():
    return render_template("users.html")


# -------------------- OTA 推送页面 --------------------
@app.route("/push_ota_page")
def push_ota_page():
    return render_template("push_ota.html")


# -------------------- API: 获取/添加/删除用户 --------------------
@app.route("/users", methods=["GET", "POST", "PUT", "DELETE"])
def manage_users():
    if request.method == "GET":
        store.load()
        return jsonify(store.db.get("users", []))

    data = request.json or {}
    username = data.get("username")
    password = data.get("password")
    apiHost = data.get("apiHost")
    a = data.get("alias") or alias(username, apiHost)

    if request.method in ["POST", "PUT"]:
        store.updateUser(a, username, password, apiHost)
        return jsonify({"success": True, "alias": a})
    elif request.method == "DELETE":
        store.load()
        user = store.findUserByAlias(a)
        if user:
            store.db["users"] = [u for u in store.db["users"] if u["alias"] != a]
            store.save()
            return jsonify({"success": True})
        return jsonify({"success": False, "error": "用户不存在"}), 404


# -------------------- OTA 推送 API --------------------
@app.route("/push_ota", methods=["POST"])
def push_ota_api():
    if "file" not in request.files:
        return jsonify({"success": False, "error": "缺少文件"}), 400
    f = request.files["file"]
    filename = secure_filename(f.filename)
    save_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    f.save(save_path)
    aliasList = request.form.getlist("alias")
    if not aliasList:
        return jsonify({"success": False, "error": "缺少 alias"}), 400
    try:
        pushOta(save_path, aliasList)
        return jsonify({"success": True, "file": filename})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/push_ota_to_global", methods=["PUT"])
def push_ota_to_global():
    if "file" not in request.files:
        return jsonify({"success": False, "error": "缺少文件"}), 400

    f = request.files["file"]
    filename = secure_filename(f.filename)
    save_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    f.save(save_path)

    try:
        store.load()
        all_aliases = [u["alias"] for u in store.db.get("users", [])]
        if not all_aliases:
            return jsonify({"success": False, "error": "没有用户"}), 400

        pushOta(save_path, all_aliases)
        return jsonify(
            {"success": True, "file": filename, "pushed_to": len(all_aliases)}
        )
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
