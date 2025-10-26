from http.server import HTTPServer, SimpleHTTPRequestHandler
class CORSRequestHandler(SimpleHTTPRequestHandler):
   def end_headers(self):
       self.send_header('Access-Control-Allow-Origin', '*')
       self.send_header('Access-Control-Allow-Methods', '*')
       self.send_header('Access-Control-Allow-Headers', '*')
       super().end_headers()
   def do_OPTIONS(self):
       self.send_response(200)
       self.end_headers()
if __name__ == '__main__':
   httpd = HTTPServer(('localhost', 80), CORSRequestHandler)
   print("Serving on port 80...")
   httpd.serve_forever()