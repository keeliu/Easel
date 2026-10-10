#!/usr/bin/env bash
#
# Easel 受控运行时引导脚本（一次性、可重复执行、只做显式安装）。
#
# 它做什么：
#   1. 校验系统 Python（>=3.10）与 venv 模块；
#   2. 在工作台插件的运行时目录下建 venv（默认 <包根>/.runtime/venv）；
#   3. 按「技能分组」从 _repo/pyproject.toml 里安装最小依赖集；
#   4. 以可编辑方式安装 Easel 包本身（`easel.openclaw_workspace` 被 video-production 技能引用）；
#   5. 自检：解释器版本、各分组 import、ffmpeg 是否可解析；
#   6. 打印 ffmpeg 的安装命令 —— **不安装**，也不下载任何浏览器（Playwright 单独提示）。
#
# 它不做什么：
#   - 不安装系统包（不用 apt/brew/winget）、不用 sudo；
#   - 不写入 _repo 下任何受版本控制的文件（venv 落在插件的 .runtime/ 里，见 .gitignore）；
#   - 不启动、不注册任何服务：工作台插件只负责探测，安装永远由你显式执行。
#
# 用法：
#   bash scripts/bootstrap-runtime.sh                      # 默认分组：core,easel,image,data,doc,publish
#   bash scripts/bootstrap-runtime.sh --groups core,easel  # 最小安装：只够工作台 + 守卫跑起来
#   bash scripts/bootstrap-runtime.sh --groups all         # 全部技能分组（含 audio/video 重依赖）
#   bash scripts/bootstrap-runtime.sh --list-groups        # 只看分组与依赖，不动磁盘
#   bash scripts/bootstrap-runtime.sh --check              # 只自检当前运行时，不安装
#
# 退出码：0 成功；2 用法错误；3 前置条件不满足（如没有 Python）；4 安装或自检失败。

set -euo pipefail

SHELL_NAME="bootstrap-runtime.sh"

# ---------------------------------------------------------------------------
# 路径解析：脚本既可以随包放在 <包根>/scripts/，也可以放在开发态的 <工作区>/scripts/
# ---------------------------------------------------------------------------

