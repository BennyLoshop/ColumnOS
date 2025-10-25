import sys
import os
import asyncio
import websockets
import json
import base64
import socket
import random
import subprocess
from pathlib import Path
from websockets.server import serve
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
    QGroupBox
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QDateTime, QObject
from PyQt6.QtGui import QFont, QTextCursor, QIcon

# 全局配置
DEFAULT_BOOK_DIR = os.path.abspath("./book")
DEFAULT_HOST = "0.0.0.0"
ALLOWED_ORIGINS = "*"

# 全局字体设置 - 统一使用SimHei
def get_simhei_font(size=10, bold=False):
    """创建并返回SimHei字体实例"""
    font = QFont("SimHei", size)
    if bold:
        font.setBold(True)
    return font


# 日志重定向类
class QTextEditLogger(QObject):
    log_signal = pyqtSignal(str)
    log_lock = asyncio.Lock()

    def __init__(self):
        super().__init__()

    def emit(self, record):
        msg = record
        self.log_signal.emit(msg)


# WebSocket服务器线程
class WebSocketServerThread(QThread):
    log_signal = pyqtSignal(str)
    status_signal = pyqtSignal(bool)
    address_signal = pyqtSignal(str, int)  # 发送IP和端口信号
    
    def __init__(self, book_dir, host, port):
        super().__init__()
        self.book_dir = book_dir
        self.host = host
        self.port = port
        self.running = False
        self.loop = None
        self.server = None
        self.main_task = None  # 跟踪主任务

    def get_book_list(self):
        """获取书籍列表"""
        books = []
        try:
            Path(self.book_dir).mkdir(parents=True, exist_ok=True)
            
            for filename in os.listdir(self.book_dir):
                filepath = os.path.join(self.book_dir, filename)
                if os.path.isfile(filepath):
                    filesize = os.path.getsize(filepath)
                    if filename.lower().endswith('.pdf'):
                        file_type = 'pdf'
                    elif filename.lower().endswith('.txt'):
                        file_type = 'txt'
                    else:
                        file_type = 'other'
                    
                    books.append({
                        "name": filename,
                        "url": f"/books/{filename}",
                        "size": filesize,
                        "type": file_type
                    })
            return books
        except Exception as e:
            error_msg = f"获取书籍列表错误: {e}"
            self.log_signal.emit(error_msg)
            return []

    def get_file_content(self, file_path):
        """获取文件内容，二进制文件返回base64编码"""
        try:
            if file_path.startswith("/books/"):
                filename = file_path[7:]
            else:
                filename = os.path.basename(file_path)
                
            filepath = os.path.join(self.book_dir, filename)
            
            if not os.path.exists(filepath) or not os.path.isfile(filepath):
                return None, "文件不存在"
            
            if filename.lower().endswith('.pdf'):
                with open(filepath, 'rb') as f:
                    content = base64.b64encode(f.read()).decode('utf-8')
                return content, None
            elif filename.lower().endswith('.txt'):
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                return content, None
            else:
                return None, "不支持的文件类型"
        except Exception as e:
            error_msg = f"获取文件内容错误: {e}"
            self.log_signal.emit(error_msg)
            return None, str(e)

    async def handle_client(self, websocket, path):
        """处理客户端连接"""
        self.log_signal.emit("新客户端连接")
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    self.log_signal.emit(f"收到消息: {data}")
                    
                    if data.get('type') == 'get_book_list':
                        books = self.get_book_list()
                        response = {
                            "type": "book_list",
                            "books": books
                        }
                        await websocket.send(json.dumps(response))
                        
                    elif data.get('type') == 'get_file':
                        file_path = data.get('path', '')
                        content, error = self.get_file_content(file_path)
                        
                        if error:
                            response = {
                                "type": "error",
                                "message": error,
                                "path": file_path
                            }
                        else:
                            response = {
                                "type": "file_content",
                                "path": file_path,
                                "content": content
                            }
                        await websocket.send(json.dumps(response))
                        
                    else:
                        response = {
                            "type": "error",
                            "message": "未知命令"
                        }
                        await websocket.send(json.dumps(response))
                        
                except json.JSONDecodeError:
                    response = {
                        "type": "error",
                        "message": "无效的JSON格式"
                    }
                    await websocket.send(json.dumps(response))
                except Exception as e:
                    response = {
                        "type": "error",
                        "message": f"处理请求时出错: {str(e)}"
                    }
                    await websocket.send(json.dumps(response))
                    
        except websockets.exceptions.ConnectionClosed:
            self.log_signal.emit("客户端断开连接")
        except Exception as e:
            self.log_signal.emit(f"处理客户端时出错: {e}")

    # 新增：创建一个永远等待的协程
    async def _wait_forever(self):
        """用于保持服务器运行的协程"""
        await asyncio.Future()  # 永远等待

    async def server_task(self):
        """服务器主任务"""
        try:
            async with serve(
                self.handle_client, 
                self.host, 
                self.port,
                process_request=lambda path, request_headers: (
                    403,
                    [
                        ("Content-Type", "text/plain"),
                        ("Access-Control-Allow-Origin", ALLOWED_ORIGINS),
                        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
                        ("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept"),
                    ],
                    b"Cross-origin request denied",
                ) if (
                    request_headers.get("Origin") and 
                    ALLOWED_ORIGINS != "*" and 
                    request_headers["Origin"] not in ALLOWED_ORIGINS.split(",")
                ) else None
            ) as server:
                self.server = server
                self.address_signal.emit(self.host, self.port)
                self.log_signal.emit(f"WebSocket服务器已启动，监听 {self.host}:{self.port}")
                self.log_signal.emit(f"书籍目录: {os.path.abspath(self.book_dir)}")
                self.status_signal.emit(True)
                
                # 关键修复：使用协程而非直接使用Future
                self.main_task = asyncio.create_task(self._wait_forever())
                await self.main_task  # 等待直到被取消
                
        except Exception as e:
            self.log_signal.emit(f"服务器启动失败: {e}")
            self.status_signal.emit(False)
        finally:
            self.status_signal.emit(False)

    def run(self):
        self.running = True
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_until_complete(self.server_task())
        except Exception as e:
            self.log_signal.emit(f"服务器运行出错: {e}")
        finally:
            # 确保所有任务都被正确清理
            self._cleanup_tasks()
            self.loop.close()
            self.log_signal.emit("WebSocket服务器已停止")

    def _cleanup_tasks(self):
        """清理所有pending的任务"""
        if not self.loop or self.loop.is_closed():
            return
            
        try:
            # 取消所有活跃任务
            tasks = [t for t in asyncio.all_tasks(self.loop) if not t.done()]
            if tasks:
                self.log_signal.emit(f"清理 {len(tasks)} 个未完成任务")
                for task in tasks:
                    task.cancel()
                # 等待任务取消完成
                self.loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))
        except Exception as e:
            self.log_signal.emit(f"清理任务时出错: {e}")

    def stop(self):
        if not self.running:
            return
            
        self.running = False
        
        # 优雅地取消主任务
        if self.main_task and not self.main_task.done():
            self.main_task.cancel()
            
        # 关闭服务器
        if self.server:
            self.loop.call_soon_threadsafe(self.server.close)
        
        # 等待服务器关闭
        if self.loop and not self.loop.is_closed():
            self.loop.call_soon_threadsafe(self.loop.stop)
        
        # 等待线程结束
        if not self.wait(3000):  # 延长等待时间到3秒
            self.log_signal.emit("[!] WebSocket线程无法正常终止，强制结束")


