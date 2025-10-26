# 完整脚本（略长，请复制保存为 network_tool_auto_start.py 并以管理员方式运行）
import sys
import ctypes
import threading
import time
import logging
import signal
import subprocess
import platform
import re
import hashlib
import os
from datetime import datetime, timedelta
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTextEdit, QFrame, QMessageBox
)

from PyQt6.QtCore import Qt, QThread, pyqtSignal, QDateTime, QObject
from PyQt6.QtGui import QFont, QTextCursor, QIcon
import socket
import requests
from flask import Flask, request, Response, send_file
from urllib.parse import urljoin
from werkzeug.serving import make_server
from flask_cors import CORS

# -------- 配置 --------
TARGET_DOMAINS = ["web.alicdn.zykj.org", "sxz.school.zykj.org", "web-alicdn.zyai.cc"]
REMOTE_BASE_URL = "http://web.alicdn.zykj.org"
INSERT_JS_PATH = "insert.js"
BOOK_DIR = "./book"
HOTSPOT_SSID = "Hack Hotspot"
HOTSPOT_PASSWORD = "helloezy"
URL = "https://hub.gitmirror.com/https://github.com/BennyLoshop/ColumnOS/raw/refs/heads/main/insert.js"
OUT_PATH = os.path.abspath("insert.js")

def try_download(url: str, out_path: str, timeout: int = 10) -> bool:
    """
    尝试下载 URL 到 out_path。
    成功返回 True，失败（包括非200响应或异常）返回 False（并忽略错误）。
    """
    try:
        resp = requests.get(url, stream=True, timeout=timeout)
        if resp.status_code != 200:
            # 非 200 则视为失败，忽略
            # print(f"下载失败，HTTP {resp.status_code}")
            return False

        # 将响应流写入文件（原子写入到临时文件再重命名）
        tmp_path = out_path + ".part"
        with open(tmp_path, "wb") as f:
            shutil.copyfileobj(resp.raw, f)
        os.replace(tmp_path, out_path)
        # print(f"已保存到 {out_path}")
        return True

    except Exception:
        # 忽略所有错误
        # 如需调试，可取消下一行注释以打印异常信息
        # import traceback; traceback.print_exc()
        return False

# -------- IP 获取函数（使用你提供的版本）--------
def get_hotspot_ip():
    try:
        result = subprocess.check_output(
            "ipconfig" if platform.system() == "Windows" else "ifconfig",
            text=True,
            encoding=("gbk" if platform.system() == "Windows" else "utf-8"),
        )
        patterns = [
            r"IPv4 Address[^\d]+(\d+\.\d+\.\d+\.\d+)",
            r"IPv4 地址[^\d]+(\d+\.\d+\.\d+\.\d+)",
            r"inet (\d+\.\d+\.\d+\.\d+).*(?:ap|hotspot)",
            r"inet (\d+\.\d+\.\d+\.\d+).*192\\.168\\.(?:137|43|44)",
        ]
        for pattern in patterns:
            for ip in re.findall(pattern, result, re.IGNORECASE):
                if ip.startswith(("192.168.137.", "192.168.43.", "172.20.10.")):
                    return ip
        ip_matches = re.findall(r"\d+\.\d+\.\d+\.\d+", result)
        for ip in ip_matches:
            if ip.startswith(("192.168.", "172.16.", "10.")) and ip != "127.0.0.1":
                return ip
        return "192.168.137.1"
    except Exception as e:
        return f"自动获取IP失败: {e}"

# -------- 日志重定向 --------
class QTextEditLogger(logging.Handler, QObject):
    log_signal = pyqtSignal(str)
    log_lock = threading.Lock()

    def __init__(self):
        super().__init__()
        QObject.__init__(self)

    def emit(self, record):
        with self.log_lock:
            msg = self.format(record)
            self.log_signal.emit(msg)