script_dir() {
  local source="${BASH_SOURCE[0]}"
  while [ -L "$source" ]; do
    local target
    target="$(readlink "$source")"
    case "$target" in
      /*) source="$target" ;;
      *) source="$(dirname "$source")/$target" ;;
    esac
  done
  cd "$(dirname "$source")" >/dev/null 2>&1 && pwd
}

SCRIPT_DIR="$(script_dir)"

if [ -f "$SCRIPT_DIR/../package.json" ] && [ -d "$SCRIPT_DIR/../lib" ]; then
  # 随包形态：<包根>/scripts/bootstrap-runtime.sh（install_bundle 之后仍然可用）
  PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  WORKSPACE_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"
else
  # 开发态：<工作区>/scripts/bootstrap-runtime.sh
  WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  # 仓库形态下包在 plugins/easel-workbench；开发工作区形态下仍是 dsh-plugins/easel-workbench
  PACKAGE_DIR=""
  for candidate in "$WORKSPACE_ROOT/plugins/easel-workbench" "$WORKSPACE_ROOT/dsh-plugins/easel-workbench"; do
    if [ -d "$candidate" ]; then PACKAGE_DIR="$candidate"; break; fi
  done
  [ -n "$PACKAGE_DIR" ] || PACKAGE_DIR="$WORKSPACE_ROOT/dsh-plugins/easel-workbench"
fi

RUNTIME_DIR="${EASEL_WORKBENCH_RUNTIME_DIR:-$PACKAGE_DIR/.runtime}"

# 默认 Easel 检出：优先 <工作区>/_repo；直接克隆形态下 <工作区> 本身就是检出。
default_easel_root() {
  if [ -f "$WORKSPACE_ROOT/_repo/pyproject.toml" ]; then
    printf '%s' "$WORKSPACE_ROOT/_repo"
  elif [ -f "$WORKSPACE_ROOT/pyproject.toml" ] && [ -d "$WORKSPACE_ROOT/skills/openclaw" ]; then
    printf '%s' "$WORKSPACE_ROOT"
  else
    printf '%s' "$WORKSPACE_ROOT/_repo"
  fi
}

EASEL_ROOT="${EASEL_ROOT:-$(default_easel_root)}"
BASE_PYTHON="${EASEL_BOOTSTRAP_PYTHON:-}"
GROUP_LIST="core,easel,image,data,doc,publish"
CHECK_ONLY=0
LIST_ONLY=0
DRY_RUN=0
RECREATE=0
SKIP_EASEL_PACKAGE=0
UPGRADE_PIP=1
PIP_INDEX="${PIP_INDEX_URL:-}"

# ---------------------------------------------------------------------------
# 依赖分组：名字 → pip 规格。刻意与 _repo/pyproject.toml 保持同源，
# 只把「一次装全部」拆成「按技能用得到的最小集」。
# ---------------------------------------------------------------------------

# 注意：规格串里**不得出现引号字符**——消费侧（本文件的 install_group）按空格切分 $specs
# 并且不做引号剥离，`'cryptography>=42'` 会被 pip 当成带引号的包名而报
# "Invalid requirement"。包名与版本区间都只用 >=,< 这类字符，无需 shell 引号。
group_specs() {
  case "$1" in
    core)
      # 工作台后端、内容守卫、登录态与排期脚本的最小集。
      echo "fastapi>=0.115,<1 uvicorn>=0.30,<1 sse-starlette>=2.1,<4 httpx>=0.27,<1 pydantic>=2.7,<3 python-multipart>=0.0.9,<1 segno>=1.6,<2 websocket-client>=1.7,<2 cryptography>=42 PyYAML>=6,<7 markdown>=3.5,<4"
      ;;
    image)
      # 图像处理、抠图、插图与封面渲染（skill-image-*、skill-meme、skill-cover）。
      echo "Pillow>=10,<13 opencv-python>=4.8,<5 numpy>=1.26,<3 rembg>=2.0,<3 matplotlib>=3.8,<4"
      ;;
    audio)
      # 配音、混音、节拍与语音转写（skill-voice、skill-audio-*、skill-asr）。
      echo "numpy>=1.26,<3 librosa>=0.10,<1 edge-tts>=6,<8 faster-whisper>=1,<2 onnxruntime>=1.17,<2"
      ;;
    video)
      # 视频剪辑、转场与字幕烧录；ffmpeg 需另行安装（脚本会给命令）。
      echo "opencv-python>=4.8,<5 numpy>=1.26,<3 Pillow>=10,<13"
      ;;
    data)
      # 榜单/数据表分析、词频与情感（skill-data-*、skill-trend）。
      echo "pandas>=2,<4 openpyxl>=3.1,<4 numpy>=1.26,<3 matplotlib>=3.8,<4 jieba>=0.42,<1 snownlp>=0.12,<1"
      ;;
    doc)
      # 文档与网页转换、繁简转换（skill-doc-*、skill-research）。
      echo "pdfplumber>=0.11,<1 PyMuPDF>=1.24,<2 beautifulsoup4>=4.12,<5 zhconv>=1.4,<2 markdown>=3.5,<4"
      ;;
    publish)
      # 浏览器登录与跨平台发布（skill-bili-login、skill-*-publish）。
      echo "playwright>=1.45,<2 biliup>=1,<2 requests>=2.31,<3 urllib3>=2,<3 beautifulsoup4>=4.12,<5"
      ;;
    easel)
      # Easel 包本身：video-production 引用了 easel.openclaw_workspace。
      echo "__EASEL_PACKAGE__"
      ;;
    *)
      return 1
      ;;
  esac
}

ALL_GROUPS="core image audio video data doc publish easel"

group_purpose() {
  case "$1" in
    core) echo "工作台后端 / 内容守卫 / 登录态 / 排期脚本" ;;
    image) echo "图像、抠图、插图、封面" ;;
    audio) echo "配音、混音、语音转写" ;;
    video) echo "视频剪辑与字幕（另需 ffmpeg）" ;;
    data) echo "数据表、词频、情感分析" ;;
    doc) echo "文档 / 网页转换、繁简转换" ;;
    publish) echo "浏览器登录与跨平台发布" ;;
    easel) echo "Easel 包（可编辑安装）" ;;
    *) echo "" ;;
  esac
}

usage() {
  cat <<EOF
$SHELL_NAME — 引导 Easel 的受控 Python 运行时（只做显式安装，不碰系统包）

用法：
  bash scripts/bootstrap-runtime.sh [选项]

选项：
  --groups LIST        要安装的分组，逗号分隔；"all" 表示全部分组
                       可用：$(echo "$ALL_GROUPS" | tr ' ' ',')
                       默认：$GROUP_LIST
  --runtime-dir DIR    venv 所在目录（默认 $RUNTIME_DIR）
  --easel-root DIR     Easel 检出目录（默认 $EASEL_ROOT）
  --python CMD         用来创建 venv 的系统解释器（默认自动探测 python3/python）
  --index-url URL      pip 索引地址（等价于设置 PIP_INDEX_URL）
  --recreate           删除并重建已有 venv
  --no-easel-package   不安装 Easel 包本身（跳过 easel 分组）
  --no-upgrade-pip     不升级 venv 里的 pip
  --check              只自检当前运行时，不安装任何东西
  --list-groups        打印分组与依赖后退出
  --dry-run            打印将要执行的命令，不真正执行
  -h, --help           显示本帮助

示例：
  bash scripts/bootstrap-runtime.sh --list-groups
  bash scripts/bootstrap-runtime.sh --groups core,easel
  bash scripts/bootstrap-runtime.sh --groups all
  bash scripts/bootstrap-runtime.sh --check

环境变量：
  EASEL_WORKBENCH_RUNTIME_DIR  等价于 --runtime-dir
  EASEL_ROOT                   等价于 --easel-root
  EASEL_BOOTSTRAP_PYTHON       等价于 --python
  PIP_INDEX_URL                等价于 --index-url

退出码：
  0  成功（--check 表示全部就绪）
  2  参数错误
  3  找不到可用的 Python 3.10+，或该解释器缺少 venv 模块
  4  依赖安装失败，或自检未通过
EOF
}

log()  { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
warn() { printf '警告：%s\n' "$*" >&2; }
die()  { printf '错误：%s\n' "$1" >&2; exit "${2:-4}"; }

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  [dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

# ---------------------------------------------------------------------------
# 参数解析
# ---------------------------------------------------------------------------

while [ "$#" -gt 0 ]; do
  case "$1" in
    --groups) GROUP_LIST="${2:-}"; shift 2 ;;
    --groups=*) GROUP_LIST="${1#*=}"; shift ;;
    --runtime-dir) RUNTIME_DIR="${2:-}"; shift 2 ;;
    --runtime-dir=*) RUNTIME_DIR="${1#*=}"; shift ;;
    --easel-root) EASEL_ROOT="${2:-}"; shift 2 ;;
    --easel-root=*) EASEL_ROOT="${1#*=}"; shift ;;
    --python) BASE_PYTHON="${2:-}"; shift 2 ;;
    --python=*) BASE_PYTHON="${1#*=}"; shift ;;
    --index-url) PIP_INDEX="${2:-}"; shift 2 ;;
    --index-url=*) PIP_INDEX="${1#*=}"; shift ;;
    --recreate) RECREATE=1; shift ;;
    --no-easel-package) SKIP_EASEL_PACKAGE=1; shift ;;
    --no-upgrade-pip) UPGRADE_PIP=0; shift ;;
    --check) CHECK_ONLY=1; shift ;;
    --list-groups) LIST_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf '未知参数：%s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$LIST_ONLY" -eq 1 ]; then
  log "依赖分组（可用 --groups 组合，逗号分隔）："
  for name in $ALL_GROUPS; do
    printf '\n  %-8s %s\n' "$name" "$(group_purpose "$name")"
    specs="$(group_specs "$name")"
    if [ "$specs" = "__EASEL_PACKAGE__" ]; then
      printf '           pip install -e %s\n' "$EASEL_ROOT"
    else
      printf '           %s\n' "$specs"
    fi
  done
  printf '\n默认分组：%s\n' "core,easel,image,data,doc,publish"
  exit 0
fi

# ---------------------------------------------------------------------------
# 分组解析
# ---------------------------------------------------------------------------

if [ "$GROUP_LIST" = "all" ]; then
  GROUP_LIST="core,image,audio,video,data,doc,publish,easel"
fi
if [ -z "$GROUP_LIST" ]; then
  printf '错误：--groups 不能为空（用 "all" 表示全部分组）\n' >&2
  exit 2
fi

SELECTED=""
INSTALL_EASEL_PACKAGE=0
IFS=',' read -r -a _requested <<<"$GROUP_LIST"
for raw in "${_requested[@]}"; do
  name="$(printf '%s' "$raw" | tr -d '[:space:]')"
  [ -z "$name" ] && continue
  if ! group_specs "$name" >/dev/null; then
    printf '错误：未知分组 "%s"（可用：%s）\n' "$name" "$(echo "$ALL_GROUPS" | tr ' ' ',')" >&2
    exit 2
  fi
  case " $SELECTED " in *" $name "*) continue ;; esac
  if [ "$name" = "easel" ] && [ "$SKIP_EASEL_PACKAGE" -eq 1 ]; then
    warn "--no-easel-package 生效，已忽略 easel 分组。"
    continue
  fi
  SELECTED="$SELECTED $name"
done
SELECTED="${SELECTED# }"

# ---------------------------------------------------------------------------
# 前置条件：Easel 检出、Python
# ---------------------------------------------------------------------------

step "检查前置条件"

if [ ! -d "$EASEL_ROOT" ]; then
  die "找不到 Easel 检出目录：$EASEL_ROOT
   工作区形态下它应当是 <工作区>/_repo；直接用 --easel-root 指定实际路径。" 3
fi
if [ ! -f "$EASEL_ROOT/pyproject.toml" ]; then
  die "$EASEL_ROOT 里没有 pyproject.toml，看起来不是 Easel 检出。" 3
fi
if [ ! -d "$EASEL_ROOT/skills/openclaw" ]; then
  warn "$EASEL_ROOT/skills/openclaw 不存在：技能脚本将不在技能目录中。"
fi
log "  Easel 检出：$EASEL_ROOT"
log "  运行时目录：$RUNTIME_DIR"

PY_OK='import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'

find_python() {
  if [ -n "$BASE_PYTHON" ]; then
    if command -v "$BASE_PYTHON" >/dev/null 2>&1; then
      printf '%s' "$BASE_PYTHON"
      return 0
    fi
    die "找不到 --python 指定的解释器：$BASE_PYTHON" 3
  fi
  # 稳定别名优先，其次带版本号的解释器（有些环境只提供 python3.12 这类名字，
  # 且与 lib/host/runtime.js 的 PYTHON_NAMES + PYTHON_VERSIONED_NAMES 保持一致）。
  for candidate in python3 python python3.13 python3.12 python3.11 python3.10; do
    if command -v "$candidate" >/dev/null 2>&1 &&
       "$candidate" -c "$PY_OK" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

venv_python() {
  # 插件按 <runtimeDir>/venv/bin/python 探测（POSIX）；Windows 走 Scripts\python.exe。
  if [ -x "$RUNTIME_DIR/venv/bin/python" ]; then
    printf '%s' "$RUNTIME_DIR/venv/bin/python"
  elif [ -x "$RUNTIME_DIR/venv/Scripts/python.exe" ]; then
    printf '%s' "$RUNTIME_DIR/venv/Scripts/python.exe"
  else
    printf '%s' "$RUNTIME_DIR/venv/bin/python"
  fi
}

VENV_PY="$(venv_python)"

print_ffmpeg_hint() {
  step "ffmpeg（本脚本不安装，只给命令）"
  if command -v ffmpeg >/dev/null 2>&1; then
    log "  已找到：$(command -v ffmpeg)"
    log "  版本：$(ffmpeg -version 2>/dev/null | head -n 1 || echo '（无法读取版本）')"
    return 0
  fi
  if [ -x "$RUNTIME_DIR/ffmpeg/bin/ffmpeg" ]; then
    log "  已找到受控副本：$RUNTIME_DIR/ffmpeg/bin/ffmpeg"
    return 0
  fi
  cat <<EOF
  未找到 ffmpeg。音视频技能需要它，其余功能不受影响。按系统选一条执行：

    Debian / Ubuntu   sudo apt-get update && sudo apt-get install -y ffmpeg
    Fedora / RHEL     sudo dnf install -y ffmpeg
    Arch              sudo pacman -S ffmpeg
    macOS (Homebrew)  brew install ffmpeg
    Windows           winget install --id Gyan.FFmpeg -e

  装完后重新运行本脚本（或 --check）确认探测结果；也可以用插件配置
  ffmpegExecutable 直接指向一个静态包里的 ffmpeg 可执行文件。
EOF
}

verify() {
  step "自检"
  local failed=0

  if [ ! -x "$VENV_PY" ] && [ ! -f "$VENV_PY" ]; then
    warn "venv 解释器不存在：$VENV_PY"
    failed=1
  else
    local version
    version="$("$VENV_PY" --version 2>&1 || true)"
    log "  解释器：$VENV_PY（${version:-版本未知}）"
    if ! "$VENV_PY" -c "$PY_OK" >/dev/null 2>&1; then
      warn "venv 解释器版本低于 3.10：$version"
      failed=1
    fi

    local checks="fastapi"
    case " $SELECTED " in
      *" image "*) checks="$checks:PIL" ;;
    esac
    case " $SELECTED " in
      *" image "*) checks="$checks:cv2" ;;
    esac
    case " $SELECTED " in
      *" data "*) checks="$checks:pandas" ;;
    esac
    case " $SELECTED " in
      *" audio "*) checks="$checks:librosa" ;;
    esac
    case " $SELECTED " in
      *" doc "*) checks="$checks:fitz" ;;
    esac
    case " $SELECTED " in
      *" publish "*) checks="$checks:playwright" ;;
    esac
    case " $SELECTED " in
      *" easel "*) checks="$checks:easel.openclaw_workspace" ;;
    esac

    IFS=':' read -r -a _modules <<<"$checks"
    for module in "${_modules[@]}"; do
      [ -z "$module" ] && continue
      if "$VENV_PY" -c "import $module" >/dev/null 2>&1; then
        log "  import $module：ok"
      else
        warn "import $module：失败（该组技能会因此不可用，可重跑本脚本）"
        failed=1
      fi
    done
  fi

  print_ffmpeg_hint

  step "把运行时告诉工作台插件"
  cat <<EOF
  在插件的 Config 里显式固定解释器（留空则按 <运行时目录>/venv 与 PATH 探测）：

    pythonExecutable: $VENV_PY
    ffmpegExecutable: $RUNTIME_DIR/ffmpeg/bin/ffmpeg   # 可选；走 PATH 时留空

  工作台「环境自检」区域会显示相同结论；缺失项只影响对应技能，面板其余部分照常可用。
EOF

  return "$failed"
}

if [ "$CHECK_ONLY" -eq 1 ]; then
  verify || exit 4
  exit 0
fi

BASE_PYTHON="$(find_python)" || die "找不到可用的 Python 3.10+。
  安装后重试：Debian/Ubuntu 用 sudo apt-get install -y python3 python3-venv；
  macOS 用 brew install python；Windows 用 winget install --id Python.Python.3.12 -e。
  也可以用 --python 指定解释器路径。" 3
log "  系统解释器：$(command -v "$BASE_PYTHON")"

if ! "$BASE_PYTHON" -c 'import venv' >/dev/null 2>&1; then
  die "系统 Python 缺少 venv 模块。
    Debian/Ubuntu 通常需要：sudo apt-get install -y python3-venv" 3
fi

# ---------------------------------------------------------------------------
# 建 venv
# ---------------------------------------------------------------------------

step "准备 venv"

if [ "$RECREATE" -eq 1 ] && [ -d "$RUNTIME_DIR/venv" ]; then
  log "  --recreate：移除已有 venv（$RUNTIME_DIR/venv）"
  run rm -rf "$RUNTIME_DIR/venv"
fi

run mkdir -p "$RUNTIME_DIR"

if [ -x "$VENV_PY" ]; then
  log "  复用已有 venv：$VENV_PY"
else
  log "  创建 venv：$RUNTIME_DIR/venv"
  run "$BASE_PYTHON" -m venv "$RUNTIME_DIR/venv"
fi

if [ "$DRY_RUN" -eq 0 ] && [ ! -x "$VENV_PY" ]; then
  die "venv 创建后仍找不到解释器：$VENV_PY" 4
fi

PIP_ARGS=(--disable-pip-version-check --retries 5 --timeout 30)
if [ -n "$PIP_INDEX" ]; then
  PIP_ARGS+=(--index-url "$PIP_INDEX")
fi

if [ "$UPGRADE_PIP" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
  log "  升级 pip"
  "$VENV_PY" -m pip install --quiet "${PIP_ARGS[@]}" --upgrade pip ||
    warn "pip 升级失败，继续用现有版本安装。"
fi

# ---------------------------------------------------------------------------
# 按分组安装
# ---------------------------------------------------------------------------

install_group() {
  local name="$1"
  local specs
  specs="$(group_specs "$name")"
  if [ "$specs" = "__EASEL_PACKAGE__" ]; then
    step "安装分组 easel（可编辑安装 $EASEL_ROOT）"
    run "$VENV_PY" -m pip install "${PIP_ARGS[@]}" -e "$EASEL_ROOT"
    return 0
  fi
  step "安装分组 $name（$(group_purpose "$name")）"
  # 规格串只做空格分词（$specs 未加引号），**不做引号剥离**：所以 group_specs
  # 返回的串里不能出现引号字符，否则 pip 会收到 "'cryptography>=42'" 这种带引号的包名。
  # shellcheck disable=SC2086
  run "$VENV_PY" -m pip install "${PIP_ARGS[@]}" $specs
}

if [ -z "$SELECTED" ]; then
  warn "没有任何分组被选中（可能全部被 --no-easel-package 过滤），只做自检。"
else
  log "  本次分组：$SELECTED"
  for name in $SELECTED; do
    install_group "$name" || die "分组 $name 安装失败。可单独重试：bash scripts/bootstrap-runtime.sh --groups $name" 4
  done
fi

case " $SELECTED " in
  *" publish "*)
    step "Playwright 浏览器（另行显式安装）"
    log "  发布类技能需要 Chromium；需要时执行："
    log "    $VENV_PY -m playwright install chromium"
    log "  本脚本不自动下载浏览器（体积大、且属于额外网络行为）。"
    ;;
esac

if [ "$DRY_RUN" -eq 1 ]; then
  # dry-run 什么都没装，自检必然失败——跳过它，让 --dry-run 只负责「预演」。
  step "自检（--dry-run 跳过）"
  log "  没有实际安装任何依赖，因此跳过 import 自检。"
else
  verify || exit 4
fi
log ""
log "引导完成。重复执行本脚本是安全的（幂等）：已有 venv 与已装依赖都会被复用。"