# 关闭服务线程
class CloseServiceThread(QThread):
    finished = pyqtSignal()
    log_signal = pyqtSignal(str)

    def __init__(self, server_thread):
        super().__init__()
        self.server_thread = server_thread

    def run(self):
        if self.server_thread and self.server_thread.isRunning():
            self.log_signal.emit("[*] 开始关闭WebSocket服务...")
            self.server_thread.stop()

        self.finished.emit()


# 工具函数：获取可用的随机端口
def get_available_port():
    while True:
        port = random.randint(1024, 65535)
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("localhost", port))
                return port
        except OSError:
            continue


# 工具函数：获取本地IP地址
def get_local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


# 主窗口类
class BookServerGUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.server_thread = None
        self.services_running = False
        self.close_in_progress = False
        self.log_write_lock = asyncio.Lock()
        self.current_ip = ""
        self.current_port = 0

        # 初始化UI
        self.init_ui()
        self.set_window_icon()

    def set_window_icon(self):
        """设置窗口图标"""
        try:
            icon = QIcon("icon.ico")
            if not icon.isNull():
                self.setWindowIcon(icon)
            else:
                self.append_log("警告：无法加载图标文件")
        except Exception as e:
            self.append_log(f"设置图标时出错: {str(e)}")

    def init_ui(self):
        self.setWindowTitle("在线专栏DNS劫持注入工具")
        self.setGeometry(100, 100, 800, 600)

        # 全局应用SimHei字体
        self.setFont(get_simhei_font())

        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)

        # 标题
        title_label = QLabel("在线专栏DNS劫持注入工具")
        title_label.setFont(get_simhei_font(16, bold=True))
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title_label.setStyleSheet("margin: 10px 0px;")
        main_layout.addWidget(title_label)

        # 分隔线
        line = QFrame()
        line.setFrameShape(QFrame.Shape.HLine)
        line.setFrameShadow(QFrame.Shadow.Sunken)
        main_layout.addWidget(line)

        # 连接信息区域
        connect_group = QGroupBox()
        connect_group.setFont(get_simhei_font(11, bold=True))
        connect_layout = QVBoxLayout()
        connect_group.setLayout(connect_layout)
        connect_group.setStyleSheet("margin: 5px 0px;")

        # 服务器地址显示
        address_layout = QHBoxLayout()
        address_label = QLabel("服务器地址: ")
        address_label.setFont(get_simhei_font(12, bold=True))
        self.address_display = QLabel("未启动")
        self.address_display.setFont(get_simhei_font(12))
        self.address_display.setStyleSheet("color: #2c3e50; font-family: SimHei, monospace;")
        address_layout.addWidget(address_label)
        address_layout.addWidget(self.address_display)
        connect_layout.addLayout(address_layout)

        main_layout.addWidget(connect_group)

        # 状态区域
        status_group = QGroupBox()
        status_group.setFont(get_simhei_font(11, bold=True))
        status_layout = QVBoxLayout()
        status_group.setLayout(status_layout)
        status_group.setStyleSheet("margin: 5px 0px;")

        # 服务器状态
        server_layout = QHBoxLayout()
        server_label = QLabel("服务状态: ")
        server_label.setFont(get_simhei_font(12))
        self.server_status = QLabel("未运行")
        self.server_status.setFont(get_simhei_font(12))
        self.server_status.setStyleSheet("color: red;")
        server_layout.addWidget(server_label)
        server_layout.addWidget(self.server_status)
        server_layout.addStretch()
        status_layout.addLayout(server_layout)
        
        # 应用状态
        tip_layout = QHBoxLayout()
        tip_label = QLabel("本程序为电子书导入程序")
        tip_label.setFont(get_simhei_font(12))
        tip_layout.addWidget(tip_label)
        tip_layout.addStretch()
        status_layout.addLayout(tip_layout)

        # 控制按钮
        btn_layout = QHBoxLayout()
        self.control_btn = QPushButton("启动服务")
        self.control_btn.setFont(get_simhei_font(12))
        self.control_btn.setStyleSheet(
            "padding: 8px 16px; background-color: #4CAF50; color: white; border-radius: 4px;"
        )
        self.control_btn.clicked.connect(self.toggle_services)
        btn_layout.addWidget(self.control_btn)

        self.open_dir_btn = QPushButton("打开书籍目录")
        self.open_dir_btn.setFont(get_simhei_font(12))
        self.open_dir_btn.setStyleSheet(
            "padding: 8px 16px; background-color: #6082B6; color: white; border-radius: 4px;"
        )
        self.open_dir_btn.clicked.connect(self.open_book_dir)
        btn_layout.addWidget(self.open_dir_btn)

        self.about_btn = QPushButton("关于")
        self.about_btn.setFont(get_simhei_font(12))
        self.about_btn.setStyleSheet(
            "padding: 8px 16px; background-color: #C3B1E1; color: white; border-radius: 4px;"
        )
        self.about_btn.clicked.connect(self.show_about_info)
        btn_layout.addWidget(self.about_btn)

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
        log_label.setFont(get_simhei_font(12))
        main_layout.addWidget(log_label)

        self.log_text = QTextEdit()
        self.log_text.setFont(get_simhei_font(10))
        self.log_text.setReadOnly(True)
        self.log_text.setStyleSheet(
            "border: 1px solid #ccc; border-radius: 5px; padding: 5px;"
        )
        main_layout.addWidget(self.log_text)

        # 初始化信息
        self.append_log("程序已启动，等待用户操作...")
        self.append_log(f"默认书籍目录: {DEFAULT_BOOK_DIR}")
        self.append_log("服务启动后将自动分配随机端口")

    def open_book_dir(self):
        """打开书籍目录"""
        book_dir = DEFAULT_BOOK_DIR
        Path(book_dir).mkdir(parents=True, exist_ok=True)
        
        try:
            if sys.platform.startswith('win32'):
                os.startfile(book_dir)
            elif sys.platform.startswith('darwin'):
                subprocess.run(['open', book_dir])
            else:
                subprocess.run(['xdg-open', book_dir])
            self.append_log(f"已打开书籍目录: {book_dir}")
        except Exception as e:
            self.append_log(f"打开目录失败: {e}")
            QMessageBox.warning(self, "错误", f"打开目录失败: {str(e)}")

    def show_about_info(self):
        """显示关于信息"""
        QMessageBox.about(
            self, 
            "关于", 
            "电子书服务器\n" +
            "版本: 1.0.0\n" +
            "用于通过WebSocket提供电子书文件服务"
        )

    def append_log(self, text):
        """添加日志到界面"""
        timestamp = QDateTime.currentDateTime().toString("HH:mm:ss")
        log_entry = f"[{timestamp}] {text}\n"

        cursor = self.log_text.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        self.log_text.setTextCursor(cursor)
        self.log_text.insertPlainText(log_entry)
        cursor.movePosition(QTextCursor.MoveOperation.End)
        self.log_text.setTextCursor(cursor)

    def update_server_status(self, running):
        """更新服务器状态显示"""
        if running:
            self.server_status.setText("运行中")
            self.server_status.setStyleSheet("color: green;")
        else:
            self.server_status.setText("已停止")
            self.server_status.setStyleSheet("color: red;")
            self.address_display.setText("未启动")

    def update_server_address(self, host, port):
        """更新服务器地址显示"""
        display_ip = self.current_ip if self.current_ip else "127.0.0.1"
        self.address_display.setText(f"{display_ip}:{port}")
        self.append_log(f"客户端可连接: ws://{display_ip}:{port}")

    def toggle_services(self):
        """切换服务状态（启动/停止）"""
        if self.close_in_progress:
            return

        if self.services_running:
            self.stop_services()
        else:
            self.start_services()

    def start_services(self):
        """启动服务器"""
        port = get_available_port()
        self.current_ip = get_local_ip()
        self.current_port = port
        
        try:
            Path(DEFAULT_BOOK_DIR).mkdir(parents=True, exist_ok=True)
        except Exception as e:
            QMessageBox.warning(self, "目录错误", f"无法创建书籍目录: {str(e)}")
            return

        self.server_thread = WebSocketServerThread(DEFAULT_BOOK_DIR, DEFAULT_HOST, port)
        self.server_thread.log_signal.connect(self.append_log)
        self.server_thread.status_signal.connect(self.update_server_status)
        self.server_thread.address_signal.connect(self.update_server_address)
        self.server_thread.start()

        self.services_running = True
        self.control_btn.setText("停止服务")
        self.control_btn.setStyleSheet(
            "padding: 8px 16px; background-color: #f44336; color: white; border-radius: 4px;"
        )
        self.append_log("正在启动服务器...")
        self.append_log(f"已获取可用端口: {port}")
        self.append_log(f"本地IP地址: {self.current_ip}")

    def stop_services(self):
        """停止服务器"""
        if self.close_in_progress or not self.services_running:
            return

        self.close_in_progress = True
        self.control_btn.setEnabled(False)
        self.control_btn.setText("正在停止...")

        self.close_thread = CloseServiceThread(self.server_thread)
        self.close_thread.log_signal.connect(self.append_log)
        self.close_thread.finished.connect(self.on_close_finished)
        self.close_thread.start()

    def on_close_finished(self):
        """关闭完成后的处理"""
        self.services_running = False
        self.close_in_progress = False
        
        self.control_btn.setText("启动服务")
        self.control_btn.setStyleSheet(
            "padding: 8px 16px; background-color: #4CAF50; color: white; border-radius: 4px;"
        )
        self.control_btn.setEnabled(True)
        
        self.append_log("所有服务已停止")

    def closeEvent(self, event):
        """窗口关闭时确保服务已停止"""
        if self.services_running:
            self.stop_services()
            while self.close_in_progress:
                QApplication.processEvents()
        
        event.accept()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    
    # 应用全局SimHei字体
    font = get_simhei_font()
    app.setFont(font)
    
    window = BookServerGUI()
    window.show()
    sys.exit(app.exec())
    