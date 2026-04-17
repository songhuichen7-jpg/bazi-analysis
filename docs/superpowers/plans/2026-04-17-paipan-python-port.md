# Paipan Python Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 Node.js 的 `paipan-engine/` 完整 port 到独立 Python 包 `paipan/`，输出与 Node 版逐字段一致（oracle-driven 回归测试驱动），为后续 FastAPI 后端重写铺路。

**Architecture:** Node 版作为 oracle（只读源），Python 版通过 `lunar-python`（与 `lunar-javascript` 同作者 6tail 出品的姊妹库）实现核心干支算法，应用层逻辑字面翻译；每个模块单元测试独立，全流程通过 300+ JSON fixture 回归对拍；验收标准是所有 fixture 零 diff，任何不一致必须修完才能合并。

**Tech Stack:** Python 3.12 · uv（workspace）· pytest · Pydantic v2 · `lunar-python` · `cryptography`（后续 server 用，本 plan 不涉及）· Node.js（仅用来跑 oracle dump 脚本）

---

## 设计约束（每一 task 必须遵守）

1. **不读 lunar-javascript 源码**去"对齐"算法——信任 `lunar-python` 作者，两个库本就同源
2. **不重写**算法——Node 版怎么写，Python 就怎么翻，即便看上去可优化
3. **不改字段名**——即便 `rizhu` 想改成 `day_pillar` 更好；改名单独立项
4. **Magic number 必须保留** + 加 `# NOTE: paipan.js:LINE` 注释指向来源
5. **每个 task 必须 commit** 并且 CI 绿（`uv run pytest` 通过）
6. **TDD**：fixture 先行，实现补上，红 → 绿 → 提交
7. **发现 Node 版 bug 不修**——port 阶段绝对尊重 oracle；Node 版 bug 在 port 合并后单独立项

## 目录最终形态（plan 执行完的样子）

```
bazi-analysis/
├── pyproject.toml              # uv workspace 根
├── uv.lock
├── paipan/                     # ← 本 plan 产出
│   ├── pyproject.toml
│   ├── README.md
│   ├── paipan/
│   │   ├── __init__.py
│   │   ├── constants.py
│   │   ├── types.py
│   │   ├── cities.py
│   │   ├── solar_time.py
│   │   ├── china_dst.py
│   │   ├── zi_hour.py
│   │   ├── ganzhi.py
│   │   ├── shi_shen.py
│   │   ├── cang_gan.py
│   │   ├── force.py
│   │   ├── ge_ju.py
│   │   ├── dayun.py
│   │   ├── ui.py
│   │   └── compute.py
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py
│       ├── unit/
│       │   ├── test_cities.py
│       │   ├── test_solar_time.py
│       │   ├── test_china_dst.py
│       │   ├── test_zi_hour.py
│       │   ├── test_ganzhi.py
│       │   ├── test_shi_shen.py
│       │   ├── test_cang_gan.py
│       │   ├── test_force.py
│       │   ├── test_ge_ju.py
│       │   └── test_dayun.py
│       └── regression/
│           ├── __init__.py
│           ├── deep_diff.py
│           ├── test_regression.py
│           ├── birth_inputs.json        # 300+ 条生成语料
│           ├── fixtures/                # 300+ .json（oracle 输出）
│           └── generate_oracle.md
└── paipan-engine/
    └── scripts/
        └── dump-oracle.js               # 一次性脚本；运行完可删
```

---

## Phase A：工具与基础设施（Week 1，8 tasks）

### Task 1: uv workspace + paipan 骨架

**Files:**
- Create: `pyproject.toml`（repo 根）
- Create: `paipan/pyproject.toml`
- Create: `paipan/paipan/__init__.py`
- Create: `paipan/paipan/constants.py`
- Create: `paipan/README.md`

- [ ] **Step 1: 创建根 workspace 声明**

写 `pyproject.toml`：
```toml
[tool.uv.workspace]
members = ["paipan"]
```

- [ ] **Step 2: 创建 paipan 子包 `pyproject.toml`**

写 `paipan/pyproject.toml`：
```toml
[project]
name = "paipan"
version = "0.1.0"
description = "BaZi paipan engine (Python port)"
requires-python = ">=3.12"
dependencies = [
    "lunar-python>=1.3.9",
    "pydantic>=2.6.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-xdist>=3.5",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["paipan"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra --strict-markers"
```

- [ ] **Step 3: 写版本常量 + 空 `__init__.py`**

写 `paipan/paipan/constants.py`：
```python
VERSION = "0.1.0"
```

写 `paipan/paipan/__init__.py`：
```python
from paipan.constants import VERSION

__all__ = ["VERSION"]
```

- [ ] **Step 4: 同步依赖并验证包可导入**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis
uv sync --package paipan
uv run --package paipan python -c "import paipan; print(paipan.VERSION)"
```
Expected output: `0.1.0`

- [ ] **Step 5: 写 README 骨架**

写 `paipan/README.md`：
```markdown
# paipan

Python port of the Node.js paipan-engine (BaZi chart computation).

## Usage

```python
from paipan import compute, BirthInput
result = compute(BirthInput(year=1990, month=5, day=15, hour=10, minute=30,
                            city="北京", gender="male"))
```

## Testing

```bash
uv run pytest paipan/tests/
```

Regression tests are oracle-driven: outputs must match the Node.js reference
implementation in `../paipan-engine/` byte-for-byte (floats within 1e-9).

See `tests/regression/generate_oracle.md` for how to regenerate oracle fixtures.
```

- [ ] **Step 6: 提交**

```bash
cd /Users/veko/code/usual/bazi-analysis
# 项目不是 git 仓库（见 spec 确认）。此 plan 的所有 commit 步骤都走
# 先初始化一次：
git init 2>/dev/null || true
git add pyproject.toml paipan/pyproject.toml paipan/paipan/__init__.py \
        paipan/paipan/constants.py paipan/README.md
git commit -m "feat(paipan): bootstrap Python package + uv workspace"
```
Expected: 首次初始化会有 `hint: Using ...` 提示；commit 成功。

---

### Task 2: pytest 基础设施 + 冒烟测试 + .gitignore

**Files:**
- Create: `paipan/tests/__init__.py`
- Create: `paipan/tests/conftest.py`
- Create: `paipan/tests/unit/__init__.py`
- Create: `paipan/tests/unit/test_smoke.py`
- Modify: `/Users/veko/code/usual/bazi-analysis/.gitignore`（加 Python 构建产物忽略）

- [ ] **Step 0: 补 Python 相关 .gitignore 条目**（来自 Task 1 code review 建议）

项目根 `.gitignore` 当前只覆盖 Node / macOS / `.gstack/`。在**文件末尾追加**（不删任何已有行）：
```
# Python
__pycache__/
*.py[cod]
*$py.class
.pytest_cache/
.venv/
*.egg-info/
dist/
build/
```

**注意**：根目录 `uv.lock` 必须提交（不要加进 .gitignore），workspace 不产出 per-member lockfile。

- [ ] **Step 1: 写冒烟测试（红）**

写 `paipan/tests/unit/test_smoke.py`：
```python
from paipan import VERSION

def test_version_exported():
    assert isinstance(VERSION, str)
    assert VERSION.count(".") == 2
```

写空 `paipan/tests/__init__.py`、`paipan/tests/unit/__init__.py`。

写最小 `paipan/tests/conftest.py`：
```python
# pytest fixtures 共享。当前空。
```

- [ ] **Step 2: 运行测试**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis
uv run --package paipan pytest paipan/tests/unit/test_smoke.py -v
```
Expected: `1 passed`

- [ ] **Step 3: 提交**

```bash
git add .gitignore paipan/tests/
git commit -m "test(paipan): smoke test scaffold + python gitignore"
```

---

### Task 3: 盘点 Node paipan-engine（产出 inventory 文档）

**Files:**
- Create: `paipan/tests/regression/generate_oracle.md`
- Create: `docs/paipan-port-inventory.md`

这一步不写代码，产出 **指导后续 port 的参照文档**。读 Node 源码，把每个文件的职责、输入输出、已知 edge case 手动列出来。

- [ ] **Step 1: 列出 Node 仓库文件清单**

Run:
```bash
find /Users/veko/code/usual/bazi-analysis/paipan-engine/src -type f -name '*.js' | sort
```
Expected: 列出 11 个 .js 文件（`src/*.js` 和 `src/ming/*.js`）。

- [ ] **Step 2: 写 inventory 文档**

写 `docs/paipan-port-inventory.md`，内容**必须**手动从 Node 源码里读出来（不能跳步）：

```markdown
# paipan-engine Node 版盘点（port 参照）

> 本文是 Python port 的参照底本。每个文件只读了 Node 源码再填写，不是猜测。
> Node 版**冻结**于 tag `paipan-engine-oracle-v1`。

## 入口 / 编排

### `src/paipan.js`（core orchestrator）
**输出结构**（对标下面 `types.py::PaipanResult`）：
- `sizhu: { year, month, day, hour }` — 四柱字符串（例 "癸巳"）
- `rizhu: string` — 日干（例 "丁"）
- `shishen: { year, month, hour }` — 每柱天干对日主的十神
- `cangGan: { year, month, day, hour }` — 每柱地支藏干（string[]）
- `naYin: { year, month, day, hour }` — 每柱纳音
- `dayun: { startSolar, startAge, startYearsDesc, list: DayunEntry[] }`
- `lunar`, `solarCorrected`, `warnings`, `meta`, `hourUnknown`
- `todayYearGz`, `todayMonthGz`, `todayDayGz`, `todayYmd`

**管线顺序**：
1. DST 修正（`correctChinaDst`）
2. 真太阳时修正（`toTrueSolarTime`，`city` → `longitude`）
3. 子时派转换（`convertToLateZiConvention`，仅 `ziConvention='late'`）
4. 节气交界检查（`checkJieqiBoundary`，只产警告）
5. lunar-javascript `Solar.fromYmdHms` → `getLunar().getEightChar()`
6. 从 EightChar 取四柱、十神、藏干、纳音
7. 从 `EightChar.getYun(male ? 1 : 0)` 取大运
8. 流年来自 `DaYun.getLiuNian()`

### `src/solarTime.js`
- `toTrueSolarTime(y, m, d, h, mi, longitude)` → `{ year, month, day, hour, minute, longitudeMinutes, eotMinutes, shiftMinutes }`
- 依赖：无外部库
- 算法要点：经度每偏 15° = 1 小时；公式 EoT 修正

### `src/chinaDst.js`
- `correctChinaDst(y, m, d, h, mi)` → `{ wasDst, year, month, day, hour, minute }`
- 中国 DST 表：仅 1986-05-04 至 1991-09-15 的夏季启用
- 处在 DST 区间 → 减 1 小时

### `src/ziHourAndJieqi.js`
- `convertToLateZiConvention(y, m, d, h, mi)` → 23:00-23:59 推到下一天 0:00
- `checkJieqiBoundary(y, m, d, h, mi)` → 返回 `{ isNearBoundary, hint }`（仅警告，不改时间）
- 依赖 `lunar-javascript` 的节气表

### `src/cities.js`
- `getCityCoords(name)` → `{ lng, lat, canonical } | null`
- 数据源：`cities-data.json`（175KB 左右的城市列表）

## 解读层（`src/ming/*`）——**main paipan.js 不直接调用**，由 server.js 或其他模块使用

### `src/ming/ganzhi.js`
- 干支常量表 + 查找函数：`GAN`, `ZHI`, `GAN_WUXING`, `ZHI_WUXING`, `GAN_YIN_YANG` 等

### `src/ming/shishen.js`
- 主函数：`getShiShen(dayGan, otherGan)` → 十神名称（比肩/劫财/食神/伤官/正财/偏财/正官/七杀/正印/偏印）
- 注意：**main paipan.js 走的是 lunar-javascript 的 `getYearShiShenGan()` 等方法**。`ming/shishen.js` 存在是为 server 侧的解读逻辑。

### `src/ming/cangGan.js`
- 地支藏干表（主气 / 中气 / 余气）
- `getCangGan(zhi)` → `{ main, middle?, residual? }`

### `src/ming/liLiang.js`
- 力量计算：十神力量积分
- 这个是**应用层启发式**，没有统一标准——字面翻译

### `src/ming/geJu.js`
- 格局判断（正官格、七杀格、从格、化气格、专旺格）

### `src/ming/heKe.js`
- 天干地支合冲刑害表

### `src/ming/analyze.js`
- 解读结果组装层（由 server 调用）

## 已知 Edge Case（port 时必须覆盖）

1. **早晚子时派**（`ziConvention: 'early' | 'late'`）—— 决定 23:00-23:59 的日柱/时柱
2. **节气切换那一分钟**——立春 04:58 生 vs 04:59 生的年/月柱不同
3. **中国 DST 1986-1991**——`chinaDst.js` 表的精确日期范围
4. **真太阳时负数偏移**（东经 > 120°）
5. **跨日子时的日柱**——`lunar-javascript` 已处理，对拍看 `EightChar.setSect()`
6. **闰月月柱**——lunar-javascript 处理方式
7. **起运年龄 float**——Node 用 `startYear + startMonth/12 + startDay/365`
8. **顺逆行大运**——`getYun(gender === 'male' ? 1 : 0)` 内部处理
9. **藏干余气**——`getZhiCangGan()` 返回的顺序
10. **天干合化**——`heKe.js` 表
```

- [ ] **Step 3: 写 oracle 生成说明**

写 `paipan/tests/regression/generate_oracle.md`：
```markdown
# 如何生成 Oracle Fixtures

Oracle = Node.js paipan-engine 的输出，作为 Python port 的"真值"。

## 一次性生成

```bash
cd /Users/veko/code/usual/bazi-analysis/paipan-engine
npm install  # 若未装
node scripts/dump-oracle.js \
  ../paipan/tests/regression/birth_inputs.json \
  ../paipan/tests/regression/fixtures/
```

## 冻结规则

Oracle 一旦生成**不再改**。如发现 Node 版 bug：
- 不修 Node 版
- 在 Python port 里也照搬这个 bug（为保证 byte-exact）
- 单独立项修"paipan 算法修正"——同时更新 Node 和 Python 版 + 重跑 oracle

Node 版将打 tag `paipan-engine-oracle-v1` 并归档到 `archive/paipan-engine/`。
```

- [ ] **Step 4: 提交**

```bash
git add docs/paipan-port-inventory.md paipan/tests/regression/generate_oracle.md
git commit -m "docs(paipan): port inventory + oracle generation guide"
```

---

### Task 4: Node oracle dump 脚本（一次性工具）

**Files:**
- Create: `paipan-engine/scripts/dump-oracle.js`

- [ ] **Step 1: 写 dump 脚本**

写 `paipan-engine/scripts/dump-oracle.js`：
```javascript
#!/usr/bin/env node
/**
 * 一次性工具：读 birth_inputs.json（数组），逐条调 paipan()，
 * 把结果写到 fixtures/<case_id>.json。
 */