# -------- DNS 服务线程（和之前保持一致）--------
class DNSQuery:
    def __init__(self, data):
        self.data = data
        self.domain = ""
        tipo = (data[2] >> 3) & 15
        if tipo == 0:
            ini = 12
            lon = data[ini]
            while lon != 0:
                self.domain += data[ini + 1:ini + lon + 1].decode("utf-8", errors="ignore") + "."
                ini += lon + 1
                lon = data[ini]

    def build_response(self, ip):
        packet = self.data[:2]
        packet += b"\x85\x80"
        packet += self.data[4:6]
        packet += self.data[4:6]
        packet += b"\x00\x00\x00\x00"
        packet += self.data[12:]
        packet += b"\xc0\x0c"
        packet += b"\x00\x01"
        packet += b"\x00\x01"
        packet += b"\x00\x00\x00\x05"
        packet += b"\x00\x04"
        packet += bytes(map(int, ip.split(".")))
        return packet


class DNSThread(QThread):
    log_signal = pyqtSignal(str)
    status_signal = pyqtSignal(bool)
    log_lock = threading.Lock()

    def __init__(self, hotspot_ip, target_domains):
        super().__init__()
        self.hotspot_ip = hotspot_ip
        self.target_domains = target_domains
        self.running = False
        self.sock = None

    def run(self):
        self.running = True
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.bind((self.hotspot_ip, 53))
            self.sock.settimeout(2)
            self.log_signal.emit(f"DNS 服务已启动，绑定 {self.hotspot_ip}:53")
            self.status_signal.emit(True)

            while self.running:
                try:
                    data, addr = self.sock.recvfrom(1024)
                    query = DNSQuery(data)
                    domain = query.domain.strip(".").lower()
                    if domain in self.target_domains:
                        response = query.build_response(self.hotspot_ip)
                        self.sock.sendto(response, addr)
                        with self.log_lock:
                            self.log_signal.emit(f"[DNS] {addr[0]} -> {query.domain} 调试到 {self.hotspot_ip}")
                    else:
                        for dns in [("223.5.5.5", 53), ("1.1.1.1", 53)]:
                            try:
                                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                                s.settimeout(1.5)
                                s.sendto(data, dns)
                                resp, _ = s.recvfrom(1024)
                                self.sock.sendto(resp, addr)
                                s.close()
                                break
                            except:
                                pass
                except socket.timeout:
                    continue
                except Exception as e:
                    with self.log_lock:
                        self.log_signal.emit(f"[!] DNS错误: {e}")
        except OSError as e:
            with self.log_lock:
                self.log_signal.emit(f"[!] DNS 绑定失败: {e}")
            self.status_signal.emit(False)
        finally:
            if self.sock:
                self.sock.close()
            self.status_signal.emit(False)
            with self.log_lock:
                self.log_signal.emit("[!] DNS 服务已停止")

    def stop(self):
        self.running = False
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
        if not self.wait(2000):
            with self.log_lock:
                self.log_signal.emit("[!] DNS线程无法正常终止，强制结束")

# -------- HTTP 服务线程（完整实现）--------
class FlaskServer(QObject):
    def __init__(self, app, host, port):
        super().__init__()
        self.server = make_server(host, port, app)
        self.ctx = app.app_context()
        self.ctx.push()
        self.running = False

    def run(self):
        self.running = True
        self.server.serve_forever()

    def shutdown(self):
        if self.running:
            self.server.shutdown()
            self.running = False


