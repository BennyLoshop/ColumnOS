import sys
import os
import json
import base64
import asyncio
import websockets
import socket
from PyQt6 import QtWidgets, QtCore, QtGui
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QLabel, QVBoxLayout, QHBoxLayout,
    QWidget, QFileDialog, QPushButton, QSpinBox
)
from PyQt6.QtCore import QThread, pyqtSignal
from PyQt6.QtGui import QFontDatabase

# -------------------- 获取本机局域网 IP --------------------
def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # 不实际连接，只用来获取本机 IP
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()

        # 判断是否是局域网地址
        if ip.startswith("192.") or ip.startswith("10.") or ip.startswith("172.16.") or ip.startswith("172.17.") or ip.startswith("172.18.") or ip.startswith("172.19.") or ip.startswith("172.2") or ip.startswith("172.31."):
            return ip
        return "127.0.0.1"  # 不在局域网则返回回环
    except Exception:
        return "127.0.0.1"
# -------------------- WS 服务线程 --------------------
class WSImportThread(QThread):
    request_file_signal = pyqtSignal()    # 请求主线程弹窗
    status_signal = pyqtSignal(str)       # 发送状态到主线程

    def __init__(self, port=8765):
        super().__init__()
        self.port = port
        self.selected_file = None
        self.loop = None
        self._running = True

    async def handler(self, websocket):
        # 当客户端连接时，通知主线程弹出文件选择
        self.selected_file = None
        self.request_file_signal.emit()

        # 等待用户选择文件或取消
        while self.selected_file is None and self._running:
            await asyncio.sleep(0.1)

        file_path = self.selected_file
        self.selected_file = None

        if not file_path or not os.path.isfile(file_path):
            await websocket.send(json.dumps({"name": "", "data": ""}))
            return

        with open(file_path, "rb") as f:
            data = f.read()
        filename = os.path.basename(file_path)
        encoded = base64.b64encode(data).decode("utf-8")

        await websocket.send(json.dumps({
            "name": filename,
            "data": encoded
        }))

    async def _start_server(self):
        self.status_signal.emit(f"监听中：0.0.0.0:{self.port}")
        async with websockets.serve(self.handler, "0.0.0.0", self.port):
            # 保持运行直到 loop.stop() 或线程请求退出
            await asyncio.Future()

    def run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_until_complete(self._start_server())
        except Exception as e:
            # 线程内的异常发送到 UI
            self.status_signal.emit(f"服务器停止: {e}")
        finally:
            try:
                self.loop.close()
            except Exception:
                pass
            self.status_signal.emit("服务器已停止")

    def stop(self):
        # 请求退出
        self._running = False
        if self.loop and self.loop.is_running():
            try:
                self.loop.call_soon_threadsafe(self.loop.stop)
            except Exception:
                pass

# -------------------- 主窗口 --------------------
class WSFileServerGUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ColumnOS 文件服务")
        self.setFixedSize(300, 80)

        font_path = os.path.join(os.path.dirname(__file__), "SourceHanSansSC-Medium.otf")
        if os.path.isfile(font_path):
            QFontDatabase.addApplicationFont(font_path)
            self.setStyleSheet("QWidget{font-family: 'Source Han Sans SC';}")

        self.local_ip = get_local_ip()
        self.port = 8765

        self.ip_label = QLabel(f"服务器IP: {self.local_ip}")
        self.ip_label.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        self.ip_label.setObjectName("ipLabel")

        layout = QVBoxLayout()
        layout.addWidget(self.ip_label)

        central_widget = QWidget()
        central_widget.setLayout(layout)
        self.setCentralWidget(central_widget)

        self.setStyleSheet("""
            QMainWindow { background-color: #FFFFFF; }
            QLabel#ipLabel { font-size: 16pt; font-weight: 600; color:#222; }
        """)

        self.ws_thread = WSImportThread(port=self.port)
        self.ws_thread.request_file_signal.connect(self.open_file_dialog)
        self.ws_thread.start()

    def open_file_dialog(self):
        dialog = QFileDialog(self, "选择文件", "", "所有文件 (*)")
        dialog.setWindowFlag(QtCore.Qt.WindowType.WindowStaysOnTopHint)
        dialog.setOption(QFileDialog.Option.DontUseNativeDialog, True)
        if dialog.exec():
            selected_files = dialog.selectedFiles()
            self.ws_thread.selected_file = selected_files[0] if selected_files else None
        else:
            self.ws_thread.selected_file = None

    def closeEvent(self, event):
        if self.ws_thread.isRunning():
            self.ws_thread.loop.call_soon_threadsafe(self.ws_thread.loop.stop)
            self.ws_thread.wait(1000)
        event.accept()

# -------------------- 入口 --------------------
if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = WSFileServerGUI()
    window.show()
    sys.exit(app.exec())
