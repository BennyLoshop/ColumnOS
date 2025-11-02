import asyncio
import websockets
import os
import base64
import zipfile
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import time

# ---------------- 配置 ----------------
SOURCE_DIR = r"./ColumnOS"  # 要打包的源文件夹
OUTPUT_DIR = r"./image"     # 输出目录
OUTPUT_ZIP = "system.zip"   # 输出文件名
ROOT_DIR = os.path.abspath(".")  # WS 根目录

# 创建输出目录（如果不存在）
os.makedirs(OUTPUT_DIR, exist_ok=True)

zip_path = os.path.join(OUTPUT_DIR, OUTPUT_ZIP)

def build_zip():
    """打包 ColumnOS 文件夹为 system.zip"""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(SOURCE_DIR):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, SOURCE_DIR)
                zipf.write(file_path, arcname)
    print(f"[ZIP] 打包完成: {zip_path}")

# 初次打包
build_zip()

# ---------------- 文件监控 ----------------
class ChangeHandler(FileSystemEventHandler):
    def __init__(self):
        self._last_build = time.time()
        self._debounce_seconds = 0.5  # 避免频繁触发

    def on_any_event(self, event):
        if event.is_directory:
            return
        now = time.time()
        if now - self._last_build > self._debounce_seconds:
            print(f"[WATCH] 文件变动: {event.src_path}")
            build_zip()
            self._last_build = now

observer = Observer()
observer.schedule(ChangeHandler(), SOURCE_DIR, recursive=True)
observer.start()

# ---------------- WebSocket ----------------
async def handler(websocket):
    async for message in websocket:
        # 去掉 URL 前缀和前导 /，安全解析
        file_rel_path = message.replace("http://127.0.0.1/", "").lstrip("/\\")
        file_path = os.path.join(ROOT_DIR, file_rel_path)
        file_path = os.path.abspath(file_path)

        print(f"[WS] Request for: {message}")
        print(f"[WS] Resolved path: {file_path}")

        # 防止路径穿越
        if not file_path.startswith(ROOT_DIR):
            print(f"[WS] Blocked illegal access: {file_path}")
            await websocket.send("")
            continue

        if os.path.isfile(file_path):
            with open(file_path, "rb") as f:
                data = f.read()
            encoded = base64.b64encode(data).decode("utf-8")
            await websocket.send(encoded)
            print(f"[WS] Sent {len(data)} bytes for {file_rel_path}")
        else:
            await websocket.send("")
            print(f"[WS] File not found: {file_rel_path}")

async def main():
    async with websockets.serve(handler, "0.0.0.0", 8766):
        print("WebSocket server started on ws://127.0.0.1:8766")
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