class HTTPThread(QThread):
    log_signal = pyqtSignal(str)
    status_signal = pyqtSignal(bool)
    log_lock = threading.Lock()

    def __init__(self, hotspot_ip, remote_base_url, manifest_js_path, insert_js_path, log_handler):
        super().__init__()
        self.hotspot_ip = hotspot_ip
        self.remote_base_url = remote_base_url
        self.manifest_js_path = manifest_js_path
        self.insert_js_path = insert_js_path
        self.log_handler = log_handler
        self.running = False
        self.flask_server = None
        self.app = self.create_app()
        self.file_mapping = {}
        self.book_dir = BOOK_DIR

    def calculate_md5(self, data):
        md5_hash = hashlib.md5()
        md5_hash.update(data.encode('utf-8') if isinstance(data, str) else data)
        return md5_hash.hexdigest()

    def scan_book_files(self):
        book_files = []
        if not os.path.exists(self.book_dir):
            os.makedirs(self.book_dir)
            return book_files
        for filename in os.listdir(self.book_dir):
            file_path = os.path.join(self.book_dir, filename)
            if os.path.isfile(file_path):
                ext = os.path.splitext(filename)[1].lower()
                if ext in ['.pdf', '.txt']:
                    book_files.append((filename, file_path))
        return book_files

    def generate_book_index(self):
        book_files = self.scan_book_files()
        index_data = []
        self.file_mapping = {}
        timestamp = str(time.time())
        for filename, file_path in book_files:
            name = os.path.splitext(filename)[0]
            filename_md5 = self.calculate_md5(filename)
            try:
                with open(file_path, 'rb') as f:
                    file_md5 = self.calculate_md5(f.read())
            except Exception as e:
                error_msg = f"[!] 计算文件MD5错误 {filename}: {str(e)}"
                with self.log_lock:
                    self.log_signal.emit(error_msg)
                continue
            ext = os.path.splitext(filename)[1][1:].lower()
            special_filename = f"{timestamp}.{filename_md5}.{file_md5}.{ext}"
            url = f"/i_book/res/{special_filename}"
            self.file_mapping[special_filename] = file_path
            index_data.append({"name": name, "url": url})
        return index_data

    def get_cache_headers(self):
        expires = (datetime.utcnow() + timedelta(days=365)).strftime("%a, %d %b %Y %H:%M:%S GMT")
        return {"Cache-Control": "public, max-age=31536000", "Expires": expires}

    def create_app(self):
        app = Flask(__name__, static_folder="i_res")
        app.config['SEND_FILE_MAX_AGE_DEFAULT'] = timedelta(days=365)
        CORS(app, resources={r"/*": {"origins": "*"}})
        app.logger.setLevel(logging.INFO)
        app.logger.addHandler(self.log_handler)

        @app.route("/navPage.html", methods=["GET", "POST", "PUT", "DELETE"])
        def proxy_nav():
            remote_url = urljoin("http://sxz.school.zykj.org", "navPage.html")
            try:
                app.logger.info(f"代理请求: {remote_url}")
                resp = requests.request(
                    method=request.method,
                    url=remote_url,
                    headers={key: value for (key, value) in request.headers if key.lower() != "host"},
                    data=request.get_data(),
                    cookies=request.cookies,
                    allow_redirects=False,
                )
                excluded_headers = ["content-encoding", "content-length", "transfer-encoding", "connection"]
                headers = [(name, value) for (name, value) in resp.raw.headers.items() if name.lower() not in excluded_headers]
                headers += list(self.get_cache_headers().items())
                return Response(resp.content, resp.status_code, headers)
            except Exception as e:
                error_msg = f"[!] 代理错误: {str(e)}"
                with self.log_lock:
                    self.log_signal.emit(error_msg)
                app.logger.error(error_msg)
                return f"Error: {str(e)}", 500

        @app.route("/static/js/manifest.build.<rest>", methods=["GET"])
        def proxy_special_js(rest):
            try:
                remote_url = urljoin(self.remote_base_url, request.path)
                app.logger.info(f"代理请求: {remote_url}")
                response = requests.get(remote_url)
                response.raise_for_status()
                if os.path.exists(self.insert_js_path):
                    with open(self.insert_js_path, "r", encoding="utf-8") as f:
                        insert_content = f.read()
                    modified_content = insert_content + response.text
                else:
                    modified_content = response.text
                headers = {"Content-Type": "application/javascript"}
                headers.update(self.get_cache_headers())
                return Response(modified_content, headers=headers)
            except Exception as e:
                error_msg = f"[!] JS代理错误: {str(e)}"
                with self.log_lock:
                    self.log_signal.emit(error_msg)
                app.logger.error(error_msg)
                return f"Error: {str(e)}", 500

        @app.route("/<path:path>", methods=["GET", "POST", "PUT", "DELETE"])
        def proxy_all(path):
            remote_url = urljoin(self.remote_base_url, path)
            try:
                app.logger.info(f"代理请求: {remote_url}")
                resp = requests.request(
                    method=request.method,
                    url=remote_url,
                    headers={key: value for (key, value) in request.headers if key.lower() != "host"},
                    data=request.get_data(),
                    cookies=request.cookies,
                    allow_redirects=False,
                )
                excluded_headers = ["content-encoding", "content-length", "transfer-encoding", "connection"]
                headers = [(name, value) for (name, value) in resp.raw.headers.items() if name.lower() not in excluded_headers]
                headers += list(self.get_cache_headers().items())
                return Response(resp.content, resp.status_code, headers)
            except Exception as e:
                error_msg = f"[!] 代理错误: {str(e)}"
                with self.log_lock:
                    self.log_signal.emit(error_msg)
                app.logger.error(error_msg)
                return f"Error: {str(e)}", 500

        @app.route("/", methods=["GET", "POST", "PUT", "DELETE"])
        def proxyxy_root():
            return proxy_all("")

        @app.route("/i_book/index/<path:anything>", methods=["GET"])
        def book_index(anything):
            try:
                app.logger.info(f"处理书籍索引请求: /i_book/index/{anything}")
                index_data = self.generate_book_index()
                return Response(json.dumps(index_data, ensure_ascii=False, indent=2), mimetype="application/json", headers={"Cache-Control": "no-cache"})
            except Exception as e:
                error_msg = f"[!] 书籍索引错误: {str(e)}"
                with self.log_lock:
                    self.log_signal.emit(error_msg)
                app.logger.error(error_msg)
                return f"Error: {str(e)}", 500

        @app.route("/i_book/res/<path:filename>", methods=["GET"])
        def book_file(filename):
            try:
                app.logger.info(f"处理书籍文件请求: /i_book/res/{filename}")
                if filename not in self.file_mapping:
                    return "File not found", 404
                file_path = self.file_mapping[filename]
                ext = os.path.splitext(filename)[1].lower()
                mimetype = 'application/pdf' if ext == '.pdf' else 'text/plain; charset=utf-8'
                with open(file_path, 'rb') as f:
                    content = f.read()
                headers = {"Content-Type": mimetype}
                headers.update(self.get_cache_headers())
                return Response(content, headers=headers)
            except Exception as e:
                error_msg = f"[!] 书籍文件访问错误: {str(e)}"
                with self.log_lock:
                    self.log_signal.emit(error_msg)
                app.logger.error(error_msg)
                return f"Error: {str(e)}", 500

        return app

    def run(self):
        self.running = True
        try:
            self.flask_server = FlaskServer(self.app, "0.0.0.0", 80)
            with self.log_lock:
                self.log_signal.emit(f" 服务已启动，绑定 0.0.0.0:80")
            self.status_signal.emit(True)
            self.flask_server.run()
        except Exception as e:
            error_msg = f"[!] HTTP 启动失败: {e}"
            with self.log_lock:
                self.log_signal.emit(error_msg)
            self.status_signal.emit(False)
        finally:
            self.status_signal.emit(False)
            with self.log_lock:
                self.log_signal.emit("[!] HTTP 服务已停止")
            self.running = False

    def stop(self):
        if self.flask_server:
            try:
                self.flask_server.shutdown()
                with self.log_lock:
                    self.log_signal.emit("[*] 正在关闭HTTP服务...")
            except Exception as e:
                with self.log_lock:
                    self.log_signal.emit(f"[!] 关闭HTTP服务出错: {e}")
        try:
            requests.get(f"http://127.0.0.1:80/_shutdown", timeout=1)
        except:
            pass
        self.running = False
        if not self.wait(2000):
            with self.log_lock:
                self.log_signal.emit("[!] HTTP线程无法正常终止，强制结束")

