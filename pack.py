import os
import zipfile

# -----------------------------
# 配置
# -----------------------------
source_dir = "News App"       # 要打包的目录
output_zip = "app.app"    # 输出文件名

# -----------------------------
# 打包函数
# -----------------------------
def zip_dir(source_dir, output_zip):
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                abs_file = os.path.join(root, file)
                # 去掉 source_dir 前缀，让 zip 内部路径从根开始
                arcname = os.path.relpath(abs_file, start=source_dir)
                zf.write(abs_file, arcname)
    print(f"打包完成: {output_zip}")

# -----------------------------
# 执行
# -----------------------------
if __name__ == "__main__":
    if not os.path.exists(source_dir):
        print(f"目录不存在: {source_dir}")
    else:
        zip_dir(source_dir, output_zip)