const fs = require('fs');
const path = require('path');
const { paipan } = require('../src/paipan');

function dieUsage() {
  console.error('Usage: node dump-oracle.js <birth_inputs.json> <out-dir>');
  process.exit(2);
}

const [, , inputsPath, outDir] = process.argv;
if (!inputsPath || !outDir) dieUsage();

const inputs = JSON.parse(fs.readFileSync(inputsPath, 'utf8'));
if (!Array.isArray(inputs)) {
  console.error('birth_inputs.json 必须是数组');
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });

let ok = 0, fail = 0;
for (const item of inputs) {
  const { case_id, birth_input } = item;
  if (!case_id || !birth_input) {
    console.error('missing case_id or birth_input:', item);
    fail++; continue;
  }
  try {
    // todayYearGz 等字段依赖 "今天"——确定性地冻结成 2026-04-17 12:00:00
    // 做法：mock Date 为固定时间
    const RealDate = Date;
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) return new RealDate('2026-04-17T12:00:00+08:00');
        return new RealDate(...args);
      }
      static now() { return new RealDate('2026-04-17T12:00:00+08:00').getTime(); }
    };
    const expected = paipan(birth_input);
    global.Date = RealDate;

    const outPath = path.join(outDir, `${case_id}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ case_id, birth_input, expected }, null, 2));
    ok++;
  } catch (e) {
    console.error(`FAIL ${case_id}:`, e.message);
    fail++;
  }
}

console.log(`\nDone: ${ok} ok, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 临时验证脚本能跑（用 2 条测试输入）**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis/paipan-engine
mkdir -p scripts
# 已在 Step 1 写了脚本

# 临时 inputs
cat > /tmp/oracle-smoke.json <<'EOF'
[
  {"case_id": "smoke-001", "birth_input": {"year": 1990, "month": 5, "day": 15, "hour": 10, "minute": 30, "city": "北京", "gender": "male", "useTrueSolarTime": true}},
  {"case_id": "smoke-002", "birth_input": {"year": 1988, "month": 7, "day": 15, "hour": 10, "minute": 0, "city": "北京", "gender": "male", "useTrueSolarTime": true}}
]
EOF

mkdir -p /tmp/oracle-smoke-out
npm install
node scripts/dump-oracle.js /tmp/oracle-smoke.json /tmp/oracle-smoke-out
ls /tmp/oracle-smoke-out/
cat /tmp/oracle-smoke-out/smoke-001.json | head -30
```
Expected: 输出 `Done: 2 ok, 0 failed.`；目录下有 `smoke-001.json` 和 `smoke-002.json`，内容包含 `case_id`、`birth_input`、`expected`（含 `sizhu`、`dayun` 等）。

清理：
```bash
rm -rf /tmp/oracle-smoke.json /tmp/oracle-smoke-out
```

- [ ] **Step 3: 提交**

```bash
git add paipan-engine/scripts/dump-oracle.js
git commit -m "tooling(paipan): oracle dump script for Node → JSON fixtures"
```

---

### Task 5: 初始 birth_inputs.json（50 条，分类覆盖）

**Files:**
- Create: `paipan/tests/regression/birth_inputs.json`

**最终目标 300+ 条；本 task 先写 50 条覆盖主要 edge case，剩下在 Task 22 扩展。**

- [ ] **Step 1: 写 50 条初始输入**

写 `paipan/tests/regression/birth_inputs.json`——每条都有 `case_id` 和 `birth_input`；`case_id` 命名规范：`{category}-{nnn}-{描述}`。

```json
[
  {"case_id": "basic-001-1990-05-15-beijing-male-truesolar",
   "birth_input": {"year":1990,"month":5,"day":15,"hour":10,"minute":30,"city":"北京","gender":"male","useTrueSolarTime":true}},
  {"case_id": "basic-002-1995-06-15-shanghai-male-truesolar",
   "birth_input": {"year":1995,"month":6,"day":15,"hour":14,"minute":30,"city":"上海","gender":"male","useTrueSolarTime":true}},
  {"case_id": "basic-003-1993-12-26-shaoshan-male-truesolar",
   "birth_input": {"year":1893,"month":12,"day":26,"hour":8,"minute":0,"city":"韶山","gender":"male","useTrueSolarTime":true}},
  {"case_id": "basic-004-1980-02-10-guangzhou-female-truesolar",
   "birth_input": {"year":1980,"month":2,"day":10,"hour":15,"minute":0,"city":"广州","gender":"female","useTrueSolarTime":true}},
  {"case_id": "basic-005-2000-08-08-beijing-male-no-truesolar",
   "birth_input": {"year":2000,"month":8,"day":8,"hour":8,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":false}},

  {"case_id": "jieqi-001-2024-02-04-1627-boundary",
   "birth_input": {"year":2024,"month":2,"day":4,"hour":16,"minute":27,"city":"北京","gender":"female","useTrueSolarTime":false}},
  {"case_id": "jieqi-002-2024-02-04-1620-before",
   "birth_input": {"year":2024,"month":2,"day":4,"hour":16,"minute":20,"city":"北京","gender":"female","useTrueSolarTime":false}},
  {"case_id": "jieqi-003-2024-02-04-1635-after",
   "birth_input": {"year":2024,"month":2,"day":4,"hour":16,"minute":35,"city":"北京","gender":"female","useTrueSolarTime":false}},
  {"case_id": "jieqi-004-lichun-2020",
   "birth_input": {"year":2020,"month":2,"day":4,"hour":17,"minute":3,"city":"北京","gender":"male","useTrueSolarTime":false}},
  {"case_id": "jieqi-005-jingzhe-2023",
   "birth_input": {"year":2023,"month":3,"day":6,"hour":4,"minute":36,"city":"北京","gender":"female","useTrueSolarTime":false}},

  {"case_id": "zi-001-2024-03-15-2330-early",
   "birth_input": {"year":2024,"month":3,"day":15,"hour":23,"minute":30,"city":"北京","gender":"male","ziConvention":"early","useTrueSolarTime":false}},
  {"case_id": "zi-002-2024-03-15-2330-late",
   "birth_input": {"year":2024,"month":3,"day":15,"hour":23,"minute":30,"city":"北京","gender":"male","ziConvention":"late","useTrueSolarTime":false}},
  {"case_id": "zi-003-2024-03-16-0030-early",
   "birth_input": {"year":2024,"month":3,"day":16,"hour":0,"minute":30,"city":"北京","gender":"male","ziConvention":"early","useTrueSolarTime":false}},
  {"case_id": "zi-004-2024-03-16-0030-late",
   "birth_input": {"year":2024,"month":3,"day":16,"hour":0,"minute":30,"city":"北京","gender":"male","ziConvention":"late","useTrueSolarTime":false}},
  {"case_id": "zi-005-2024-03-15-2359-early",
   "birth_input": {"year":2024,"month":3,"day":15,"hour":23,"minute":59,"city":"北京","gender":"male","ziConvention":"early","useTrueSolarTime":false}},

  {"case_id": "dst-001-1988-07-15-beijing-male",
   "birth_input": {"year":1988,"month":7,"day":15,"hour":10,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":true}},
  {"case_id": "dst-002-1989-08-20-shanghai-female",
   "birth_input": {"year":1989,"month":8,"day":20,"hour":14,"minute":0,"city":"上海","gender":"female","useTrueSolarTime":true}},
  {"case_id": "dst-003-1991-09-14-beijing-just-before-end",
   "birth_input": {"year":1991,"month":9,"day":14,"hour":12,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":true}},
  {"case_id": "dst-004-1986-05-04-entry-day",
   "birth_input": {"year":1986,"month":5,"day":4,"hour":3,"minute":0,"city":"北京","gender":"female","useTrueSolarTime":true}},
  {"case_id": "dst-005-1987-outside-summer",
   "birth_input": {"year":1987,"month":12,"day":15,"hour":8,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":true}},

  {"case_id": "tz-001-urumqi-western",
   "birth_input": {"year":1985,"month":6,"day":15,"hour":10,"minute":0,"city":"乌鲁木齐","gender":"male","useTrueSolarTime":true}},
  {"case_id": "tz-002-kashgar-extreme-west",
   "birth_input": {"year":1992,"month":4,"day":1,"hour":9,"minute":0,"city":"喀什","gender":"female","useTrueSolarTime":true}},
  {"case_id": "tz-003-lhasa",
   "birth_input": {"year":1998,"month":7,"day":1,"hour":12,"minute":0,"city":"拉萨","gender":"male","useTrueSolarTime":true}},
  {"case_id": "tz-004-xining",
   "birth_input": {"year":2001,"month":10,"day":20,"hour":7,"minute":30,"city":"西宁","gender":"female","useTrueSolarTime":true}},
  {"case_id": "tz-005-harbin-east",
   "birth_input": {"year":1993,"month":1,"day":5,"hour":6,"minute":0,"city":"哈尔滨","gender":"male","useTrueSolarTime":true}},

  {"case_id": "female-001-1997-03-08-beijing",
   "birth_input": {"year":1997,"month":3,"day":8,"hour":9,"minute":0,"city":"北京","gender":"female","useTrueSolarTime":true}},
  {"case_id": "female-002-2005-09-10-chengdu",
   "birth_input": {"year":2005,"month":9,"day":10,"hour":20,"minute":15,"city":"成都","gender":"female","useTrueSolarTime":true}},
  {"case_id": "female-003-1975-11-22-xian",
   "birth_input": {"year":1975,"month":11,"day":22,"hour":23,"minute":45,"city":"西安","gender":"female","useTrueSolarTime":true}},
  {"case_id": "male-001-1970-04-01-shenzhen",
   "birth_input": {"year":1970,"month":4,"day":1,"hour":4,"minute":15,"city":"深圳","gender":"male","useTrueSolarTime":true}},
  {"case_id": "male-002-1950-01-01-beijing",
   "birth_input": {"year":1950,"month":1,"day":1,"hour":0,"minute":5,"city":"北京","gender":"male","useTrueSolarTime":true}},

  {"case_id": "hour-unknown-001",
   "birth_input": {"year":1990,"month":5,"day":15,"hour":-1,"minute":0,"city":"上海","gender":"female","useTrueSolarTime":true}},
  {"case_id": "hour-unknown-002",
   "birth_input": {"year":1985,"month":12,"day":25,"hour":-1,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":false}},

  {"case_id": "city-unknown-001",
   "birth_input": {"year":1995,"month":6,"day":15,"hour":10,"minute":0,"city":"某小县城","gender":"male","useTrueSolarTime":true}},
  {"case_id": "city-provided-lng-001",
   "birth_input": {"year":1995,"month":6,"day":15,"hour":10,"minute":0,"longitude":121.47,"gender":"male","useTrueSolarTime":true}},

  {"case_id": "leap-month-001-2023-agricultural",
   "birth_input": {"year":2023,"month":3,"day":23,"hour":12,"minute":0,"city":"北京","gender":"female","useTrueSolarTime":false}},
  {"case_id": "leap-month-002-2020-april-leap",
   "birth_input": {"year":2020,"month":5,"day":15,"hour":12,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":false}},

  {"case_id": "extreme-001-1900-01-01",
   "birth_input": {"year":1900,"month":1,"day":1,"hour":0,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":false}},
  {"case_id": "extreme-002-2050-12-31",
   "birth_input": {"year":2050,"month":12,"day":31,"hour":23,"minute":59,"city":"北京","gender":"female","useTrueSolarTime":false}},
  {"case_id": "extreme-003-midnight-exact",
   "birth_input": {"year":2000,"month":1,"day":1,"hour":0,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":false}},
  {"case_id": "extreme-004-noon-exact",
   "birth_input": {"year":2000,"month":6,"day":21,"hour":12,"minute":0,"city":"北京","gender":"female","useTrueSolarTime":true}},

  {"case_id": "dayun-001-boy-yang-year",
   "birth_input": {"year":1984,"month":3,"day":15,"hour":10,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":false}},
  {"case_id": "dayun-002-boy-yin-year",
   "birth_input": {"year":1985,"month":3,"day":15,"hour":10,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":false}},
  {"case_id": "dayun-003-girl-yang-year",
   "birth_input": {"year":1984,"month":3,"day":15,"hour":10,"minute":0,"city":"北京","gender":"female","useTrueSolarTime":false}},
  {"case_id": "dayun-004-girl-yin-year",
   "birth_input": {"year":1985,"month":3,"day":15,"hour":10,"minute":0,"city":"北京","gender":"female","useTrueSolarTime":false}},
  {"case_id": "dayun-005-early-start-age",
   "birth_input": {"year":1990,"month":5,"day":20,"hour":14,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":false}},

  {"case_id": "misc-001-2000-baby",
   "birth_input": {"year":2000,"month":2,"day":29,"hour":14,"minute":0,"city":"北京","gender":"female","useTrueSolarTime":true}},
  {"case_id": "misc-002-feb-29-leap",
   "birth_input": {"year":2024,"month":2,"day":29,"hour":12,"minute":0,"city":"北京","gender":"male","useTrueSolarTime":true}},
  {"case_id": "misc-003-new-years-eve",
   "birth_input": {"year":1999,"month":12,"day":31,"hour":23,"minute":30,"city":"北京","gender":"male","ziConvention":"early","useTrueSolarTime":false}},
  {"case_id": "misc-004-new-years-eve-late",
   "birth_input": {"year":1999,"month":12,"day":31,"hour":23,"minute":30,"city":"北京","gender":"male","ziConvention":"late","useTrueSolarTime":false}},
  {"case_id": "misc-005-mao-zedong-no-solar",
   "birth_input": {"year":1893,"month":12,"day":26,"hour":8,"minute":0,"gender":"male","useTrueSolarTime":false}}
]
```

- [ ] **Step 2: 验证 JSON 语法正确**

Run:
```bash
uv run --package paipan python -c "import json; d = json.load(open('paipan/tests/regression/birth_inputs.json')); print(f'{len(d)} cases loaded')"
```
Expected: `50 cases loaded`

- [ ] **Step 3: 提交**

```bash
git add paipan/tests/regression/birth_inputs.json
git commit -m "test(paipan): initial 50 regression inputs covering main edge cases"
```

---

### Task 6: 生成初始 oracle fixtures

**Files:**
- Create: `paipan/tests/regression/fixtures/*.json`（50 个文件）

- [ ] **Step 1: 确保 paipan-engine 依赖装好**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis/paipan-engine
npm install
node -e "const {paipan} = require('./src/paipan'); console.log('ok');"
```
Expected: 输出 `ok`。

- [ ] **Step 2: 跑 dump 脚本生成 50 个 fixture**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis/paipan-engine
node scripts/dump-oracle.js \
  ../paipan/tests/regression/birth_inputs.json \
  ../paipan/tests/regression/fixtures/
ls ../paipan/tests/regression/fixtures/ | wc -l
```
Expected: 输出 `Done: 50 ok, 0 failed.`；`wc -l` 输出 `50`。

如果有 fail，停下来检查：该条 input 是否合法？Node 版对该组合是否有 bug？**记录下来**，不要跳过——port 时 Python 必须复现同样行为。

- [ ] **Step 3: 抽样检查 3 个 fixture 内容**

Run:
```bash
cat /Users/veko/code/usual/bazi-analysis/paipan/tests/regression/fixtures/basic-001-1990-05-15-beijing-male-truesolar.json | python3 -m json.tool | head -40
```
Expected: 包含 `case_id`、`birth_input`、`expected` 三个顶层键；`expected` 含 `sizhu`、`rizhu`、`shishen`、`cangGan`、`naYin`、`dayun`、`warnings`、`meta`、`todayYearGz` 等。

- [ ] **Step 4: 提交**

```bash
cd /Users/veko/code/usual/bazi-analysis
git add paipan/tests/regression/fixtures/
git commit -m "test(paipan): initial 50 oracle fixtures generated from Node engine"
```

---

### Task 7: 深度 diff 工具（浮点容差 + 可读 diff 报告）

**Files:**
- Create: `paipan/tests/regression/deep_diff.py`
- Create: `paipan/tests/regression/__init__.py`
- Create: `paipan/tests/unit/test_deep_diff.py`

- [ ] **Step 1: 写 deep_diff 单元测试（红）**

写 `paipan/tests/regression/__init__.py`（空文件）。

写 `paipan/tests/unit/test_deep_diff.py`：
```python
from paipan.tests_util.deep_diff import deep_diff


def test_equal_dicts_no_diff():
    assert deep_diff({"a": 1}, {"a": 1}) == []


def test_scalar_mismatch():
    diff = deep_diff({"a": 1}, {"a": 2})
    assert len(diff) == 1
    assert diff[0].path == "a"
    assert diff[0].actual == 1
    assert diff[0].expected == 2


def test_float_within_tolerance():
    assert deep_diff({"x": 1.0}, {"x": 1.0 + 1e-10}, float_tolerance=1e-9) == []


def test_float_outside_tolerance():
    diff = deep_diff({"x": 1.0}, {"x": 1.1}, float_tolerance=1e-9)
    assert len(diff) == 1


def test_nested_dict():
    diff = deep_diff({"a": {"b": 1}}, {"a": {"b": 2}})
    assert diff[0].path == "a.b"


def test_list_length_mismatch():
    diff = deep_diff([1, 2], [1, 2, 3])
    assert len(diff) >= 1
    assert "length" in diff[0].reason.lower()


def test_list_item_mismatch():
    diff = deep_diff([1, 2, 3], [1, 9, 3])
    assert any(d.path == "[1]" for d in diff)


def test_missing_key():
    diff = deep_diff({"a": 1}, {"a": 1, "b": 2})
    assert any(d.path == "b" and "missing" in d.reason.lower() for d in diff)


def test_extra_key():
    diff = deep_diff({"a": 1, "b": 2}, {"a": 1})
    assert any(d.path == "b" and "unexpected" in d.reason.lower() for d in diff)


def test_none_vs_value():
    diff = deep_diff({"a": None}, {"a": "value"})
    assert len(diff) == 1
```

**注意**：我们要把 `deep_diff` 放到能被测试代码 import 的位置。把它放到 `paipan/paipan/tests_util/deep_diff.py`（作为子包）——不，更清晰的是：**测试工具放在 `paipan/tests/regression/deep_diff.py`**，然后 unit test 从同级 import。修正 import：

重写 `paipan/tests/unit/test_deep_diff.py` 的 import 行为：
```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "regression"))
from deep_diff import deep_diff
# ... 其余测试内容同上
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_deep_diff.py -v
```
Expected: `ModuleNotFoundError: No module named 'deep_diff'` 或类似。

- [ ] **Step 3: 写 deep_diff 实现**

写 `paipan/tests/regression/deep_diff.py`：
```python
"""
Deep equality diff with float tolerance, for oracle regression testing.

Returns a list of DiffEntry; empty list means equal.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any


@dataclass
class DiffEntry:
    path: str
    actual: Any
    expected: Any
    reason: str


def deep_diff(actual: Any, expected: Any, *,
              float_tolerance: float = 1e-9,
              path: str = "") -> list[DiffEntry]:
    """Recursively compare two values; return list of differences."""
    diffs: list[DiffEntry] = []

    # Type difference (except numeric int/float)
    if type(actual) is not type(expected):
        if not (isinstance(actual, (int, float)) and isinstance(expected, (int, float))):
            diffs.append(DiffEntry(
                path or "<root>", actual, expected,
                f"type mismatch: {type(actual).__name__} vs {type(expected).__name__}",
            ))
            return diffs

    if isinstance(actual, dict):
        assert isinstance(expected, dict)
        for key in sorted(set(actual) | set(expected)):
            sub_path = f"{path}.{key}" if path else key
            if key not in expected:
                diffs.append(DiffEntry(sub_path, actual[key], None, "unexpected key (not in expected)"))
            elif key not in actual:
                diffs.append(DiffEntry(sub_path, None, expected[key], "missing key"))
            else:
                diffs.extend(deep_diff(actual[key], expected[key],
                                       float_tolerance=float_tolerance, path=sub_path))
    elif isinstance(actual, list):
        assert isinstance(expected, list)
        if len(actual) != len(expected):
            diffs.append(DiffEntry(
                path or "<root>", len(actual), len(expected),
                f"list length mismatch: {len(actual)} vs {len(expected)}",
            ))
            # still diff common prefix
        for i in range(min(len(actual), len(expected))):
            sub_path = f"{path}[{i}]"
            diffs.extend(deep_diff(actual[i], expected[i],
                                   float_tolerance=float_tolerance, path=sub_path))
    elif isinstance(actual, float) or isinstance(expected, float):
        if abs(float(actual) - float(expected)) > float_tolerance:
            diffs.append(DiffEntry(path or "<root>", actual, expected,
                                   f"float differs by {abs(float(actual) - float(expected)):.3e}"))
    else:
        if actual != expected:
            diffs.append(DiffEntry(path or "<root>", actual, expected, "value mismatch"))

    return diffs


def format_diff(diffs: list[DiffEntry], max_value_len: int = 80) -> str:
    if not diffs:
        return "(no diff)"

    def _fmt(v: Any) -> str:
        s = repr(v)
        return s if len(s) <= max_value_len else s[:max_value_len] + "..."

    lines = [f"{len(diffs)} difference(s):"]
    for d in diffs:
        lines.append(f"  {d.path}: {d.reason}")
        lines.append(f"    actual:   {_fmt(d.actual)}")
        lines.append(f"    expected: {_fmt(d.expected)}")
    return "\n".join(lines)
```

- [ ] **Step 4: 运行测试验证通过**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_deep_diff.py -v
```
Expected: 10 passed。

- [ ] **Step 5: 提交**

```bash
git add paipan/tests/regression/deep_diff.py paipan/tests/regression/__init__.py \
        paipan/tests/unit/test_deep_diff.py
git commit -m "test(paipan): deep_diff utility with float tolerance"
```

---

### Task 8: 回归测试 runner（xfail 状态：compute() 尚未实现）

**Files:**
- Create: `paipan/tests/regression/test_regression.py`

- [ ] **Step 1: 写 runner（先让所有 case xfail）**

写 `paipan/tests/regression/test_regression.py`：
```python
"""
Oracle-driven regression test.

For each fixture file, load the birth_input, run paipan.compute(),
and deep-diff against the Node engine's expected output.

Before compute() is implemented, all cases xfail. As modules are ported,
cases progressively pass.
"""
from __future__ import annotations
import json
import pathlib
import pytest

from paipan.tests.regression.deep_diff import deep_diff, format_diff

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"


def _load_fixtures() -> list[pathlib.Path]:
    return sorted(FIXTURES_DIR.glob("*.json"))


@pytest.mark.parametrize("fixture_path", _load_fixtures(), ids=lambda p: p.stem)
def test_regression(fixture_path: pathlib.Path) -> None:
    data = json.loads(fixture_path.read_text(encoding="utf-8"))
    case_id = data["case_id"]
    birth_input = data["birth_input"]
    expected = data["expected"]

    try:
        from paipan import compute
    except ImportError:
        pytest.xfail("compute() not yet implemented")

    actual = compute(**birth_input)
    actual_dict = actual.model_dump() if hasattr(actual, "model_dump") else actual

    diffs = deep_diff(actual_dict, expected, float_tolerance=1e-9)
    if diffs:
        pytest.fail(f"Regression diff for {case_id}:\n{format_diff(diffs)}")
```

**注意**：这里 `from paipan.tests.regression.deep_diff` 需要 `paipan/tests` 是包。补充：
- 确保 `paipan/tests/__init__.py` 存在
- 确保 `paipan/tests/regression/__init__.py` 存在（Task 7 Step 1 已写）

**pytest 配置从子包上升到 workspace 根**（来自 Task 1 code review I2：从 workspace 根跑 `uv run pytest` 时，pytest 只 discover 根 pyproject，子包的 pytest 配置会被忽略）。

删除 `paipan/pyproject.toml` 里的 `[tool.pytest.ini_options]` 整段，然后更新**根** `pyproject.toml`，在现有 `[tool.uv.workspace]` 下方追加：
```toml
[tool.pytest.ini_options]
testpaths = ["paipan/tests"]
addopts = "-ra --strict-markers"
pythonpath = ["."]
```

`pythonpath = ["."]`（repo 根）让 `from paipan.tests.regression.deep_diff import deep_diff` 能解析为 `paipan/tests/regression/deep_diff.py`——即 Python 把 repo 根当 sys.path 条目，然后按 `paipan.tests.regression.deep_diff` 的点分 path 找文件。

**注意**：Task 7 的 `test_deep_diff.py` 用了 `sys.path.insert` hack 直接 `from deep_diff import`。它会继续工作（sys.path hack 和 pythonpath 是两种独立机制），不需要改它。

- [ ] **Step 2: 运行 runner 验证 xfail 行为**

Run:
```bash
uv run --package paipan pytest paipan/tests/regression/test_regression.py -v 2>&1 | tail -20
```
Expected: 大量 `XFAIL`（因为 `from paipan import compute` 失败；但 unittest runner 收集了 50 个参数化用例）。
**不是** ERROR 或 FAILED。

- [ ] **Step 3: 提交**

```bash
git add paipan/tests/regression/test_regression.py paipan/pyproject.toml
git commit -m "test(paipan): parametrized regression runner (xfail pre-implementation)"
```

---

## Phase B：基础模块（Week 2，5 tasks）

### Task 9: types + cities

**Files:**
- Create: `paipan/paipan/types.py`
- Create: `paipan/paipan/cities.py`
- Create: `paipan/paipan/cities-data.json`（从 Node 仓库复制）
- Create: `paipan/tests/unit/test_cities.py`

- [ ] **Step 1: 写 Pydantic types（红：types 未定义）**

先写 `paipan/tests/unit/test_cities.py`：
```python
from paipan.cities import get_city_coords


def test_beijing():
    c = get_city_coords("北京")
    assert c is not None
    assert abs(c.lng - 116.4) < 0.5  # 宽松；精确值从 oracle diff 中锁定
    assert c.canonical == "北京"


def test_shanghai():
    c = get_city_coords("上海")
    assert c is not None
    assert c.canonical == "上海"


def test_shaoshan():
    c = get_city_coords("韶山")
    assert c is not None
    assert abs(c.lng - 112.53) < 0.5


def test_unknown_returns_none():
    assert get_city_coords("某小县城") is None


def test_empty_returns_none():
    assert get_city_coords("") is None
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_cities.py -v
```
Expected: `ImportError: cannot import name 'get_city_coords'`

- [ ] **Step 3: 写 types.py**

写 `paipan/paipan/types.py`：
```python
"""Pydantic models for paipan inputs and outputs."""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field


ZiConvention = Literal["early", "late"]
Gender = Literal["male", "female"]


class BirthInput(BaseModel):
    year: int
    month: int = Field(ge=1, le=12)
    day: int = Field(ge=1, le=31)
    hour: int = Field(ge=-1, le=23)  # -1 = unknown
    minute: int = Field(default=0, ge=0, le=59)
    city: Optional[str] = None
    longitude: Optional[float] = None
    gender: Gender
    ziConvention: ZiConvention = "early"
    useTrueSolarTime: bool = True


class City(BaseModel):
    lng: float
    lat: float
    canonical: str
```

- [ ] **Step 4: 复制 cities-data.json**

Run:
```bash
cp /Users/veko/code/usual/bazi-analysis/paipan-engine/src/cities-data.json \
   /Users/veko/code/usual/bazi-analysis/paipan/paipan/cities-data.json
```

- [ ] **Step 5: 写 cities.py 实现**

写 `paipan/paipan/cities.py`：
```python
"""City name → coordinates lookup. Ported from paipan-engine/src/cities.js."""
from __future__ import annotations
import json
import pathlib
from functools import lru_cache
from typing import Optional

from paipan.types import City

_DATA_PATH = pathlib.Path(__file__).parent / "cities-data.json"


@lru_cache(maxsize=1)
def _load_cities() -> dict[str, City]:
    """Load all cities into a name → City map. Covers canonical + aliases."""
    raw = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    # cities-data.json 格式：见 Node 仓库。假设是 [{name, lng, lat, aliases: []}, ...]
    # 若真实格式不同，运行时在此处调整
    index: dict[str, City] = {}
    for entry in raw:
        canonical = entry["name"]
        c = City(lng=entry["lng"], lat=entry["lat"], canonical=canonical)
        index[canonical] = c
        for alias in entry.get("aliases", []) or []:
            index.setdefault(alias, c)
    return index


def get_city_coords(name: str) -> Optional[City]:
    if not name:
        return None
    return _load_cities().get(name)
```

**注意**：实际 `cities-data.json` 的 schema 可能与上面假设不同。若 Step 6 测试失败提示 KeyError，打开 JSON 前 200 行看一眼，**照实际字段调整 `_load_cities()`**——不是改 JSON。

- [ ] **Step 6: 运行测试，失败则调 `_load_cities()` 使之通过**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_cities.py -v
```
Expected: 5 passed。

若失败提示 schema 不对，`python -c "import json; d=json.load(open('paipan/paipan/cities-data.json')); print(type(d).__name__); print(list(d.keys())[:3] if isinstance(d, dict) else d[:2])"` 查看，然后调 `_load_cities`。

- [ ] **Step 7: 在 `__init__.py` 导出**

更新 `paipan/paipan/__init__.py`：
```python
from paipan.constants import VERSION
from paipan.types import BirthInput, City, Gender, ZiConvention
from paipan.cities import get_city_coords

__all__ = ["VERSION", "BirthInput", "City", "Gender", "ZiConvention", "get_city_coords"]
```

- [ ] **Step 8: 提交**

```bash
git add paipan/paipan/types.py paipan/paipan/cities.py paipan/paipan/cities-data.json \
        paipan/paipan/__init__.py paipan/tests/unit/test_cities.py
git commit -m "feat(paipan): cities lookup + Pydantic types"
```

---

### Task 10: solar_time port

**Files:**
- Create: `paipan/paipan/solar_time.py`
- Create: `paipan/tests/unit/test_solar_time.py`

- [ ] **Step 1: 读 Node `src/solarTime.js`**

Run:
```bash
cat /Users/veko/code/usual/bazi-analysis/paipan-engine/src/solarTime.js
```
**照实际源码翻译**；下文示例结构**可能与实际不一致**，以源码为准。

- [ ] **Step 2: 写单元测试（红）**

写 `paipan/tests/unit/test_solar_time.py`：
```python
"""
Unit tests for solar_time. Values are cross-checked against Node output
via oracle dump. We use a few known examples here; full regression covers rest.
"""
from paipan.solar_time import to_true_solar_time


def test_beijing_noon_no_shift():
    # 北京 (~116.4°E), 接近标准时区 120°E，偏移约 -14 分钟
    r = to_true_solar_time(2020, 6, 15, 12, 0, 116.4)
    assert r["year"] == 2020 and r["month"] == 6 and r["day"] == 15
    assert abs(r["shiftMinutes"]) < 30


def test_urumqi_large_shift():
    # 乌鲁木齐 ~87.6°E，偏移 -120 分钟以上
    r = to_true_solar_time(2020, 6, 15, 12, 0, 87.6)
    assert r["shiftMinutes"] < -100
    # 日期/时分应相应回滚
    assert r["hour"] <= 10  # 大致 10 点


def test_shaoshan_mao_zedong():
    # 112.53°E, 清晨 8:00
    r = to_true_solar_time(1893, 12, 26, 8, 0, 112.53)
    # 偏移是负的（早于北京时）
    assert r["shiftMinutes"] < 0
```

- [ ] **Step 3: 运行测试验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_solar_time.py -v
```
Expected: ImportError。

- [ ] **Step 4: 翻译 solar_time.py**

读 `paipan-engine/src/solarTime.js` 全文（Step 1 输出），逐行翻译成 Python。写 `paipan/paipan/solar_time.py`。

基本结构应是：
```python
"""
真太阳时换算。Port of paipan-engine/src/solarTime.js.

Algorithm:
  shiftMinutes = longitudeMinutes + eotMinutes
  longitudeMinutes = (longitude - 120) * 4        # 北京时标准经度 120°E
  eotMinutes = Equation-of-Time adjustment        # 见 JS 源码
Then apply shift (in minutes) to clock time, handling day/month/year rollover.
"""
from __future__ import annotations
from datetime import datetime, timedelta
import math


# NOTE: from solarTime.js — 原始公式必须字面照搬。
def _equation_of_time_minutes(year: int, month: int, day: int) -> float:
    """EoT 计算。读 Node 源码后按字面翻译此处。"""
    # TODO: 按 solarTime.js 实际实现填入
    ...


def to_true_solar_time(year: int, month: int, day: int, hour: int, minute: int,
                       longitude: float) -> dict:
    """
    Returns:
        {year, month, day, hour, minute, longitudeMinutes, eotMinutes, shiftMinutes}
    """
    longitude_minutes = (longitude - 120.0) * 4.0
    eot_minutes = _equation_of_time_minutes(year, month, day)
    shift_minutes = longitude_minutes + eot_minutes

    dt = datetime(year, month, day, hour, minute)
    dt2 = dt + timedelta(minutes=shift_minutes)

    return {
        "year": dt2.year, "month": dt2.month, "day": dt2.day,
        "hour": dt2.hour, "minute": dt2.minute,
        "longitudeMinutes": longitude_minutes,
        "eotMinutes": eot_minutes,
        "shiftMinutes": shift_minutes,
    }
```

**TODO 占位不是真占位——执行者必须读 `solarTime.js` 的实际 EoT 代码填入。**如果 Node 用了表/多项式/近似公式，照抄。

- [ ] **Step 5: 运行单元测试**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_solar_time.py -v
```
Expected: 3 passed。

如有 float 不一致，和 Node 对拍（写个一次性 JS 脚本跑相同 3 个输入）定位差异。

- [ ] **Step 6: 提交**

```bash
git add paipan/paipan/solar_time.py paipan/tests/unit/test_solar_time.py
git commit -m "feat(paipan): port solar_time (true solar time correction)"
```

---

### Task 11: china_dst port

**Files:**
- Create: `paipan/paipan/china_dst.py`
- Create: `paipan/tests/unit/test_china_dst.py`

- [ ] **Step 1: 读 Node `src/chinaDst.js`**

Run:
```bash
cat /Users/veko/code/usual/bazi-analysis/paipan-engine/src/chinaDst.js
```

- [ ] **Step 2: 写单元测试（红）**

写 `paipan/tests/unit/test_china_dst.py`：
```python
from paipan.china_dst import correct_china_dst


def test_during_dst_1988():
    # 1988 夏天在 DST 期间
    r = correct_china_dst(1988, 7, 15, 10, 0)
    assert r["wasDst"] is True
    assert r["hour"] == 9  # 减 1 小时


def test_outside_dst_winter():
    # 1988 冬天 DST 已结束
    r = correct_china_dst(1988, 12, 15, 10, 0)
    assert r["wasDst"] is False
    assert r["hour"] == 10  # 不动


def test_before_dst_era_1985():
    # 1985 还没开始 DST
    r = correct_china_dst(1985, 7, 15, 10, 0)
    assert r["wasDst"] is False


def test_after_dst_era_1992():
    # 1992 DST 已废除
    r = correct_china_dst(1992, 7, 15, 10, 0)
    assert r["wasDst"] is False


def test_entry_day_1986_05_04():
    # 查 Node 源码确认 1986-05-04 是否在 DST 内
    r = correct_china_dst(1986, 5, 4, 12, 0)
    # 断言值照 Node 版实际行为；先占位，oracle 对拍时校正
    assert "wasDst" in r
```

- [ ] **Step 3: 运行测试验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_china_dst.py -v
```
Expected: ImportError。

- [ ] **Step 4: 翻译 china_dst.py**

按 Node 源码字面翻译。DST 表通常是静态数据，一组 `(year, start_date, end_date)`。写 `paipan/paipan/china_dst.py`：
```python
"""
China DST correction. Port of paipan-engine/src/chinaDst.js.
Only 1986-05-04 ~ 1991-09-15 summers had DST in China.
"""
from __future__ import annotations
from datetime import datetime, timedelta


# NOTE: from chinaDst.js — 查表必须照抄 Node 源码里的起止日期。
# 格式：{year: (start_month, start_day, end_month, end_day)}
_DST_TABLE: dict[int, tuple[int, int, int, int]] = {
    # TODO: 按 chinaDst.js 实际值填入
    # 1986: (5, 4, 9, 14),   # 示意，以源码为准
    # ...
}


def _is_in_dst(year: int, month: int, day: int, hour: int, minute: int) -> bool:
    entry = _DST_TABLE.get(year)
    if entry is None:
        return False
    sm, sd, em, ed = entry
    t = datetime(year, month, day, hour, minute)
    start = datetime(year, sm, sd, 0, 0)
    end = datetime(year, em, ed, 0, 0)
    return start <= t < end


def correct_china_dst(year: int, month: int, day: int, hour: int, minute: int) -> dict:
    """
    Returns:
        {wasDst, year, month, day, hour, minute}
    """
    if not _is_in_dst(year, month, day, hour, minute):
        return {"wasDst": False, "year": year, "month": month, "day": day,
                "hour": hour, "minute": minute}
    dt = datetime(year, month, day, hour, minute) - timedelta(hours=1)
    return {"wasDst": True, "year": dt.year, "month": dt.month, "day": dt.day,
            "hour": dt.hour, "minute": dt.minute}
```

**TODO 必须填**：照 Node 源码里的表精确填写。

- [ ] **Step 5: 运行测试**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_china_dst.py -v
```
Expected: 5 passed。

- [ ] **Step 6: 提交**

```bash
git add paipan/paipan/china_dst.py paipan/tests/unit/test_china_dst.py
git commit -m "feat(paipan): port china_dst (1986-1991 summer DST table)"
```

---

### Task 12: zi_hour + jieqi boundary port

**Files:**
- Create: `paipan/paipan/zi_hour.py`
- Create: `paipan/tests/unit/test_zi_hour.py`

- [ ] **Step 1: 读 Node 源码**

Run:
```bash
cat /Users/veko/code/usual/bazi-analysis/paipan-engine/src/ziHourAndJieqi.js
```

- [ ] **Step 2: 验证 lunar-python 的节气 API**

Run:
```bash
uv run --package paipan python -c "
from lunar_python import Solar
s = Solar.fromYmdHms(2024, 2, 4, 16, 27, 0)
lunar = s.getLunar()
table = lunar.getJieQiTable()
print('jieqi keys sample:', list(table.keys())[:5])
print('lichun 2024:', table.get('立春'))
"
```
Expected: 输出立春时间（Solar 对象，含 year/month/day/hour/minute）。

- [ ] **Step 3: 写单元测试（红）**

写 `paipan/tests/unit/test_zi_hour.py`：
```python
from paipan.zi_hour import convert_to_late_zi_convention, check_jieqi_boundary


def test_late_zi_2330_rolls_forward():
    r = convert_to_late_zi_convention(2024, 3, 15, 23, 30)
    assert r["converted"] is True
    assert r["year"] == 2024 and r["month"] == 3 and r["day"] == 16
    assert r["hour"] == 0 and r["minute"] == 30


def test_late_zi_before_23_no_change():
    r = convert_to_late_zi_convention(2024, 3, 15, 22, 30)
    assert r["converted"] is False
    assert r["day"] == 15 and r["hour"] == 22


def test_late_zi_month_boundary():
    r = convert_to_late_zi_convention(2024, 3, 31, 23, 30)
    assert r["converted"] is True
    assert r["month"] == 4 and r["day"] == 1


def test_jieqi_boundary_near():
    # 立春 2024-02-04 16:27 附近
    r = check_jieqi_boundary(2024, 2, 4, 16, 25)  # 前 2 分钟
    assert r["isNearBoundary"] is True
    assert "立春" in r["hint"] or "节气" in r["hint"]


def test_jieqi_boundary_far():
    r = check_jieqi_boundary(2024, 3, 15, 12, 0)  # 远离任何节气
    assert r["isNearBoundary"] is False
```

- [ ] **Step 4: 运行测试验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_zi_hour.py -v
```
Expected: ImportError。

- [ ] **Step 5: 翻译 zi_hour.py**

写 `paipan/paipan/zi_hour.py`，从 Node 源码字面翻译：
```python
"""
Zi hour convention + jieqi boundary check. Port of
paipan-engine/src/ziHourAndJieqi.js.
"""
from __future__ import annotations
from datetime import datetime, timedelta

from lunar_python import Solar


def convert_to_late_zi_convention(year: int, month: int, day: int,
                                  hour: int, minute: int) -> dict:
    """
    Late-zi-hour: 23:00-23:59 rolls to next day 0:00-0:59 (for day pillar).
    Early (default): 23:00-23:59 stays on original day.

    Returns: {converted, year, month, day, hour, minute}
    """
    if hour != 23:
        return {"converted": False, "year": year, "month": month, "day": day,
                "hour": hour, "minute": minute}
    dt = datetime(year, month, day, hour, minute) + timedelta(hours=1)
    return {"converted": True, "year": dt.year, "month": dt.month, "day": dt.day,
            "hour": dt.hour, "minute": dt.minute}


# Jieqi boundary warning window (minutes) — 读 Node 源码确定实际值
# NOTE: from ziHourAndJieqi.js — 若 Node 使用 15 分钟窗口，照填
_BOUNDARY_WINDOW_MINUTES = 15  # 以源码为准；默认 15


def check_jieqi_boundary(year: int, month: int, day: int,
                         hour: int, minute: int) -> dict:
    """
    Check if within N minutes of a jieqi (solar term) boundary.
    Returns: {isNearBoundary, hint}
    """
    solar = Solar.fromYmdHms(year, month, day, hour, minute, 0)
    lunar = solar.getLunar()
    table = lunar.getJieQiTable()

    target = datetime(year, month, day, hour, minute)
    nearest_name = None
    nearest_delta_min = None

    for name, jq_solar in table.items():
        jq_dt = datetime(jq_solar.getYear(), jq_solar.getMonth(), jq_solar.getDay(),
                         jq_solar.getHour(), jq_solar.getMinute())
        delta_min = abs((target - jq_dt).total_seconds() / 60.0)
        if nearest_delta_min is None or delta_min < nearest_delta_min:
            nearest_delta_min = delta_min
            nearest_name = name

    if nearest_delta_min is not None and nearest_delta_min <= _BOUNDARY_WINDOW_MINUTES:
        return {
            "isNearBoundary": True,
            "hint": f"距离节气「{nearest_name}」仅 {nearest_delta_min:.0f} 分钟，月柱可能敏感。",
            "nearestJieqi": nearest_name,
            "deltaMinutes": nearest_delta_min,
        }
    return {"isNearBoundary": False, "hint": "",
            "nearestJieqi": nearest_name, "deltaMinutes": nearest_delta_min}
```

**注意**：_BOUNDARY_WINDOW_MINUTES 和 hint 文案必须与 Node 版一致——读源码核对。

- [ ] **Step 6: 运行测试**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_zi_hour.py -v
```
Expected: 5 passed。

- [ ] **Step 7: 提交**

```bash
git add paipan/paipan/zi_hour.py paipan/tests/unit/test_zi_hour.py
git commit -m "feat(paipan): port zi_hour convention + jieqi boundary check"
```

---

### Task 13: ganzhi 查找表 + 工具函数

**Files:**
- Create: `paipan/paipan/ganzhi.py`
- Create: `paipan/tests/unit/test_ganzhi.py`

- [ ] **Step 1: 读 Node `src/ming/ganzhi.js`**

Run:
```bash
cat /Users/veko/code/usual/bazi-analysis/paipan-engine/src/ming/ganzhi.js
```

- [ ] **Step 2: 写单元测试**

写 `paipan/tests/unit/test_ganzhi.py`：
```python
from paipan.ganzhi import GAN, ZHI, GAN_WUXING, ZHI_WUXING, GAN_YINYANG, split_ganzhi


def test_gan_count():
    assert len(GAN) == 10
    assert GAN[0] == "甲"
    assert GAN[-1] == "癸"


def test_zhi_count():
    assert len(ZHI) == 12
    assert ZHI[0] == "子"
    assert ZHI[-1] == "亥"


def test_wuxing_jia():
    assert GAN_WUXING["甲"] == "木"
    assert GAN_WUXING["丁"] == "火"
    assert GAN_WUXING["庚"] == "金"


def test_zhi_wuxing_yin():
    assert ZHI_WUXING["寅"] == "木"
    assert ZHI_WUXING["巳"] == "火"


def test_gan_yinyang():
    assert GAN_YINYANG["甲"] == "阳"
    assert GAN_YINYANG["乙"] == "阴"


def test_split_ganzhi():
    gan, zhi = split_ganzhi("癸巳")
    assert gan == "癸" and zhi == "巳"
```

- [ ] **Step 3: 运行验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_ganzhi.py -v
```
Expected: ImportError。

- [ ] **Step 4: 写实现**

写 `paipan/paipan/ganzhi.py`，从 Node 源码翻译：
```python
"""Gan/Zhi lookup tables. Port of paipan-engine/src/ming/ganzhi.js."""
from __future__ import annotations

# NOTE: from ming/ganzhi.js
GAN: list[str] = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
ZHI: list[str] = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]

GAN_WUXING: dict[str, str] = {
    "甲": "木", "乙": "木", "丙": "火", "丁": "火",
    "戊": "土", "己": "土", "庚": "金", "辛": "金",
    "壬": "水", "癸": "水",
}

ZHI_WUXING: dict[str, str] = {
    "子": "水", "丑": "土", "寅": "木", "卯": "木",
    "辰": "土", "巳": "火", "午": "火", "未": "土",
    "申": "金", "酉": "金", "戌": "土", "亥": "水",
}

GAN_YINYANG: dict[str, str] = {
    "甲": "阳", "乙": "阴", "丙": "阳", "丁": "阴", "戊": "阳",
    "己": "阴", "庚": "阳", "辛": "阴", "壬": "阳", "癸": "阴",
}

ZHI_YINYANG: dict[str, str] = {
    "子": "阳", "丑": "阴", "寅": "阳", "卯": "阴", "辰": "阳", "巳": "阴",
    "午": "阳", "未": "阴", "申": "阳", "酉": "阴", "戌": "阳", "亥": "阴",
}


def split_ganzhi(gz: str) -> tuple[str, str]:
    """'癸巳' → ('癸', '巳')"""
    if len(gz) != 2:
        raise ValueError(f"invalid ganzhi: {gz!r}")
    return gz[0], gz[1]
```

**实际 Node 源码可能还有其他导出项（合冲刑害表等）——全部翻译。**

- [ ] **Step 5: 运行测试**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_ganzhi.py -v
```
Expected: 6 passed。

- [ ] **Step 6: 提交**

```bash
git add paipan/paipan/ganzhi.py paipan/tests/unit/test_ganzhi.py
git commit -m "feat(paipan): port ganzhi lookup tables"
```

---

## Phase C：解读层（Week 3，4 tasks）

### Task 14: shi_shen（十神）port

**Files:**
- Create: `paipan/paipan/shi_shen.py`
- Create: `paipan/tests/unit/test_shi_shen.py`

- [ ] **Step 1: 读 Node `src/ming/shishen.js`**

Run:
```bash
cat /Users/veko/code/usual/bazi-analysis/paipan-engine/src/ming/shishen.js
```

- [ ] **Step 2: 写覆盖 10×9=90 组合的单元测试**

写 `paipan/tests/unit/test_shi_shen.py`：
```python
import pytest
from paipan.ganzhi import GAN
from paipan.shi_shen import get_shi_shen, SHI_SHEN_NAMES


def test_bijian_same_gan_yinyang():
    # 甲 对 甲 = 比肩
    assert get_shi_shen("甲", "甲") == "比肩"


def test_jiecai_same_wuxing_diff_yinyang():
    # 甲（阳木）对 乙（阴木）= 劫财
    assert get_shi_shen("甲", "乙") == "劫财"


def test_zhengyin_sheng_wo_diff_yinyang():
    # 甲（阳木）被 癸（阴水）生 = 正印
    assert get_shi_shen("甲", "癸") == "正印"


def test_pianyin_sheng_wo_same_yinyang():
    # 甲（阳木）被 壬（阳水）生 = 偏印
    assert get_shi_shen("甲", "壬") == "偏印"


@pytest.mark.parametrize("dayGan", GAN)
def test_all_dayGan_map_every_gan_to_some_shi_shen(dayGan):
    # 每种日干对每个天干都要返回一个合法的十神名
    for otherGan in GAN:
        r = get_shi_shen(dayGan, otherGan)
        assert r in SHI_SHEN_NAMES, f"{dayGan}→{otherGan} got {r!r}"
```

- [ ] **Step 3: 运行验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_shi_shen.py -v
```
Expected: ImportError。

- [ ] **Step 4: 写实现**

写 `paipan/paipan/shi_shen.py`，从 Node 源码翻译：
```python
"""
十神判定。Port of paipan-engine/src/ming/shishen.js.

规则（按"日主 vs 他干"的五行生克 + 阴阳）：
  同五行：同阴阳 → 比肩；不同阴阳 → 劫财
  我生：同阴阳 → 食神；不同阴阳 → 伤官
  我克：同阴阳 → 偏财；不同阴阳 → 正财
  克我：同阴阳 → 七杀；不同阴阳 → 正官
  生我：同阴阳 → 偏印；不同阴阳 → 正印
"""
from __future__ import annotations

from paipan.ganzhi import GAN_WUXING, GAN_YINYANG


SHI_SHEN_NAMES: set[str] = {
    "比肩", "劫财", "食神", "伤官",
    "偏财", "正财", "七杀", "正官",
    "偏印", "正印",
}


# 五行相生：木→火→土→金→水→木
_SHENG_NEXT = {"木": "火", "火": "土", "土": "金", "金": "水", "水": "木"}
# 五行相克：木→土→水→火→金→木
_KE_NEXT = {"木": "土", "土": "水", "水": "火", "火": "金", "金": "木"}


def get_shi_shen(day_gan: str, other_gan: str) -> str:
    """Given 日主 + 另一个天干，返回十神名。"""
    day_wx = GAN_WUXING[day_gan]
    oth_wx = GAN_WUXING[other_gan]
    same_yy = GAN_YINYANG[day_gan] == GAN_YINYANG[other_gan]

    if day_wx == oth_wx:
        return "比肩" if same_yy else "劫财"
    if _SHENG_NEXT[day_wx] == oth_wx:
        # 我生他
        return "食神" if same_yy else "伤官"
    if _KE_NEXT[day_wx] == oth_wx:
        # 我克他
        return "偏财" if same_yy else "正财"
    if _KE_NEXT[oth_wx] == day_wx:
        # 他克我
        return "七杀" if same_yy else "正官"
    if _SHENG_NEXT[oth_wx] == day_wx:
        # 他生我
        return "偏印" if same_yy else "正印"
    raise AssertionError(f"unreachable: {day_gan}→{other_gan}")
```

**注意**：Node 版可能用一张硬编码表而不是规则推导。**若源码是查表必须按表翻译**（更接近字面 port 原则）。上面是规则推导版；两种方式输出必须一致。

- [ ] **Step 5: 运行测试**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_shi_shen.py -v
```
Expected: 4 + 10（参数化）= 14 passed。

- [ ] **Step 6: 提交**

```bash
git add paipan/paipan/shi_shen.py paipan/tests/unit/test_shi_shen.py
git commit -m "feat(paipan): port shi_shen (ten gods) classifier"
```

---

### Task 15: cang_gan（藏干）port

**Files:**
- Create: `paipan/paipan/cang_gan.py`
- Create: `paipan/tests/unit/test_cang_gan.py`

- [ ] **Step 1: 读 Node `src/ming/cangGan.js`**

Run:
```bash
cat /Users/veko/code/usual/bazi-analysis/paipan-engine/src/ming/cangGan.js
```

- [ ] **Step 2: 写单元测试（红）**

写 `paipan/tests/unit/test_cang_gan.py`：
```python
import pytest
from paipan.ganzhi import ZHI
from paipan.cang_gan import get_cang_gan


def test_yin_cang_jia_bing_wu():
    # 寅 藏 甲（主）丙（中）戊（余）
    r = get_cang_gan("寅")
    assert r["main"] == "甲"
    assert r.get("middle") == "丙"
    assert r.get("residual") == "戊"


def test_zi_cang_gui():
    # 子 只藏癸
    r = get_cang_gan("子")
    assert r["main"] == "癸"
    assert r.get("middle") is None
    assert r.get("residual") is None


@pytest.mark.parametrize("zhi", ZHI)
def test_every_zhi_has_cang_gan(zhi):
    r = get_cang_gan(zhi)
    assert "main" in r
    assert r["main"] is not None and len(r["main"]) == 1  # 一个天干
```

- [ ] **Step 3: 运行验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_cang_gan.py -v
```
Expected: ImportError。

- [ ] **Step 4: 写实现（照 Node 源码表翻译）**

写 `paipan/paipan/cang_gan.py`：
```python
"""
地支藏干表。Port of paipan-engine/src/ming/cangGan.js.
"""
from __future__ import annotations
from typing import Optional, TypedDict


class CangGan(TypedDict):
    main: str
    middle: Optional[str]
    residual: Optional[str]


# NOTE: from ming/cangGan.js — 照源码字面填写。下面结构示意。
_CANG_GAN_TABLE: dict[str, CangGan] = {
    "子": {"main": "癸", "middle": None, "residual": None},
    "丑": {"main": "己", "middle": "癸", "residual": "辛"},
    "寅": {"main": "甲", "middle": "丙", "residual": "戊"},
    "卯": {"main": "乙", "middle": None, "residual": None},
    "辰": {"main": "戊", "middle": "乙", "residual": "癸"},
    "巳": {"main": "丙", "middle": "戊", "residual": "庚"},
    "午": {"main": "丁", "middle": "己", "residual": None},
    "未": {"main": "己", "middle": "丁", "residual": "乙"},
    "申": {"main": "庚", "middle": "壬", "residual": "戊"},
    "酉": {"main": "辛", "middle": None, "residual": None},
    "戌": {"main": "戊", "middle": "辛", "residual": "丁"},
    "亥": {"main": "壬", "middle": "甲", "residual": None},
}


def get_cang_gan(zhi: str) -> CangGan:
    if zhi not in _CANG_GAN_TABLE:
        raise ValueError(f"invalid zhi: {zhi!r}")
    return _CANG_GAN_TABLE[zhi].copy()
```

**必须与 Node 源码表**逐格校对；主气、中气、余气顺序若有出入以源码为准。

- [ ] **Step 5: 运行测试**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_cang_gan.py -v
```
Expected: 2 + 12 = 14 passed。

- [ ] **Step 6: 提交**

```bash
git add paipan/paipan/cang_gan.py paipan/tests/unit/test_cang_gan.py
git commit -m "feat(paipan): port cang_gan (hidden stems) table"
```

---

### Task 16: force（力量）port

**Files:**
- Create: `paipan/paipan/force.py`
- Create: `paipan/tests/unit/test_force.py`

力量计算是启发式 + 应用层逻辑，**必须字面翻译 `liLiang.js`**，不许重新设计。

- [ ] **Step 1: 读 Node `src/ming/liLiang.js`**

Run:
```bash
cat /Users/veko/code/usual/bazi-analysis/paipan-engine/src/ming/liLiang.js
```
记录每个函数的签名和关键 magic number。

- [ ] **Step 2: 写单元测试（红）**

写 `paipan/tests/unit/test_force.py`。力量计算的输入输出结构从 Node 源码读出；**下面的测试是示意**——实际以 Node 源码为准：
```python
from paipan.force import compute_force


def test_force_returns_ten_gods_scores():
    # 输入：八字（四柱 + 日主），输出 10 个十神力量分数
    paipan = {
        "year": {"gan": "癸", "zhi": "巳"},
        "month": {"gan": "甲", "zhi": "子"},
        "day":   {"gan": "丁", "zhi": "酉"},
        "hour":  {"gan": "甲", "zhi": "辰"},
    }
    r = compute_force(paipan, day_gan="丁")
    for key in ("比肩","劫财","食神","伤官","偏财","正财","七杀","正官","偏印","正印"):
        assert key in r
        assert isinstance(r[key], (int, float))


def test_force_sum_not_zero():
    paipan = {
        "year": {"gan": "癸", "zhi": "巳"},
        "month": {"gan": "甲", "zhi": "子"},
        "day":   {"gan": "丁", "zhi": "酉"},
        "hour":  {"gan": "甲", "zhi": "辰"},
    }
    r = compute_force(paipan, day_gan="丁")
    assert sum(r.values()) > 0
```

- [ ] **Step 3: 运行验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_force.py -v
```
Expected: ImportError。

- [ ] **Step 4: 字面翻译 liLiang.js 到 force.py**

写 `paipan/paipan/force.py`——**必须逐行对照 Node 源码**。骨架：
```python
"""
十神力量计算。Port of paipan-engine/src/ming/liLiang.js.

Strictly literal translation. Magic numbers retained.
See liLiang.js:LINE for each constant.
"""
from __future__ import annotations
from typing import TypedDict

from paipan.ganzhi import GAN_WUXING, ZHI_WUXING
from paipan.cang_gan import get_cang_gan
from paipan.shi_shen import get_shi_shen


# NOTE: from liLiang.js — 照源码常量填入
_WEIGHT_GAN = 1.0     # 天干的权重（示意）
_WEIGHT_ZHI_MAIN = 1.0
_WEIGHT_ZHI_MIDDLE = 0.5
_WEIGHT_ZHI_RESIDUAL = 0.25


class ForceScore(TypedDict):
    比肩: float
    劫财: float
    食神: float
    伤官: float
    偏财: float
    正财: float
    七杀: float
    正官: float
    偏印: float
    正印: float


def compute_force(paipan: dict, day_gan: str) -> dict[str, float]:
    """
    Given paipan (4 pillars: year/month/day/hour each with gan/zhi) + day gan,
    compute force score per shi-shen.

    Port of liLiang.js — see source for weighting rules.
    """
    scores: dict[str, float] = {k: 0.0 for k in (
        "比肩","劫财","食神","伤官","偏财","正财","七杀","正官","偏印","正印",
    )}

    for pillar_key in ("year", "month", "day", "hour"):
        pillar = paipan.get(pillar_key)
        if pillar is None:
            continue
        gan = pillar["gan"]
        zhi = pillar["zhi"]

        # 天干贡献
        if gan != day_gan or pillar_key != "day":  # 日干本身不计或计法见源码
            ss = get_shi_shen(day_gan, gan)
            scores[ss] += _WEIGHT_GAN

        # 地支藏干贡献
        cg = get_cang_gan(zhi)
        scores[get_shi_shen(day_gan, cg["main"])] += _WEIGHT_ZHI_MAIN
        if cg.get("middle"):
            scores[get_shi_shen(day_gan, cg["middle"])] += _WEIGHT_ZHI_MIDDLE
        if cg.get("residual"):
            scores[get_shi_shen(day_gan, cg["residual"])] += _WEIGHT_ZHI_RESIDUAL

    return scores
```

**上面是骨架**。执行者必须把 Node 源码里**真实**的权重、特殊情况（例如月令加权、季节调整）、日干本身是否计入等规则逐条落入。

- [ ] **Step 5: 运行测试**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_force.py -v
```
Expected: 2 passed（单测是宽松检查；精确值由回归对拍校正）。

- [ ] **Step 6: 提交**

```bash
git add paipan/paipan/force.py paipan/tests/unit/test_force.py
git commit -m "feat(paipan): port force (ten-gods weight) calculation"
```

---

### Task 17: ge_ju（格局）+ guards port

**Files:**
- Create: `paipan/paipan/ge_ju.py`
- Create: `paipan/tests/unit/test_ge_ju.py`

- [ ] **Step 1: 读 Node 源码**

Run:
```bash
cat /Users/veko/code/usual/bazi-analysis/paipan-engine/src/ming/geJu.js
```

- [ ] **Step 2: 写单元测试（红）**

写 `paipan/tests/unit/test_ge_ju.py`：
```python
from paipan.ge_ju import compute_ge_ju_and_guards


def test_returns_ge_ju_string():
    paipan = {
        "year": {"gan": "癸", "zhi": "巳"},
        "month": {"gan": "甲", "zhi": "子"},
        "day":   {"gan": "丁", "zhi": "酉"},
        "hour":  {"gan": "甲", "zhi": "辰"},
    }
    force = {"比肩": 1.0, "劫财": 0.0, "食神": 0.5, "伤官": 0.0,
             "偏财": 0.0, "正财": 1.0, "七杀": 0.0, "正官": 2.0,
             "偏印": 1.5, "正印": 0.5}
    r = compute_ge_ju_and_guards(paipan, day_gan="丁", force=force)
    assert "geJu" in r
    assert "guards" in r
    assert isinstance(r["geJu"], str)
    assert isinstance(r["guards"], list)
```

- [ ] **Step 3: 运行验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_ge_ju.py -v
```
Expected: ImportError。

- [ ] **Step 4: 字面翻译 geJu.js**

写 `paipan/paipan/ge_ju.py`：
```python
"""
格局判断 + guards（结构提示）。Port of paipan-engine/src/ming/geJu.js.

保留所有启发式规则和阈值常量。
"""
from __future__ import annotations
from typing import TypedDict


class GeJuResult(TypedDict):
    geJu: str
    guards: list[str]


def compute_ge_ju_and_guards(paipan: dict, day_gan: str,
                             force: dict[str, float]) -> GeJuResult:
    """
    Given paipan + day gan + force scores, decide geJu and emit guards.

    Port of geJu.js — see source for each rule's exact condition.
    """
    # NOTE: from geJu.js:NN — 按源码逐段翻译
    guards: list[str] = []
    ge_ju = "未定"

    # ... 具体规则照抄源码 ...

    return {"geJu": ge_ju, "guards": guards}
```

**同 force：骨架，真内容必须从 Node 源码字面翻译。**

- [ ] **Step 5: 运行测试**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_ge_ju.py -v
```
Expected: 1 passed。

- [ ] **Step 6: 提交**

```bash
git add paipan/paipan/ge_ju.py paipan/tests/unit/test_ge_ju.py
git commit -m "feat(paipan): port ge_ju + guards"
```

---

## Phase D：大运 + UI 组装（Week 4a，4 tasks）

### Task 18: dayun port（大运 + 流年）

**Files:**
- Create: `paipan/paipan/dayun.py`
- Create: `paipan/tests/unit/test_dayun.py`

大运用 `lunar-python` 的 `EightChar.getYun()`——和 Node 版的 `ec.getYun()` 对齐。

- [ ] **Step 1: 验证 lunar-python API**

Run:
```bash
uv run --package paipan python -c "
from lunar_python import Solar
s = Solar.fromYmdHms(1990, 5, 15, 10, 30, 0)
ec = s.getLunar().getEightChar()
yun = ec.getYun(1)  # male=1, female=0
print('startSolar:', yun.getStartSolar().toYmd())
print('startYear:', yun.getStartYear())
print('startMonth:', yun.getStartMonth())
print('startDay:', yun.getStartDay())
dayun_list = yun.getDaYun()
print('dayun count:', len(dayun_list))
print('first dayun ganzhi:', dayun_list[0].getGanZhi())
print('second dayun start age:', dayun_list[1].getStartAge())
liunian = dayun_list[1].getLiuNian()
print('liunian count:', len(liunian))
print('first liunian:', liunian[0].getYear(), liunian[0].getGanZhi())
"
```
Expected: 成功输出；`DaYun.getLiuNian()` 返回 10 个流年。若 API 名称不同（如 `getDaYun()` vs `getDaYunList()`），查 `lunar-python` 文档/源码。

- [ ] **Step 2: 写单元测试（红）**

写 `paipan/tests/unit/test_dayun.py`：
```python
from paipan.dayun import compute_dayun


def test_dayun_structure():
    r = compute_dayun(year=1990, month=5, day=15, hour=10, minute=30, gender="male")
    assert "startSolar" in r
    assert "startAge" in r
    assert "startYearsDesc" in r
    assert "list" in r
    assert isinstance(r["list"], list)
    assert len(r["list"]) == 8  # Node 取 slice(1,9) == 8 条


def test_dayun_entry_shape():
    r = compute_dayun(year=1990, month=5, day=15, hour=10, minute=30, gender="male")
    entry = r["list"][0]
    assert "index" in entry
    assert "ganzhi" in entry and len(entry["ganzhi"]) == 2
    assert "startAge" in entry
    assert "startYear" in entry
    assert "endYear" in entry
    assert "liunian" in entry
    assert len(entry["liunian"]) == 10  # 每运 10 流年


def test_dayun_gender_matters():
    male = compute_dayun(year=1990, month=5, day=15, hour=10, minute=30, gender="male")
    female = compute_dayun(year=1990, month=5, day=15, hour=10, minute=30, gender="female")
    # 阳年男顺行 vs 女逆行，第一运 ganzhi 应不同
    assert male["list"][0]["ganzhi"] != female["list"][0]["ganzhi"]
```

- [ ] **Step 3: 运行验证失败**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_dayun.py -v
```
Expected: ImportError。

- [ ] **Step 4: 写实现**

写 `paipan/paipan/dayun.py`：
```python
"""
大运 + 流年计算。对应 paipan.js 中 `ec.getYun(...)` 那一段。
"""
from __future__ import annotations
from typing import Literal
from lunar_python import Solar


def compute_dayun(year: int, month: int, day: int, hour: int, minute: int,
                  gender: Literal["male", "female"]) -> dict:
    solar = Solar.fromYmdHms(year, month, day, hour if hour >= 0 else 12, minute, 0)
    ec = solar.getLunar().getEightChar()
    yun = ec.getYun(1 if gender == "male" else 0)

    start_solar = yun.getStartSolar()
    start_year = yun.getStartYear()
    start_month = yun.getStartMonth()
    start_day = yun.getStartDay()

    # NOTE: from paipan.js:173 — 起运年龄 = 年 + 月/12 + 日/365
    start_age = start_year + start_month / 12.0 + start_day / 365.0

    raw_dayun = yun.getDaYun()
    # NOTE: from paipan.js:175 — slice(1, 9) 跳过第 0 个（虚岁起运前段），取 8 条
    entries = []
    for dy in raw_dayun[1:9]:
        liunian_raw = dy.getLiuNian()
        entries.append({
            "index": dy.getIndex(),
            "ganzhi": dy.getGanZhi(),
            "startAge": dy.getStartAge(),
            "startYear": dy.getStartYear(),
            "endYear": dy.getEndYear(),
            "liunian": [
                {"year": ly.getYear(), "ganzhi": ly.getGanZhi(), "age": ly.getAge()}
                for ly in liunian_raw
            ],
        })

    return {
        "startSolar": start_solar.toYmd(),
        "startAge": start_age,
        "startYearsDesc": f"{start_year}年{start_month}月{start_day}天后起运",
        "list": entries,
    }
```

- [ ] **Step 5: 运行测试**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_dayun.py -v
```
Expected: 3 passed。

- [ ] **Step 6: 提交**

```bash
git add paipan/paipan/dayun.py paipan/tests/unit/test_dayun.py
git commit -m "feat(paipan): port dayun + liunian via lunar-python.EightChar.getYun"
```

---

### Task 19: compute() 主入口 + 管线装配

**Files:**
- Create: `paipan/paipan/compute.py`
- Create: `paipan/paipan/ui.py`
- Modify: `paipan/paipan/__init__.py`
- Create: `paipan/tests/unit/test_compute.py`

- [ ] **Step 1: 写 ui.py（给前端/LLM 的扁平视图）**

读 `paipan-engine/src/ming/analyze.js` 或 server 里怎么组装 `ui` 字段。若 Node 版没有独立 ui 视图（所有字段都直接来自 paipan 顶层），Python 这边就直接把 compute 返回值作为 ui——**不要自己造概念**。

暂时跳过 ui.py 的独立实现，留空。

- [ ] **Step 2: 写 compute.py**

写 `paipan/paipan/compute.py`，**照 `paipan.js` 逐段翻译**：
```python
"""
Paipan main entry. Port of paipan-engine/src/paipan.js.

Processing pipeline:
  1. DST correction
  2. True solar time
  3. Zi hour convention (if late)
  4. Jieqi boundary warning
  5. lunar-python Solar → EightChar → 四柱/十神/藏干/纳音
  6. Dayun + liunian
"""
from __future__ import annotations
from datetime import datetime
from typing import Literal, Optional

from lunar_python import Solar

from paipan.china_dst import correct_china_dst
from paipan.solar_time import to_true_solar_time
from paipan.zi_hour import convert_to_late_zi_convention, check_jieqi_boundary
from paipan.cities import get_city_coords
from paipan.dayun import compute_dayun


def compute(*,
            year: int, month: int, day: int, hour: int, minute: int = 0,
            city: Optional[str] = None,
            longitude: Optional[float] = None,
            gender: Literal["male", "female"],
            ziConvention: Literal["early", "late"] = "early",
            useTrueSolarTime: bool = True,
            _now: Optional[datetime] = None) -> dict:
    """
    Returns a dict matching Node paipan() output schema byte-for-byte.

    _now: injectable "today" for deterministic testing (defaults to real now).
    """
    warnings: list[str] = []
    meta: dict = {
        "input": {"year": year, "month": month, "day": day, "hour": hour, "minute": minute},
        "corrections": [],
    }

    hour_unknown = hour == -1
    h = 12 if hour_unknown else hour
    mi = minute or 0
    y, mo, d = year, month, day

    # Step 1: DST
    if not hour_unknown:
        dst = correct_china_dst(y, mo, d, h, mi)
        if dst["wasDst"]:
            meta["corrections"].append({
                "type": "china_dst",
                "from": f"{y}-{mo}-{d} {h}:{mi}",
                "to": f"{dst['year']}-{dst['month']}-{dst['day']} {dst['hour']}:{dst['minute']}",
            })
            y, mo, d, h, mi = dst["year"], dst["month"], dst["day"], dst["hour"], dst["minute"]
            warnings.append("1986-1991 中国实行过夏令时，已自动减 1 小时。若你不确定当时是否用夏令时，请核对。")

    # Step 2: true solar time
    lng = longitude
    resolved_city = None
    if lng is None and city:
        c = get_city_coords(city)
        if c:
            lng = c.lng
            resolved_city = c.canonical
    if useTrueSolarTime and not hour_unknown and city and lng is None:
        warnings.append(f'未识别城市"{city}"，未做真太阳时修正。可以换个常见行政名（例如"北京"、"长沙"、"苏州"），或在高级选项里关闭"修正真太阳时"。')
        meta["cityUnknown"] = True
    if useTrueSolarTime and not hour_unknown and lng is not None:
        t = to_true_solar_time(y, mo, d, h, mi, lng)
        meta["corrections"].append({
            "type": "true_solar_time",
            "longitude": lng,
            "longitudeMinutes": t["longitudeMinutes"],
            "eotMinutes": t["eotMinutes"],
            "shiftMinutes": t["shiftMinutes"],
            "resolvedCity": resolved_city,
            "from": f"{y}-{mo}-{d} {h}:{mi}",
            "to": f"{t['year']}-{t['month']}-{t['day']} {t['hour']}:{t['minute']}",
        })
        y, mo, d, h, mi = t["year"], t["month"], t["day"], t["hour"], t["minute"]

    # Step 3: late zi
    if not hour_unknown and ziConvention == "late":
        z = convert_to_late_zi_convention(y, mo, d, h, mi)
        if z["converted"]:
            meta["corrections"].append({
                "type": "late_zi",
                "from": f"{y}-{mo}-{d} {h}:{mi}",
                "to": f"{z['year']}-{z['month']}-{z['day']} {z['hour']}:{z['minute']}",
            })
            y, mo, d, h, mi = z["year"], z["month"], z["day"], z["hour"], z["minute"]

    # Step 4: jieqi boundary
    if not hour_unknown:
        jq = check_jieqi_boundary(y, mo, d, h, mi)
        if jq["isNearBoundary"]:
            warnings.append(jq["hint"])
        meta["jieqiCheck"] = jq

    # Step 5: eight char via lunar-python
    solar = Solar.fromYmdHms(y, mo, d, h, mi, 0)
    lunar = solar.getLunar()
    ec = lunar.getEightChar()

    result: dict = {
        "sizhu": {
            "year": ec.getYear(),
            "month": ec.getMonth(),
            "day": ec.getDay(),
            "hour": None if hour_unknown else ec.getTime(),
        },
        "rizhu": ec.getDayGan(),
        "shishen": {
            "year": ec.getYearShiShenGan(),
            "month": ec.getMonthShiShenGan(),
            "hour": None if hour_unknown else ec.getTimeShiShenGan(),
        },
        "cangGan": {
            "year": ec.getYearHideGan(),
            "month": ec.getMonthHideGan(),
            "day": ec.getDayHideGan(),
            "hour": None if hour_unknown else ec.getTimeHideGan(),
        },
        "naYin": {
            "year": ec.getYearNaYin(),
            "month": ec.getMonthNaYin(),
            "day": ec.getDayNaYin(),
            "hour": None if hour_unknown else ec.getTimeNaYin(),
        },
        "dayun": {},  # 下方 step 6 填
        "lunar": str(lunar),
        "solarCorrected": f"{y}-{mo:02d}-{d:02d} {h:02d}:{mi:02d}",
        "warnings": warnings,
        "meta": meta,
        "hourUnknown": hour_unknown,
    }

    # Step 6: today's GZ（固定可注入 _now 用于测试确定性）
    now = _now or datetime.now()
    today_solar = Solar.fromYmdHms(now.year, now.month, now.day, 12, 0, 0)
    today_ec = today_solar.getLunar().getEightChar()
    result["todayYearGz"] = today_ec.getYear()
    result["todayMonthGz"] = today_ec.getMonth()
    result["todayDayGz"] = today_ec.getDay()
    result["todayYmd"] = f"{now.year}-{now.month:02d}-{now.day:02d}"

    # Step 7: dayun
    result["dayun"] = compute_dayun(year=y, month=mo, day=d,
                                    hour=h, minute=mi, gender=gender)

    return result
```

- [ ] **Step 3: 更新 `__init__.py` 导出 compute**

更新 `paipan/paipan/__init__.py`：
```python
from paipan.constants import VERSION
from paipan.types import BirthInput, City, Gender, ZiConvention
from paipan.cities import get_city_coords
from paipan.compute import compute

__all__ = ["VERSION", "BirthInput", "City", "Gender", "ZiConvention",
           "get_city_coords", "compute"]
```

- [ ] **Step 4: 写 compute 单元测试**

写 `paipan/tests/unit/test_compute.py`：
```python
from datetime import datetime
from paipan import compute

FIXED_NOW = datetime(2026, 4, 17, 12, 0, 0)  # 匹配 dump-oracle.js 的 mock 时间


def test_compute_smoke():
    r = compute(year=1990, month=5, day=15, hour=10, minute=30,
                city="北京", gender="male", useTrueSolarTime=True, _now=FIXED_NOW)
    assert "sizhu" in r
    assert len(r["sizhu"]["year"]) == 2
    assert r["hourUnknown"] is False
    assert len(r["dayun"]["list"]) == 8


def test_compute_hour_unknown():
    r = compute(year=1990, month=5, day=15, hour=-1, minute=0,
                city="上海", gender="female", useTrueSolarTime=True, _now=FIXED_NOW)
    assert r["hourUnknown"] is True
    assert r["sizhu"]["hour"] is None
    assert len(r["dayun"]["list"]) == 8  # 大运仍有


def test_compute_mao_zedong():
    # 毛泽东 1893-12-26 辰时，族谱"癸巳 甲子 丁酉 甲辰"
    r = compute(year=1893, month=12, day=26, hour=8, minute=0,
                gender="male", useTrueSolarTime=False, _now=FIXED_NOW)
    assert r["sizhu"]["year"] == "癸巳"
    assert r["sizhu"]["month"] == "甲子"
    assert r["sizhu"]["day"] == "丁酉"
    assert r["sizhu"]["hour"] == "甲辰"
```

- [ ] **Step 5: 运行测试**

Run:
```bash
uv run --package paipan pytest paipan/tests/unit/test_compute.py -v
```
Expected: 3 passed。

若某个断言失败，从 `deep_diff` 输出定位具体字段，回到对应模块修 bug（不改测试）。

- [ ] **Step 6: 提交**

```bash
git add paipan/paipan/compute.py paipan/paipan/__init__.py paipan/tests/unit/test_compute.py
git commit -m "feat(paipan): compute() main entry wiring full pipeline"
```

---

### Task 20: 解决 dump-oracle.js 与 compute 的 "now" 一致性问题

**Files:**
- Modify: `paipan/tests/regression/test_regression.py`

Node `dump-oracle.js` 用 2026-04-17 12:00:00 CST 作为 mock"今天"；Python `compute()` 必须在回归测试里接受同一个 `_now`，否则 `todayYearGz` 永远 diff。

- [ ] **Step 1: 更新 regression runner 注入固定 now**

修改 `paipan/tests/regression/test_regression.py`——在调用 compute 处注入 `_now`：
```python
from __future__ import annotations
import json
import pathlib
from datetime import datetime
import pytest

from paipan.tests.regression.deep_diff import deep_diff, format_diff

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"
ORACLE_NOW = datetime(2026, 4, 17, 12, 0, 0)


def _load_fixtures() -> list[pathlib.Path]:
    return sorted(FIXTURES_DIR.glob("*.json"))


@pytest.mark.parametrize("fixture_path", _load_fixtures(), ids=lambda p: p.stem)
def test_regression(fixture_path: pathlib.Path) -> None:
    data = json.loads(fixture_path.read_text(encoding="utf-8"))
    case_id = data["case_id"]
    birth_input = dict(data["birth_input"])
    expected = data["expected"]

    from paipan import compute
    actual = compute(**birth_input, _now=ORACLE_NOW)

    diffs = deep_diff(actual, expected, float_tolerance=1e-9)
    if diffs:
        pytest.fail(f"Regression diff for {case_id}:\n{format_diff(diffs)}")
```

- [ ] **Step 2: 跑一次回归对拍（预期很多 diff）**

Run:
```bash
uv run --package paipan pytest paipan/tests/regression/test_regression.py -v 2>&1 | tail -40
```
Expected: 50 个用例，大量失败（字段细节差异），**这是预期的**——下一 task 进入迭代修复。

如果 0 失败，那说明你的 port 极其细心，直接进 Task 21（边界扩展）。

- [ ] **Step 3: 提交**

```bash
git add paipan/tests/regression/test_regression.py
git commit -m "test(paipan): inject fixed 'now' into regression runner to match oracle"
```

---

### Task 21: 对拍到全绿（迭代修 diff）

**Files:** 各模块文件（按 diff 定位修改）

这一步**不是一次 commit**，而是一个**迭代过程**——每个失败用例都查 diff 报告定位字段 → 回到对应模块改代码 → 重跑 → 提交一小步。

- [ ] **Step 1: 跑全部回归，生成详细报告**

Run:
```bash
uv run --package paipan pytest paipan/tests/regression/test_regression.py -v 2>&1 | tee /tmp/regression-report.txt
grep FAIL /tmp/regression-report.txt | head -10
```
查看前几个失败用例的完整 diff。

- [ ] **Step 2: 按 diff 频次分类**

手工统计：哪些字段 diff 出现最多？常见：
- `sizhu.*` diff → 时间换算（DST/真太阳时/子时）
- `shishen.*` diff → lunar-python 与 lunar-javascript 的 setSect 差异
- `cangGan.*` diff → 藏干方法差异（lunar-python 是否是 list 而不是逗号拼接字符串）
- `dayun.list[*].liunian[*].*` diff → 流年字段名差异
- `todayYearGz` diff → now 注入问题
- `meta.jieqiCheck.deltaMinutes` 浮点精度
- `warnings[*]` 中文文案差异

- [ ] **Step 3: 按字段族定位并修**

对每类 diff：
1. 读对应模块（`compute.py` / `dayun.py` / `zi_hour.py`）
2. 和 Node 源码字面对比该字段的生成逻辑
3. 修 Python 实现使之一致
4. 重跑**整批**回归，确认修一处没把别处弄坏
5. 每修复一类做一次 commit

每类 diff 一个 commit，典型 commit message：
```
fix(paipan): align sizhu.hour late-zi day-change with Node
fix(paipan): cangGan arrays vs comma strings
fix(paipan): liunian entry shape
fix(paipan): jieqi hint wording matches Node
```

- [ ] **Step 4: 直到全绿**

重复直到：
```bash
uv run --package paipan pytest paipan/tests/regression/test_regression.py
```
输出 `50 passed`。

- [ ] **Step 5: 最终提交对齐记录**

```bash
git add -A
git commit -m "fix(paipan): full oracle regression passing (50 cases)"
```

**预期耗时**：2-5 天。这一步把所有底层 bug 逼出来。

---

## Phase E：扩展到 300+ 全覆盖（Week 4b，3 tasks）

### Task 22: 扩展 birth_inputs.json 到 300+

**Files:**
- Modify: `paipan/tests/regression/birth_inputs.json`
- Create: `paipan/tests/regression/fixtures/*.json`（新增）

按 spec Section 8.4 的类别覆盖扩展到至少 300 条。

- [ ] **Step 1: 按类别扩展**

编辑 `paipan/tests/regression/birth_inputs.json`，在现有 50 条基础上补充到至少 300 条，每类达到 spec 要求：

| 类别 | 目标总数 | 当前 | 需补 |
|---|---|---|---|
| 节气切换前后 | 60 | 5 | 55 |
| 子时跨日 | 40 | 5 | 35 |
| 夏令时期 1986-1991 | 30 | 5 | 25 |
| 时区边界（西部） | 20 | 5 | 15 |
| 海外 | 10 | 0 | 10 |
| 闰月 | 20 | 2 | 18 |
| 五行/格局 | 40 | 0 | 40 |
| 格局 | 40 | 0 | 40 |
| 极端大运 | 20 | 5 | 15 |
| 随机采样 | 20 | 0 | 20 |
| 其他（basic/female/hour-unknown/misc） | 20 | 23 | 0（已超） |
| **合计** | **320** | **50** | **270** |

节气 case 生成的 helper（**写在 `paipan/tests/regression/expand_inputs.py`** 然后运行一次）：
```python
"""One-shot script to expand birth_inputs.json. Not a test."""
import json
import random
import pathlib
from lunar_python import Solar

OUT = pathlib.Path(__file__).parent / "birth_inputs.json"

existing = json.loads(OUT.read_text())

# 节气前后 ±5 分钟，每个 2024 节气 5 条
JIEQI_2024 = [
    # (name, y, m, d, h, mi) — 手工查表或从 lunar-python 取
    ("立春", 2024, 2, 4, 16, 27),
    ("雨水", 2024, 2, 19, 12, 13),
    ("惊蛰", 2024, 3, 5, 10, 23),
    ("春分", 2024, 3, 20, 11, 6),
    ("清明", 2024, 4, 4, 15, 2),
    ("谷雨", 2024, 4, 19, 21, 59),
    ("立夏", 2024, 5, 5, 8, 10),
    ("小满", 2024, 5, 20, 20, 59),
    ("芒种", 2024, 6, 5, 12, 10),
    ("夏至", 2024, 6, 21, 4, 51),
    ("小暑", 2024, 7, 6, 22, 20),
    ("大暑", 2024, 7, 22, 15, 44),
]
seq = 100
for name, y, m, d, h, mi in JIEQI_2024:
    for delta in (-3, -1, 0, 2, 5):
        nh, nm = h, mi + delta
        if nm < 0: nh -= 1; nm += 60
        if nm >= 60: nh += 1; nm -= 60
        existing.append({
            "case_id": f"jieqi-{seq:03d}-{name}-{delta:+d}min",
            "birth_input": {"year": y, "month": m, "day": d, "hour": nh, "minute": nm,
                            "city": "北京", "gender": "male" if seq % 2 else "female",
                            "useTrueSolarTime": False},
        })
        seq += 1

# 子时跨日 - 覆盖 23:xx 和 00:xx，每个日期两种子时派
ZI_DATES = [(2024, m, 15) for m in range(1, 13)] + [(2024, 6, d) for d in (1, 10, 20, 30)]
seq = 100
for y, m, d in ZI_DATES:
    for h_mi in [(23, 5), (23, 30), (23, 55), (0, 5), (0, 30)]:
        for conv in ("early", "late"):
            existing.append({
                "case_id": f"zi-{seq:03d}-{y}{m:02d}{d:02d}-{h_mi[0]:02d}{h_mi[1]:02d}-{conv}",
                "birth_input": {"year": y, "month": m, "day": d,
                                "hour": h_mi[0], "minute": h_mi[1],
                                "city": "北京", "gender": "male",
                                "ziConvention": conv, "useTrueSolarTime": False},
            })
            seq += 1

# DST 1986-1991
for y in (1986, 1987, 1988, 1989, 1990, 1991):
    for (m, d) in [(5, 10), (6, 15), (7, 15), (8, 15), (9, 10)]:
        existing.append({
            "case_id": f"dst-{y}{m:02d}{d:02d}",
            "birth_input": {"year": y, "month": m, "day": d, "hour": 10, "minute": 0,
                            "city": "北京", "gender": "male", "useTrueSolarTime": True},
        })

# 西部城市
WESTERN = ["乌鲁木齐", "喀什", "拉萨", "西宁", "兰州", "昆明", "成都", "重庆"]
seq = 100
for city in WESTERN:
    for (y, m, d, h) in [(1990, 5, 15, 10), (2000, 10, 20, 14), (1985, 1, 5, 6)]:
        existing.append({
            "case_id": f"tz-{seq:03d}-{city}-{y}{m:02d}{d:02d}-{h:02d}",
            "birth_input": {"year": y, "month": m, "day": d, "hour": h, "minute": 0,
                            "city": city, "gender": "male", "useTrueSolarTime": True},
        })
        seq += 1

# 海外（无 city，直接 longitude）
OVERSEAS = [
    ("Tokyo", 139.77), ("Bangkok", 100.50), ("Singapore", 103.82),
    ("Seoul", 126.98), ("London", -0.12), ("New York", -74.00),
    ("Sydney", 151.21), ("Paris", 2.35), ("Moscow", 37.62), ("Dubai", 55.30),
]
seq = 100
for name, lng in OVERSEAS:
    existing.append({
        "case_id": f"oversea-{seq:03d}-{name.replace(' ','_')}",
        "birth_input": {"year": 1995, "month": 7, "day": 15, "hour": 14, "minute": 0,
                        "longitude": lng, "gender": "female", "useTrueSolarTime": True},
    })
    seq += 1

# 闰月相关（农历闰月发生在以下年份；用公历日期覆盖闰月及非闰月各几条）
LEAP = [2020, 2023, 2017, 2014, 2012]  # 闰 4 月等
seq = 100
for y in LEAP:
    for m in (4, 5, 6):
        for d in (10, 20):
            existing.append({
                "case_id": f"leap-{seq:03d}-{y}{m:02d}{d:02d}",
                "birth_input": {"year": y, "month": m, "day": d, "hour": 12, "minute": 0,
                                "city": "北京", "gender": "male", "useTrueSolarTime": False},
            })
            seq += 1

# 五行/格局覆盖：用随机 seed 生成 80 个
random.seed(42)
seq = 100
CITIES = ["北京", "上海", "广州", "成都", "西安", "武汉", "南京", "杭州"]
for _ in range(80):
    y = random.randint(1950, 2020)
    m = random.randint(1, 12)
    d = random.randint(1, 28)
    h = random.randint(0, 23)
    mi = random.randint(0, 59)
    city = random.choice(CITIES)
    gender = random.choice(["male", "female"])
    existing.append({
        "case_id": f"wuxing-{seq:03d}-{y}{m:02d}{d:02d}-{h:02d}{mi:02d}",
        "birth_input": {"year": y, "month": m, "day": d, "hour": h, "minute": mi,
                        "city": city, "gender": gender, "useTrueSolarTime": True},
    })
    seq += 1

# 极端大运（跨阴阳年 + 跨阴阳性别 全组合）
seq = 100
for y in (1984, 1985, 1990, 1991):  # 阳甲子/阴乙丑 / 阳庚午/阴辛未
    for gender in ("male", "female"):
        for (m, d, h) in [(3, 5, 14), (7, 20, 9), (11, 11, 23)]:
            existing.append({
                "case_id": f"dayun-{seq:03d}-{y}-{m:02d}{d:02d}-{gender}",
                "birth_input": {"year": y, "month": m, "day": d, "hour": h, "minute": 15,
                                "city": "北京", "gender": gender, "useTrueSolarTime": False},
            })
            seq += 1

# 随机采样 20
seq = 100
for _ in range(20):
    y = random.randint(1920, 2030)
    m = random.randint(1, 12)
    d = random.randint(1, 28)
    h = random.randint(0, 23)
    mi = random.randint(0, 59)
    existing.append({
        "case_id": f"random-{seq:03d}-{y}{m:02d}{d:02d}-{h:02d}{mi:02d}",
        "birth_input": {"year": y, "month": m, "day": d, "hour": h, "minute": mi,
                        "city": random.choice(CITIES),
                        "gender": random.choice(["male", "female"]),
                        "useTrueSolarTime": random.choice([True, False])},
    })
    seq += 1

# 去重（按 case_id）
seen = set(); out = []
for item in existing:
    if item["case_id"] in seen: continue
    seen.add(item["case_id"]); out.append(item)

OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))
print(f"Total cases: {len(out)}")
```

- [ ] **Step 2: 跑扩展脚本**

Run:
```bash
uv run --package paipan python paipan/tests/regression/expand_inputs.py
```
Expected: 输出 `Total cases: 300+`（具体数视随机 + 去重）。

- [ ] **Step 3: 重新生成 oracle fixtures**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis/paipan-engine
# 清掉旧 fixture
rm -rf ../paipan/tests/regression/fixtures/*.json
node scripts/dump-oracle.js \
  ../paipan/tests/regression/birth_inputs.json \
  ../paipan/tests/regression/fixtures/
ls ../paipan/tests/regression/fixtures/ | wc -l
```
Expected: `Done: 300+ ok, 0 failed.`；fixture 数量对应。

若 Node 版在某些边界 case **自己炸了**（throw 或输出缺字段），有两种选择：
1. **从 birth_inputs 删掉这条**（该组合 Node 本身不支持，Python 也不需要支持）
2. **标记为 `xfail`**（Node 已知 bug，port 阶段保持一致）

选项 1 优先——保持 fixture 集合是"Node 全绿"的。

- [ ] **Step 4: 跑回归，预期部分 diff**

Run:
```bash
uv run --package paipan pytest paipan/tests/regression/test_regression.py 2>&1 | tail -5
```

因为扩展的 fixture 可能触碰之前 50 条没覆盖的 edge case，**可能有新 diff**。

- [ ] **Step 5: 提交当前状态**

```bash
git add paipan/tests/regression/birth_inputs.json \
        paipan/tests/regression/fixtures/ \
        paipan/tests/regression/expand_inputs.py
git commit -m "test(paipan): expand regression corpus to 300+ cases"
```

---

### Task 23: 对拍到 300+ 全绿（第二轮 diff 修复）

**Files:** 按 diff 定位修改

同 Task 21，对新增 fixture 暴露的 diff 做迭代修复。

- [ ] **Step 1: 识别未覆盖到的逻辑分支**

Run:
```bash
uv run --package paipan pytest paipan/tests/regression/test_regression.py -v 2>&1 | grep FAIL | head -20
```

常见第二轮暴露的问题：
- 闰月月柱处理
- 海外时区（有些 Asia/* 外的 longitude 负值）
- 1920 年前的 DST 和时区
- 子时跨月/跨年
- 随机生成的非典型格局导致 ge_ju 走到从未测试过的分支

- [ ] **Step 2-N: 按类别迭代修复**

每类 diff 一个独立 commit。直到：
```bash
uv run --package paipan pytest paipan/tests/regression/test_regression.py 2>&1 | tail -1
```
显示 `300+ passed`（或 300+ passed + 若干明确标 xfail 的 Node 已知 bug）。

**预期耗时**：3-5 天。

- [ ] **Step N+1: 最终提交**

```bash
git add -A
git commit -m "fix(paipan): full 300+ oracle regression passing"
```

---

### Task 24: CI 配置 + 加速

**Files:**
- Create: `.github/workflows/paipan-ci.yml`（如用 GitHub）或 `paipan/Makefile`

- [ ] **Step 1: 写 CI 配置**

写 `.github/workflows/paipan-ci.yml`：
```yaml
name: paipan tests

on:
  push:
    paths: ['paipan/**', 'pyproject.toml']
  pull_request:
    paths: ['paipan/**', 'pyproject.toml']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - name: install python
        run: uv python install 3.12
      - name: sync deps
        run: uv sync --package paipan
      - name: run tests in parallel
        run: uv run --package paipan pytest paipan/tests/ -n auto
```

- [ ] **Step 2: 本地验证并行运行**

Run:
```bash
uv run --package paipan pytest paipan/tests/ -n auto 2>&1 | tail -3
time uv run --package paipan pytest paipan/tests/ 2>&1 | tail -1
```
Expected: 并行版本耗时 < 30s（单核也应 < 60s）。

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/paipan-ci.yml
git commit -m "ci(paipan): GitHub Actions with parallel pytest"
```

---

## Phase F：验收 + 归档（Week 5，3 tasks）

### Task 25: 包构建验证

- [ ] **Step 1: 从干净环境构建 wheel**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis
uv build --package paipan
ls dist/*.whl
```
Expected: 生成 `dist/paipan-0.1.0-py3-none-any.whl`。

- [ ] **Step 2: 在隔离 venv 里安装并测试 import**

Run:
```bash
python3 -m venv /tmp/paipan-smoke
/tmp/paipan-smoke/bin/pip install dist/paipan-0.1.0-py3-none-any.whl
/tmp/paipan-smoke/bin/python -c "
from paipan import compute
r = compute(year=1990, month=5, day=15, hour=10, minute=30,
            city='北京', gender='male')
print(r['sizhu'])
"
rm -rf /tmp/paipan-smoke dist/
```
Expected: 打印出 `{'year': '...', 'month': '...', 'day': '...', 'hour': '...'}`。

- [ ] **Step 3: 提交（无改动则跳过）**

若有临时文件未删，清掉；实际一般无需 commit。

---

### Task 26: 冻结 Node oracle + 归档

**Files:**
- 无新文件；归档操作

- [ ] **Step 1: 给 Node 仓库打 tag（如果是 git repo）**

Run:
```bash
cd /Users/veko/code/usual/bazi-analysis
# 若不是 git repo，先 git init（见 Task 1 Step 6）
git tag -a paipan-engine-oracle-v1 -m "Frozen Node paipan-engine as Python port oracle"
```

- [ ] **Step 2: 挪到 archive/**

Run:
```bash
mkdir -p archive
git mv paipan-engine archive/paipan-engine
```

- [ ] **Step 3: 更新 paipan/README.md 标注 oracle 冻结**

Edit `paipan/README.md`：
```markdown
## Oracle

Oracle implementation frozen at tag `paipan-engine-oracle-v1`,
archived at `archive/paipan-engine/`.
Any change requires regenerating fixtures via `scripts/dump-oracle.js`.
```

- [ ] **Step 4: 提交**

```bash
git add archive/ paipan/README.md
git commit -m "chore(paipan): archive Node engine as frozen oracle"
```

---

### Task 27: 完成定义 Checklist + 验收

**Files:**
- Create: `paipan/ACCEPTANCE.md`

- [ ] **Step 1: 写验收文档**

写 `paipan/ACCEPTANCE.md`：
```markdown
# paipan Python Port — Acceptance Checklist

执行者填表，逐条打勾。任何一条不过不合并。

- [ ] 300+ fixture 回归对拍 0 失败
  - 命令：`uv run --package paipan pytest paipan/tests/regression/ 2>&1 | tail -1`
  - 应显示：`N passed`（N ≥ 300）
- [ ] 单元测试覆盖率 > 85%
  - 命令：`uv run --package paipan pytest --cov=paipan paipan/tests/unit/ 2>&1 | tail -5`
  - 应显示：`TOTAL ... 85%+`
- [ ] CI 运行时间 < 30s
  - 命令：`time uv run --package paipan pytest paipan/tests/ -n auto`
  - `real` 应 < 30 秒
- [ ] wheel 可装
  - 命令：Task 25 步骤复现 → 打印 sizhu 成功
- [ ] 集成烟测：改一份 server 里用 paipan 的代码 import Python 版并人工 check 5 张盘
  - （本 plan 范围内只验证包本身；server 集成属于另一 plan）
- [ ] Node 仓库打 tag `paipan-engine-oracle-v1` 并归档到 `archive/`
- [ ] 10 个核心 edge case 每个 ≥ 5 fixture 覆盖
  - 手工 audit `birth_inputs.json` 的 case_id 命名前缀频次：
    ```bash
    jq -r '.[].case_id' paipan/tests/regression/birth_inputs.json | \
      sed 's/-.*//' | sort | uniq -c
    ```
  - 每类前缀数量应 ≥ 5

## Edge Case 覆盖证明

| Edge case | 前缀 | 数量 | 检查 |
|---|---|---|---|
| 早晚子时派 | zi- | ≥ 40 | ✅ 早/晚 × 12 月 × 多时刻 |
| 节气切换 | jieqi- | ≥ 60 | ✅ 12 节气 × ±5 分钟 |
| 1986-1991 DST | dst- | ≥ 30 | ✅ 6 年 × 5 日期 |
| 真太阳时负偏移 | tz-, oversea- | ≥ 20 | ✅ 西部 + 海外 |
| 子时跨日的日柱 | zi- | ≥ 40 | ✅ 同上 |
| 闰月月柱 | leap- | ≥ 18 | ✅ 5 年 × 3 月 × 2 日 |
| 起运年龄 float | dayun- | ≥ 20 | ✅ 阴阳年 × 阴阳性别 × 3 时段 |
| 顺逆行大运 | dayun- | 同上 | ✅ |
| 藏干余气 | wuxing-, basic- | ≥ 40 | ✅ |
| 天干合化 | wuxing- | ≥ 10 | ✅（随机样本统计） |
```

- [ ] **Step 2: 逐条打勾验证**

手工执行 Step 1 里的每条命令，确认全过。

- [ ] **Step 3: 提交**

```bash
git add paipan/ACCEPTANCE.md
git commit -m "docs(paipan): acceptance checklist and edge-case coverage proof"
```

---

## Plan 1 终点

到此 Plan 1 完成。产出物：
- `paipan/`：独立 Python 包，`uv build` 可打 wheel
- 300+ 回归 fixture 全绿
- 所有模块有单测，覆盖率 > 85%
- `archive/paipan-engine/` 冻结 Node oracle
- `paipan/ACCEPTANCE.md` 验收证明

下一个 plan：**Plan 2 - Backend Foundation**（FastAPI 骨架 + DB + 加密层）。

---

## 执行选项

Plan complete and saved to `docs/superpowers/plans/2026-04-17-paipan-python-port.md`. Two execution options:

**1. Subagent-Driven（推荐）** — 我每 task 派一个新 subagent 执行，中间 review，快节奏迭代

**2. Inline Execution** — 在当前 session 里用 executing-plans 批量执行，中间设 checkpoint

**Which approach?**
