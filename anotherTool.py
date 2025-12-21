import socket
import threading
import ssl
import os
import re
import subprocess
import platform
import time
import sys
import ctypes
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime


TARGET_DOMAIN = "wapcdn.qupeiyin.cn"
LOCAL_HTML_FILE = "text.html"


def get_hotspot_ip():
    try:
        result = subprocess.check_output('ipconfig' if platform.system() == 'Windows' else 'ifconfig',
                                         text=True,
                                         encoding=('gbk' if platform.system() == 'Windows' else 'utf-8'))
        patterns = [
            r"IPv4 Address[^\d]+(\d+\.\d+\.\d+\.\d+)",
            r"IPv4 地址[^\d]+(\d+\.\d+\.\d+\.\d+)",
            r"inet (\d+\.\d+\.\d+\.\d+).*(?:ap|hotspot)",
            r"inet (\d+\.\d+\.\d+\.\d+).*192\.168\.(?:137|43|44)"
        ]
        for pattern in patterns:
            for ip in re.findall(pattern, result, re.IGNORECASE):
                if ip.startswith(('192.168.137.', '192.168.43.', '172.20.10.')):
                    return ip
        ip_matches = re.findall(r"\d+\.\d+\.\d+\.\d+", result)
        for ip in ip_matches:
            if ip.startswith(('192.168.', '172.16.', '10.')) and ip != '127.0.0.1':
                return ip
        return "192.168.137.1"
    except Exception as e:
        print(f"[!] 自动获取IP失败: {e}")
        return "192.168.137.1"

def is_admin_windows():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except:
        return False

def disable_firewall():
    if platform.system() == "Windows":
        print("[*] 配置Windows防火墙...")
        os.system('netsh advfirewall set allprofiles state off 2>nul')
        os.system('netsh advfirewall firewall add rule name="Allow80" dir=in action=allow protocol=TCP localport=80')
        os.system('netsh advfirewall firewall add rule name="Allow443" dir=in action=allow protocol=TCP localport=443')
        os.system('netsh advfirewall firewall add rule name="Allow53" dir=in action=allow protocol=UDP localport=53')
    else:
        print("[*] 非Windows系统，请手动配置防火墙")

def enable_firewall():
    if platform.system() == "Windows":
        os.system('netsh advfirewall set allprofiles state on 2>nul')

def get_timestamp():
    return datetime.now().strftime("%H:%M:%S")

print("\n***********************************免责声明***********************************")
print("                             本工具仅作为技术研究                             ")
print("                             切勿应用于违法场景中!                            ")
print("                   下载本工具者应于下载后24小时内删除本工具                   ")
print("                本工具中的证书为自签证书，不具有真实的法律效应                ")
print("               任何法律责任与 Bilibili @ 爱玩电脑的cmd-本尊 无关！            ")
print("******************************************************************************")
print("按下Enter键代表您已阅读并同意免责声明...")
input("请按Enter键继续...")
print("\n*----------------------------------软件声明----------------------------------*")
print(" 请在提示'HTTPS 重定向服务器已启动: https://* -> http://'后再打开会员中心！ ")
print("                    本工具会修改系统防火墙策略！请谨慎使用！                  ")
print("                           系统要求：Windows10及以上                          ")
print("                  本工具完全免费，若您是付费下载，请举报商家！                ")
print("强烈建议进入家长小天才APP，进入 更多->应用中心->右上角更多->关闭“应用新版本自动下载及更新，以防Bug修复")
print("  灵感来源：Bilibili @ 星旬Star ，灵感视频：bilibili.com/video/BV1jLuqzgELX   ")
print("------------------------------------------------------------------------------")
print("以上条款必读！")
print("按下Enter键代表您已阅读并同意软件声明...")
input("请按Enter键继续...")
print("\n")
HOTSPOT_IP = get_hotspot_ip()
print(f"[*] 热点IP: {HOTSPOT_IP}")
print(f"[*] 劫持域名: {TARGET_DOMAIN} -> {HOTSPOT_IP}")
print(f"[*] 本地HTML: {LOCAL_HTML_FILE}")


class DNSQuery:
    def __init__(self, data):
        self.data = data
        self.domain = ""
        tipo = (data[2] >> 3) & 15
        if tipo == 0:
            ini = 12
            lon = data[ini]
            while lon != 0:
                self.domain += data[ini+1:ini+lon+1].decode('utf-8', errors='ignore') + '.'
                ini += lon + 1
                lon = data[ini]

    def build_response(self, ip):
        packet = self.data[:2] + b"\x81\x80"
        packet += self.data[4:6] + self.data[4:6] + b"\x00\x00\x00\x00"
        packet += self.data[12:]
        packet += b"\xC0\x0C"
        packet += b"\x00\x01\x00\x01\x00\x00\x00\x3C\x00\x04"
        packet += bytes(map(int, ip.split('.')))
        return packet