# -------- 启动序列线程（异步执行 powershell 脚本 -> 等待 5 秒 -> 获取 IP -> 启动服务）--------
class StartupThread(QThread):
    log_signal = pyqtSignal(str)
    ssid_pass_signal = pyqtSignal(str, str)
    ip_fetched = pyqtSignal(str)
    ready_to_start = pyqtSignal()

    def __init__(self, ssid=HOTSPOT_SSID, password=HOTSPOT_PASSWORD):
        super().__init__()
        self.ssid = ssid
        self.password = password

    def run(self):
        # 执行脚本（仅在 Windows）
        if platform.system() == "Windows":
            scripts = [
                ("disable-hotspot.ps1", []),
                ("set-hotspot-credentials.ps1", [self.ssid, self.password]),
                ("enable-hotspot.ps1", []),
            ]
            for script, args in scripts:
                cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] + args
                try:
                    self.log_signal.emit(f"执行: {' '.join(cmd)}")
                    subprocess.run(cmd, check=True, shell=False, creationflags=subprocess.CREATE_NO_WINDOW)
                    self.log_signal.emit(f"脚本完成: {script}")
                except subprocess.CalledProcessError as e:
                    self.log_signal.emit(f"脚本执行失败: {script} 返回码 {e.returncode}")
                except Exception as e:
                    self.log_signal.emit(f"执行脚本时异常: {script} -> {e}")
        else:
            self.log_signal.emit("非 Windows 平台，跳过 powershell 热点脚本执行")

        # 发回 SSID/密码
        self.ssid_pass_signal.emit(self.ssid, self.password)

        # 等待 5 秒再获取 IP（按你的要求）
        self.log_signal.emit("等待网络初始化 (5s)...")
        time.sleep(5)
        self.log_signal.emit("尝试更新引导文件...")
        try_download(URL, OUT_PATH)
        ip = get_hotspot_ip()
        self.log_signal.emit(f"获取到热点 IP: {ip}")
        self.ip_fetched.emit(ip)

        # 通知可以启动服务
        self.ready_to_start.emit()

