# 排盘 + 命理引擎 v0.2

两层结构：**排盘层**（钟表时间 → 四柱）+ **命理层**（四柱 → 结构化分析对象）。

## 结构

```
src/
  排盘层（lunar-javascript 封装）
    solarTime.js       真太阳时 + 均时差修正（Meeus 公式）
    chinaDst.js        1986-1991 中国夏令时规则表
    ziHourAndJieqi.js  子时派转换 + 节气交界检测
    cities.js          城市经纬度表（40+ 初始城市）
    paipan.js          主排盘入口

  命理层（子平真诠 + BaZi skill 规则翻译）
    ming/ganzhi.js     天干地支五行/阴阳/生克/月令/四仲四孟四库
    ming/cangGan.js    地支藏干（本气/中气/余气 + 权重）
    ming/shishen.js    十神映射（阴阳配 × 五行关系）
    ming/heKe.js       天干五合 / 地支六合/六冲/三合/三会/半合
    ming/liLiang.js    力量擂台（透干/得令/根/合克 四维度评分）
    ming/geJu.js       格局识别（四仲/四孟/四库 + 建禄月劫格）
    ming/analyze.js    命理层主入口，产出结构化分析 + LLM guardrails

test.js              排盘层测试（毛泽东 + 边界）
test3.js             命理层测试（格局/身强弱/注意事项）
```

## 使用

```js
const { paipan } = require('./src/paipan');

const result = paipan({
  year: 1995, month: 6, day: 15, hour: 14, minute: 30,
  city: '上海',
  gender: 'male',
  ziConvention: 'early',    // 'early' (默认) | 'late'
  useTrueSolarTime: true,   // 默认 true
});
```

## 输出

```
{
  sizhu: { year, month, day, hour },
  rizhu: '丁',
  shishen: { year, month, hour },
  cangGan: { year, month, day, hour },
  naYin: { year, month, day, hour },
  dayun: { startSolar, startYearsDesc, list: [...] },
  lunar: '一九九五年五月十八',
  solarCorrected: '1995-06-15 14:35',
  warnings: [],       // 向用户展示的提醒
  meta: {             // 所有校正详情，供调试
    input: {...},
    corrections: [...],
    jieqiCheck: {...}
  },
  hourUnknown: false
}
```

## 命理层使用

```js
const { paipan } = require('./src/paipan');
const { analyze } = require('./src/ming/analyze');

const p = paipan({ year: 1893, month: 12, day: 26, hour: 8, minute: 0, gender: 'male', useTrueSolarTime: false });
const a = analyze(p);

// a.force.dayStrength       身强/身弱/中和
// a.force.pairs             正/偏对子（防类型 A bug）
// a.force.relations         日主与各十神的合/克/生（防类型 F）
// a.geJu.mainCandidate      主格局
// a.notes                   自动生成的 LLM guardrails
```

## 已验证通过

**排盘层**
- ✅ 毛泽东 1893-12-26 辰时 → 癸巳 甲子 丁酉 甲辰（族谱记载精准匹配）
- ✅ 1988 夏令时期间自动减 1 小时并警告
- ✅ 立春前 7 分钟产生节气交界提示
- ✅ 早子时派 / 晚子时派正确切换
- ✅ 未知时辰仍能算大运

**命理层**
- ✅ 毛泽东盘：七杀格（子月癸透）、中和 42%、七杀 10 / 正印 8.4
- ✅ 构造身弱七杀盘：身弱 26%、月刃格
- ✅ 四库月辰无透干：正确输出"格局不清"
- ✅ 四孟月寅：只有戊（余气）透干时，仍以甲（本气）定偏财格，戊作次要候选
- ✅ 正/偏混淆 / 食伤替代通道 / 日主合财 / 地支冲 等 guardrail 自动生成

## 跑测试

```bash
npm install
node test.js    # 排盘层
node test3.js   # 命理层
```