def dns_server():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind((HOTSPOT_IP, 53))
        sock.settimeout(2)
        print(f"[+] DNS 已绑定 {HOTSPOT_IP}:53")
    except OSError as e:
        print(f"[!] DNS 绑定失败: {e}")
        return
    while True:
        try:
            data, addr = sock.recvfrom(1024)
            query = DNSQuery(data)
            if TARGET_DOMAIN in query.domain:
                sock.sendto(query.build_response(HOTSPOT_IP), addr)
                print(f"[{get_timestamp()} DNS] {addr[0]} -> {query.domain} (劫持)")
            else:
                for dns in [("8.8.8.8", 53), ("1.1.1.1", 53)]:
                    try:
                        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                        s.settimeout(1.5)
                        s.sendto(data, dns)
                        resp, _ = s.recvfrom(1024)
                        sock.sendto(resp, addr)
                        s.close()
                        print(f"[{get_timestamp()} DNS] {addr[0]} -> {query.domain} (转发)")
                        break
                    except:
                        pass
        except socket.timeout:
            continue
        except Exception as e:
            print(f"[!] DNS错误: {e}")


class LocalHTTPHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        client_ip = self.client_address[0]
        host = self.headers.get('Host', HOTSPOT_IP)
        path = self.path
        user_agent = self.headers.get('User-Agent', '')
        
        full_url = f"http://{host}{path}"
        
        if TARGET_DOMAIN in host:
            status = "(劫持)"
        else:
            status = "(其他)"
            
        print(f"[{get_timestamp()} HTTP] {client_ip} -> {full_url} {status}")
        print(f"    User-Agent: {user_agent}")

        if TARGET_DOMAIN in host or host == HOTSPOT_IP:
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            if os.path.exists(LOCAL_HTML_FILE):
                with open(LOCAL_HTML_FILE, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.wfile.write(b"<h1>Local Page</h1><p>HTML file not found</p>")
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

    def log_message(self, format, *args):
        return

def http_server():
    try:
        print(f"[+] HTTP 服务器已启动: http://{HOTSPOT_IP}:80")
        HTTPServer(('0.0.0.0', 80), LocalHTTPHandler).serve_forever()
    except Exception as e:
        print(f"[!] HTTP 服务器失败: {e}")

class RedirectHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        client_ip = self.client_address[0]
        host = self.headers.get('Host', HOTSPOT_IP)
        path = self.path
        user_agent = self.headers.get('User-Agent', '')
        

        full_url = f"https://{host}{path}"
        
        if TARGET_DOMAIN in host:
            status = "(劫持)"
        else:
            status = "(其他)"
            
        print(f"[{get_timestamp()} HTTPS] {client_ip} -> {full_url} {status}")
        print(f"    User-Agent: {user_agent}")

        self.send_response(301)
        self.send_header('Location', f'http://{TARGET_DOMAIN}{self.path}')
        self.end_headers()

    def log_message(self, format, *args):
        return

def https_redirect_server():
    try:
        server = HTTPServer(('0.0.0.0', 443), RedirectHandler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile='cert.pem', keyfile='key.pem')
        server.socket = context.wrap_socket(server.socket, server_side=True)
        print("[+] HTTPS 重定向服务器已启动: https://* -> http://")
        server.serve_forever()
    except Exception as e:
        print(f"[!] HTTPS 重定向服务器失败: {e}")

def check_phone_connection():
    """检测是否有手机连接到热点"""
    print("\n[*] 正在检测连接的手机设备...")
    try:
        if platform.system() == "Windows":
            result = subprocess.check_output('arp -a', shell=True, text=True, encoding='gbk')
            devices = re.findall(r"(\d+\.\d+\.\d+\.\d+)\s+[0-9a-f-]{17}", result)
            
            hotspot_devices = [ip for ip in devices if ip.startswith(HOTSPOT_IP.rsplit('.', 1)[0] + '.')]
            if hotspot_devices:
                print(f"[+] 检测到 {len(hotspot_devices)} 台设备连接到热点:")
                for ip in hotspot_devices:
                    print(f"    - {ip}")
                return True
            else:
                print("[!] 未检测到任何设备连接到热点")
                print("[!] 请确保手机已连接到电脑热点")
                return False
            
    except Exception as e:
        print(f"[!] 设备检测失败: {e}")
        return False


if __name__ == "__main__":
    if platform.system() == "Windows" and not is_admin_windows():
        print("[!] 请以管理员身份运行")
        input("按Enter退出...")
        sys.exit(1)
    
    disable_firewall()
    time.sleep(2)

    if not check_phone_connection():
        print("[!] 未检测到设备，程序将继续运行但可能无法正常工作")

    threading.Thread(target=dns_server, daemon=True).start()
    threading.Thread(target=https_redirect_server, daemon=True).start()
    http_server()