# -------- 关闭服务线程（与之前一致）--------
class CloseServiceThread(QThread):
    finished = pyqtSignal()
    log_signal = pyqtSignal(str)
    log_lock = threading.Lock()

    def __init__(self, http_thread, dns_thread):
        super().__init__()
        self.http_thread = http_thread
        self.dns_thread = dns_thread

    def run(self):
        if self.http_thread and self.http_thread.isRunning():
            with self.log_lock:
                self.log_signal.emit("[*] 开始关闭HTTP服务...")
            self.http_thread.stop()

        if self.dns_thread and self.dns_thread.isRunning():
            with self.log_lock:
                self.log_signal.emit("[*] 开始关闭DNS服务...")
            self.dns_thread.stop()

        self.finished.emit()

# -------- 主 GUI 窗口 --------
class NetworkToolGUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.dns_thread = None
        self.http_thread = None
        self.log_write_lock = threading.Lock()
        self.hotspot_ip = ""
        self.services_running = False
        self.dns_running_flag = False
        self.http_running_flag = False
        self.init_logger()
        self.init_ui()
        self.setWindowIcon(QIcon("icon.ico"))

        # 启动 StartupThread
        self.startup_thread = StartupThread()
        self.startup_thread.log_signal.connect(self.append_log)
        self.startup_thread.ssid_pass_signal.connect(self.on_ssid_pass)
        self.startup_thread.ip_fetched.connect(self.on_ip_fetched)
        self.startup_thread.ready_to_start.connect(self.auto_start_services)
        self.append_log("程序启动：开始初始化（后台执行热点脚本）")
        self.startup_thread.start()

    def init_logger(self):
        self.log_handler = QTextEditLogger()
        self.log_handler.setFormatter(logging.Formatter("[HTTP] %(message)s", datefmt="%H:%M:%S"))
        self.log_handler.log_signal.connect(self.append_log)

    def init_ui(self):
        self.setWindowTitle("ColumnOS安装程序")
        self.setGeometry(100, 100, 540, 280)
        self.setWindowIcon(QIcon("icon.ico"))
        self.setFixedHeight(200)  # 默认日志隐藏时窗口高度
        self.setFixedWidth(400) # 宽度固定或可调整


        # Fluent 风格全局样式
        self.setStyleSheet("""
        QMainWindow {
            background-color: #f3f3f3;
        }
        QLabel {
            color: #333;
        }
        QPushButton {
            background-color: #0078D4;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 6px 12px;
        }
        QPushButton:hover {
            background-color: #005A9E;
        }
        QPushButton:pressed {
            background-color: #004578;
        }
        QTextEdit {
            background-color: #ffffff;
            border: 1px solid #d0d0d0;
            border-radius: 6px;
            padding: 4px;
        }
        QFrame#btn_frame {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 8px;
        }
        """)

        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        main_layout.setSpacing(12)
        main_layout.setContentsMargins(12, 12, 12, 12)

        # 状态标签
        self.status_label = QLabel("启动中...")
        self.status_label.setFont(QFont("Segoe UI", 16, QFont.Weight.Bold))
        main_layout.addWidget(self.status_label)

        # 热点信息
        self.ssid_label = QLabel(f"热点：{HOTSPOT_SSID}")
        self.ssid_label.setFont(QFont("Segoe UI", 12))
        main_layout.addWidget(self.ssid_label)

        self.pass_label = QLabel(f"密码：{HOTSPOT_PASSWORD}")
        self.pass_label.setFont(QFont("Segoe UI", 12))
        main_layout.addWidget(self.pass_label)

        # 顶部按钮卡片
        btn_frame = QFrame()
        btn_frame.setObjectName("btn_frame")
        btn_layout = QHBoxLayout(btn_frame)
        btn_layout.setSpacing(10)
        btn_layout.setContentsMargins(8, 8, 8, 8)

        self.about_btn = QPushButton("关于")
        self.about_btn.setFont(QFont("Segoe UI", 10))
        self.about_btn.clicked.connect(self.show_about_info)

        self.usage_btn = QPushButton("使用说明")
        self.usage_btn.setFont(QFont("Segoe UI", 10))
        self.usage_btn.clicked.connect(self.open_readme_pdf)

        self.log_toggle_btn = QPushButton("日志")
        self.log_toggle_btn.setFont(QFont("Segoe UI", 10))
        self.log_toggle_btn.clicked.connect(self.toggle_logs)

        btn_layout.addWidget(self.about_btn)
        btn_layout.addWidget(self.usage_btn)
        btn_layout.addStretch()
        btn_layout.addWidget(self.log_toggle_btn)
        main_layout.addWidget(btn_frame)

        # 日志文本框
        self.log_text = QTextEdit()
        self.log_text.setFont(QFont("Consolas", 10))
        self.log_text.setReadOnly(True)
        self.log_text.setVisible(False)
        main_layout.addWidget(self.log_text)

        # 初始化日志
        self.append_log("程序已启动，正在执行自动初始化...")


    # 日志写入
    def append_log(self, text):
        with self.log_write_lock:
            timestamp = QDateTime.currentDateTime().toString("HH:mm:ss")
            log_entry = f"{timestamp} {text}\n"
            cursor = self.log_text.textCursor()
            cursor.movePosition(QTextCursor.MoveOperation.End)
            self.log_text.setTextCursor(cursor)
            self.log_text.insertPlainText(log_entry)
            cursor.movePosition(QTextCursor.MoveOperation.End)
            self.log_text.setTextCursor(cursor)

    def toggle_logs(self):
        is_visible = not self.log_text.isVisible()
        self.log_text.setVisible(is_visible)

        # 固定窗口高度
        base_height = 200  # 日志收起时的高度
        log_height = 120   # 日志展开时增加的高度

        if is_visible:
            self.setFixedHeight(base_height + log_height)
        else:
            self.setFixedHeight(base_height)


    def show_about_info(self):
        QMessageBox.about(self, "关于", "作者：75F0E246F4CE4770\n版本：1.1.0\nhttps://bbs.metasxz.org")

    def open_readme_pdf(self):
        pdf_path = os.path.abspath("./README.pdf")
        if not os.path.exists(pdf_path):
            self.append_log(f"错误: 文件 '{pdf_path}' 不存在")
            QMessageBox.information(self, "提示", "README.pdf 未找到")
            return
        try:
            result = ctypes.windll.shell32.ShellExecuteW(None, "open", pdf_path, None, None, 1)
            if result <= 32:
                raise Exception(f"打开失败，错误代码: {result}")
            self.append_log(f"已用默认程序打开: {pdf_path}")
        except Exception as e:
            self.append_log(f"打开文件失败: {e}")
            QMessageBox.warning(self, "错误", f"打开README失败: {e}")

    # StartupThread 信号
    def on_ssid_pass(self, ssid, password):
        self.ssid_label.setText(f"热点：{ssid}")
        self.pass_label.setText(f"密码：{password}")

    def on_ip_fetched(self, ip):
        self.hotspot_ip = ip
        self.append_log(f"热点IP: {ip}")

    def auto_start_services(self):
        self.append_log("准备自动启动 DNS 与 HTTP 服务...")
        # DNS
        self.dns_thread = DNSThread(self.hotspot_ip, TARGET_DOMAINS)
        self.dns_thread.log_signal.connect(self.append_log)
        self.dns_thread.status_signal.connect(self.on_dns_status_changed)
        self.dns_thread.start()
        # HTTP
        self.http_thread = HTTPThread(self.hotspot_ip, REMOTE_BASE_URL, "", INSERT_JS_PATH, self.log_handler)
        self.http_thread.log_signal.connect(self.append_log)
        self.http_thread.status_signal.connect(self.on_http_status_changed)
        self.http_thread.start()
        self.services_running = True

    def on_dns_status_changed(self, running):
        self.dns_running_flag = bool(running)
        self.update_ready_status()

    def on_http_status_changed(self, running):
        self.http_running_flag = bool(running)
        self.update_ready_status()

    def update_ready_status(self):
        if self.dns_running_flag and self.http_running_flag:
            self.status_label.setText("就绪")
            self.status_label.setStyleSheet("color: green;")
            self.append_log("服务已就绪")
        else:
            self.status_label.setText("启动中...")
            self.status_label.setStyleSheet("color: orange;")

    def closeEvent(self, event):
        if self.services_running and not hasattr(self, 'close_in_progress'):
            self.close_in_progress = True
            self.append_log("正在关闭服务...")
            self.stop_services()
        event.accept()

    def stop_services(self):
        self.close_thread = CloseServiceThread(self.http_thread, self.dns_thread)
        self.close_thread.log_signal.connect(self.append_log)
        self.close_thread.finished.connect(self.on_close_finished)
        self.close_thread.start()

    def on_close_finished(self):
        self.services_running = False
        self.append_log("所有服务已停止")

# -------- 主入口 --------
if __name__ == "__main__":
    def handle_signal(signum, frame):
        sys.exit(0)
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    app = QApplication(sys.argv)
    font = QFont("SimHei")
    app.setFont(font)

    # 简短声明
    msg_box = QMessageBox()
    msg_box.setWindowTitle("提示")
    msg_box.setWindowIcon(QIcon("icon.ico"))
    msg_box.setText("请先阅读使用指南。")
    msg_box.setStandardButtons(QMessageBox.StandardButton.Ok)

    # Fluent 风格样式
    msg_box.setStyleSheet("""
        QMessageBox {
            background-color: #f3f3f3;
            border-radius: 8px;
            font-family: 'Segoe UI';
            font-size: 12pt;
            color: #333;
        }
        QLabel {
            color: #333;
            font-size: 12pt;
        }
        QPushButton {
            background-color: #0078D4;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 6px 12px;
            min-width: 80px;
        }
        QPushButton:hover {
            background-color: #005A9E;
        }
        QPushButton:pressed {
            background-color: #004578;
        }
    """)

    msg_box.exec()


    window = NetworkToolGUI()
    window.show()
    sys.exit(app.exec())
