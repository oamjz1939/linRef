#!/usr/bin/env python3
import json
import os
import re
import sys

# 锚定脚本所在的项目根目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 对编译结果与工程元数据版本号产生影响的目标相对路径
TARGET_FILES = [
    os.path.join("package.json"),
    os.path.join("package-lock.json"),
    os.path.join("src", "utils", "projectArchive.ts")
]


def get_current_version(pkg_path: str) -> str:
    """从 package.json 中读取当前版本号"""
    with open(pkg_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return str(data.get("version", "")).strip()


def update_package_json(rel_path: str, new_version: str) -> bool:
    abs_path = os.path.join(BASE_DIR, rel_path)
    if not os.path.exists(abs_path):
        return False

    with open(abs_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 精准替换顶层的 version 字段
    new_content, count = re.subn(
        r'("version"\s*:\s*)"[^"]+"',
        rf'\g<1>"{new_version}"',
        content,
        count=1
    )

    if count == 0:
        return False

    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    return True


def update_package_lock_json(rel_path: str, new_version: str) -> bool:
    abs_path = os.path.join(BASE_DIR, rel_path)
    if not os.path.exists(abs_path):
        return False

    with open(abs_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 更新根级 version
    data["version"] = new_version

    # 更新 packages[""] 下的 version
    if "packages" in data and "" in data["packages"]:
        data["packages"][""]["version"] = new_version

    with open(abs_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return True


def update_project_archive_ts(rel_path: str, new_version: str) -> bool:
    abs_path = os.path.join(BASE_DIR, rel_path)
    if not os.path.exists(abs_path):
        return False

    with open(abs_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 精准替换 projectArchive.ts 中的 version: 'x.x.x'
    new_content, count = re.subn(
        r"(version\s*:\s*')[^']+(')",
        rf"\g<1>{new_version}\g<2>",
        content,
        count=1
    )

    if count == 0:
        return False

    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    return True


def main() -> None:
    pkg_rel = TARGET_FILES[0]
    pkg_abs = os.path.join(BASE_DIR, pkg_rel)

    if not os.path.exists(pkg_abs):
        print(f"错误: 未找到 {pkg_rel} 文件。")
        sys.exit(1)

    current_version = get_current_version(pkg_abs)

    # 1. 显示当前的版本号和将要修改的文件
    print(f"当前版本号: {current_version}")
    print("将要修改的文件:")
    for rel_path in TARGET_FILES:
        print(f"  - {rel_path}")
    print()

    # 2. 等待用户输入新的版本号
    try:
        new_version = input("请输入新的版本号: ").strip()
    except (KeyboardInterrupt, EOFError):
        print("\n操作已取消。")
        sys.exit(0)

    if not new_version:
        print("版本号不能为空，操作已终止。")
        sys.exit(1)

    if new_version == current_version:
        print("新版本号与当前版本号相同，未做更改。")
        sys.exit(0)

    # 基本 semver 规范校验
    if not re.match(r"^\d+\.\d+\.\d+.*$", new_version):
        print("提示: 输入的版本号不符合常见规范（建议以 数字.数字.数字 开头）。")

    # 3. 逐个文件执行更新
    print()
    results = {}

    results[TARGET_FILES[0]] = update_package_json(TARGET_FILES[0], new_version)
    results[TARGET_FILES[1]] = update_package_lock_json(TARGET_FILES[1], new_version)
    results[TARGET_FILES[2]] = update_project_archive_ts(TARGET_FILES[2], new_version)

    # 4. 显示修改是否成功
    all_success = True
    for file_path, success in results.items():
        status_text = "成功" if success else "失败"
        if not success:
            all_success = False
        print(f"修改 {file_path} ... {status_text}")

    print()
    if all_success:
        print(f"版本号已成功更新为: {new_version}")
    else:
        print("部分文件更新失败，请检查相应文件路径或权限。")
        sys.exit(1)


if __name__ == "__main__":
    main()
