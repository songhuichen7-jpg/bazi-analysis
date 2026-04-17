# Gua UX + Sections Tone Upgrade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move 起卦 from a permanent panel into the chat flow as an intent-triggered CTA + inline card; upgrade all shard prompts with a half-classical tone spec that makes Sections feel like a person, not a report.

**Architecture:**
- Gua goes inline: when the server detects divination intent it sends a `redirect` event → Chat replaces the empty assistant bubble with a `{role:'cta'}` entry → user clicks → `castGuaInline()` calls `/api/gua` and streams the result directly into chatHistory as a `{role:'gua'}` card.
- Manual trigger: small icon button next to chat input pushes a `{role:'cta', manual:true}` entry with an editable question field.
- Tone upgrade: new 笔调规范 section in `shards/core.md` + good/bad opening examples added to each intent shard. No code changes—pure markdown.

**Tech Stack:** React (Zustand store), Vite, Node HTTP server, SSE streaming via `streamSSE`. Shard files are plain Markdown consumed by `prompts.js` via `skillLoaded()`.

**Two subsystems are independent and can be done in parallel:**
- Tasks 1–5 → Gua UX (frontend + store)
- Tasks 6–10 → Tone upgrade (markdown only)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/components/GuaCard.jsx` | **Create** | Pure display: symbol, name, guaci/daxiang, interpretation body |
| `frontend/src/components/Chat.jsx` | **Modify** | Remove `<Gua/>`, add CTA + gua rendering, add manual icon button, add `castGuaInline` |
| `frontend/src/store/useAppStore.js` | **Modify** | Add `replacePlaceholderWithCta`, `pushGuaCard`, `updateLastGuaCard` actions |
| `frontend/src/components/Gua.jsx` | **Keep** | No changes — just no longer imported by Chat |
| `server/server.js` | **No change** | `/api/gua` endpoint stays as-is |
| `server/prompts.js` | **No change** | Router + divination keywords already work |
| `shards/core.md` | **Modify** | Add 笔调规范 chapter |
| `shards/personality.md` | **Modify** | Add 好/坏开头示范 |
| `shards/relationship.md` | **Modify** | Add 好/坏开头示范 |
| `shards/wealth.md` | **Modify** | Add 好/坏开头示范 |
| `shards/career.md` | **Modify** | Add 好/坏开头示范 |
| `shards/timing.md` | **Modify** | Add 好/坏开头示范 |
| `shards/health.md` | **Modify** | Add 好/坏开头示范 |
| `shards/appearance.md` | **Modify** | Add 好/坏开头示范 |
| `shards/meta.md` | **Modify** | Add 好/坏开头示范 |

---

## Task 1: GuaCard.jsx — pure display component

**Files:**
- Create: `frontend/src/components/GuaCard.jsx`

**Data shape it receives** (from chatHistory `content` field):
```js
{
  symbol: '☰',        // Unicode hexagram
  name: '乾为天',
  upper: '乾',
  lower: '乾',
  drawnAt: '2026-04-15 14:32:08',
  guaci: '乾，元亨利贞。',
  daxiang: '天行健，君子以自强不息。',
  question: '我今年换工作合适吗？',
  body: '...streamed interpretation...',
  streaming: false,   // true while SSE is still running
  ts: 1713167528000,
}
```

- [ ] **Step 1: Create GuaCard.jsx**

```jsx
import { RichText } from './RefChip';

export default function GuaCard({ data }) {
  if (!data) return null;
  const { symbol, name, upper, lower, drawnAt, guaci, daxiang, question, body, streaming } = data;

  return (
    <div className="gua-card">
      {question && (
        <div className="gua-card-question">
          「{question}」的卦象
        </div>
      )}
      <div className="gua-card-header">
        <span className="gua-card-symbol">{symbol}</span>
        <div>
          <div className="serif" style={{ fontSize: 18 }}>{name}</div>
          <div className="muted" style={{ fontSize: 11 }}>上{upper} · 下{lower}</div>
          {drawnAt && <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{drawnAt}</div>}
        </div>
      </div>
      <div className="gua-card-texts">
        <div><b>卦辞：</b>{guaci}</div>
        <div style={{ marginTop: 4 }}><b>大象：</b>{daxiang}</div>
      </div>
      <div className="gua-card-body">
        {body
          ? <RichText text={body} />
          : <span className="muted">{streaming ? '生成中…' : ''}</span>
        }
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS in frontend/src/index.css (or app.css — wherever global styles live)**

First check which CSS file to use:
```bash
ls frontend/src/*.css
```

Add these rules:
```css
.gua-card {
  border: 1px solid #d4c5a9;
  background: #fffdf7;
  padding: 14px 16px;
  border-radius: 4px;
  margin: 4px 0;
}
.gua-card-question {
  font-size: 12px;
  color: #888;
  margin-bottom: 8px;
}
.gua-card-header {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 8px;
}
.gua-card-symbol {
  font-size: 48px;
  line-height: 1;
}
.gua-card-texts {
  font-size: 12px;
  font-family: "Songti SC", serif;
  background: #f7f3e9;
  padding: 8px 10px;
  border-left: 2px solid #b99;
}
.gua-card-body {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.9;
  white-space: pre-wrap;
}
```

- [ ] **Step 3: Verify GuaCard renders without errors**

```bash
cd /Users/veko/code/usual/bazi-analysis/frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds (GuaCard is not imported anywhere yet, just needs to parse).

---

## Task 2: Store — three new actions

**Files:**
- Modify: `frontend/src/store/useAppStore.js`

The store currently has `replaceLastAssistant` (line 196). We need three more actions:

1. `replacePlaceholderWithCta(question, manual)` — changes the last `role:'assistant'` entry to `{role:'cta', content:{question, manual}}`
2. `pushGuaCard(guaData)` — appends `{role:'gua', content:{...guaData, streaming:true}}` to chatHistory
3. `updateLastGuaCard(body)` — finds the last `role:'gua'` entry and updates `content.body`; if `body` is `null`, sets `streaming:false` (finalize signal)

- [ ] **Step 1: Add actions after `replaceLastAssistant` (line ~202 in useAppStore.js)**

Open `frontend/src/store/useAppStore.js`. After the `replaceLastAssistant` action, add:

```js
  replacePlaceholderWithCta: (question, manual = false) => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'assistant') {
        arr[i] = { role: 'cta', content: { question, manual } };
        break;
      }
    }
    return { chatHistory: arr };
  }),

  pushGuaCard: (guaData) => set(s => ({
    chatHistory: appendChatMessage(s.chatHistory, {
      role: 'gua',
      content: { ...guaData, streaming: true },
    }),
  })),

  updateLastGuaCard: (body, finalize = false) => set(s => {
    const arr = s.chatHistory.slice();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === 'gua') {
        arr[i] = {
          ...arr[i],
          content: {
            ...arr[i].content,
            body,
            streaming: finalize ? false : arr[i].content.streaming,
          },
        };
        break;
      }
    }
    return { chatHistory: arr };
  }),
```

- [ ] **Step 2: Build to confirm no syntax errors**

```bash
cd /Users/veko/code/usual/bazi-analysis/frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds.

---

## Task 3: Chat.jsx — wire up new Gua flow

**Files:**
- Modify: `frontend/src/components/Chat.jsx`

This is the biggest change. Summary of what changes:
1. Remove `import Gua` and `<Gua />` from render
2. Import `GuaCard` + new store actions
3. Add `castGuaInline(question, ctaIdx)` — streams from `/api/gua`, updates chatHistory in-place
4. Update `onRedirect` handler — call `replacePlaceholderWithCta` instead of dispatching window event
5. Add rendering for `role:'cta'` and `role:'gua'` in the history map
6. Add manual icon button next to the send button
7. Filter `cta` + `gua` roles from `histToSend` before sending to server

- [ ] **Step 1: Update imports at top of Chat.jsx**

Replace:
```js
import Gua from './Gua';
```
With:
```js
import GuaCard from './GuaCard';
```

Add to useAppStore destructuring (line ~12–18):
```js
const replacePlaceholderWithCta = useAppStore(s => s.replacePlaceholderWithCta);
const pushGuaCard = useAppStore(s => s.pushGuaCard);
const updateLastGuaCard = useAppStore(s => s.updateLastGuaCard);
const guaStreaming = useAppStore(s => s.guaStreaming);
const setGuaStreaming = useAppStore(s => s.setGuaStreaming);
const meta = useAppStore(s => s.meta);
const dayun = useAppStore(s => s.dayun);
```

Also add local state for manual Gua CTA (replaces the old Gua component's `question` state):
```js
const [guaCastingIdx, setGuaCastingIdx] = useState(null); // index in history being streamed
```

- [ ] **Step 2: Add `castGuaInline` function inside Chat component (after `send`)**

```js
async function castGuaInline(question) {
  if (!question?.trim() || guaStreaming) return;
  setGuaStreaming(true);

  // Birth context (same as old Gua.jsx)
  const state = useAppStore.getState();
  const metaSnap = state.meta;
  const dayunSnap = state.dayun;
  let birthContext = null;
  if (metaSnap) {
    const todayYear = Number(String(metaSnap?.today?.ymd || '').slice(0, 4));
    const currentDayun = dayunSnap?.find(s => {
      const start = Number(s.startYear), end = Number(s.endYear);
      return Number.isFinite(start) && Number.isFinite(end) && todayYear >= start && todayYear <= end;
    }) || dayunSnap?.find(s => s.current) || null;
    const currentLiunian = currentDayun?.years?.find(y => Number(y.year) === todayYear)
      || currentDayun?.years?.find(y => y.current)
      || (metaSnap?.today?.yearGz ? { gz: metaSnap.today.yearGz } : null);
    birthContext = {
      rizhu: metaSnap.rizhu,
      currentDayun: currentDayun?.gz,
      currentYear: currentLiunian?.gz,
    };
  }

  let guaData = null;
  let runningBody = '';
  try {
    const final = await streamSSE('/api/gua', { question: question.trim(), birthContext }, {
      onGua: (g) => {
        guaData = g;
        pushGuaCard({ ...g, question: question.trim(), body: '' });
      },
      onDelta: (_t, running) => {
        runningBody = running;
        updateLastGuaCard(running, false);
      },
      onModel: (m) => console.log('[gua] model=' + m),
    });
    updateLastGuaCard(final || runningBody, true);
    // Keep gua.current in store for backward compat
    const setGuaCurrent = useAppStore.getState().setGuaCurrent;
    const pushGuaHistory = useAppStore.getState().pushGuaHistory;
    const entry = { ...guaData, question: question.trim(), body: final || runningBody, ts: Date.now() };
    setGuaCurrent(entry);
    pushGuaHistory(entry);
  } catch (e) {
    console.error('[gua inline] failed:', e);
    updateLastGuaCard('（起卦失败：' + (e.message || String(e)) + '）', true);
  } finally {
    setGuaStreaming(false);
  }
}
```

- [ ] **Step 3: Update `onRedirect` in the `send` function**

Replace (around line 63–66):
```js
onRedirect: (to, redirQ) => {
  if (to === 'gua') {
    replaceLastAssistant('（已起卦，请看上方卦象）');
    window.dispatchEvent(new CustomEvent('bazi:cast-gua', { detail: { question: redirQ || q } }));
  }
},
```

With:
```js
onRedirect: (to, redirQ) => {
  if (to === 'gua') {
    replacePlaceholderWithCta(redirQ || q, false);
  }
},
```

- [ ] **Step 4: Filter non-chat roles from histToSend**

Find (around line 55):
```js
const histToSend = state.chatHistory.slice(0, -1);
```

Replace with:
```js
const histToSend = state.chatHistory
  .slice(0, -1)
  .filter(m => m.role === 'user' || m.role === 'assistant');
```

- [ ] **Step 5: Remove `<Gua />` from JSX, add CTA + GuaCard rendering, add manual icon button**

Replace the entire return block. Key changes:
1. Remove `<Gua />` (was line 99)
2. Add CTA and gua rendering in the history map
3. Add manual icon button in `.chat-input` div

Here is the updated return block:

```jsx
return (
  <div className="right-pane">
    <div className="chat-topbar">
      <div className="section-num">对 话</div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="muted" style={{ fontSize: 11 }} onClick={() => clearChat()}>清空</button>
      </div>
    </div>

    <div className="chat-body" ref={bodyRef}>
      {history.length === 0 && (
        <div className="msg msg-ai">
          我已经看过你的命盘了。你可以：<br/>
          <span className="muted" style={{ fontSize: 12 }}>· 直接点左侧命盘里的<b>任意字</b>——我会立即解释</span><br/>
          <span className="muted" style={{ fontSize: 12 }}>· 告诉我一个你当下的选择困境，我会进入结构化分析</span>
        </div>
      )}
      {history.map((m, i) => {
        if (m.role === 'user') {
          return (
            <div className="msg msg-user" key={i}>
              <span className="bubble">{m.content}</span>
            </div>
          );
        }

        if (m.role === 'gua') {
          return (
            <div className="msg msg-ai" key={i}>
              <GuaCard data={m.content} />
            </div>
          );
        }

        if (m.role === 'cta') {
          const { question: ctaQ, manual } = m.content || {};
          const [localQ, setLocalQ] = useState(ctaQ || '');  // NOTE: see step 6 for fix
          return (
            <div className="msg msg-ai" key={i}>
              <CtaBubble
                question={ctaQ}
                manual={manual}
                onCast={(q) => castGuaInline(q)}
                disabled={guaStreaming}
              />
            </div>
          );
        }

        const isLast = i === history.length - 1;
        if (isLast && chatError) {
          const uiError = friendlyError(chatError.error, 'chat');
          return (
            <div className="msg msg-ai" key={i}>
              <ErrorState
                title={uiError.title}
                detail={uiError.detail}
                retryable={uiError.retryable}
                onRetry={uiError.retryable ? () => send(chatError.question, { retry: true }) : undefined}
              />
            </div>
          );
        }
        return (
          <div className="msg msg-ai" key={i}>
            {isLast && chatStreaming && fallbackModel && (
              <div className="fallback-hint">主模型反应慢，已切到 {fallbackModel}</div>
            )}
            {m.content ? <RichText text={m.content} /> : '…'}
          </div>
        );
      })}
    </div>

    <div className="chat-input-wrap">
      <div className="chat-chips">
        {CHIPS.map(c => (
          <button key={c} className="chip" onClick={() => send(c)} disabled={chatStreaming}>{c}</button>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="你想知道什么？"
          disabled={chatStreaming}
        />
        <button
          className="gua-icon-btn"
          title="手动起一卦"
          onClick={() => {
            const q = input.trim();
            if (q) {
              pushChat({ role: 'user', content: q });
              setInput('');
            }
            pushChat({ role: 'cta', content: { question: q, manual: !q } });
          }}
          disabled={chatStreaming || guaStreaming}
          style={{
            background: 'none', border: '1px solid #ccc', cursor: 'pointer',
            fontSize: 16, padding: '6px 10px', color: '#888',
          }}
        >
          ☰
        </button>
        <button className="btn-primary" onClick={() => send()} disabled={chatStreaming}>发送</button>
      </div>
    </div>
  </div>
);
```

**IMPORTANT NOTE:** The `useState` call inside the map is invalid React (hooks can't be in loops). Extract `CtaBubble` as a component in step 6.

- [ ] **Step 6: Extract CtaBubble as a component (above the Chat function)**

Add before `export default function Chat()`:

```jsx
function CtaBubble({ question, manual, onCast, disabled }) {
  const [q, setQ] = useState(question || '');
  return (
    <div className="cta-bubble">
      {!manual && question && (
        <div style={{ marginBottom: 8, fontSize: 13, color: '#555' }}>
          这个问题适合起一卦，要不要为你算一下？
        </div>
      )}
      {(manual || !question) && (
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onCast(q); }}
          placeholder="问一件具体的事，例如：下周该不该换工作"
          disabled={disabled}
          style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #ccc', marginBottom: 8, boxSizing: 'border-box' }}
        />
      )}
      <button
        className="btn-primary"
        onClick={() => onCast(manual || !question ? q : question)}
        disabled={disabled || !(manual || !question ? q.trim() : question)}
        style={{ fontSize: 12, padding: '4px 14px' }}
      >
        {disabled ? '占算中…' : '起一卦'}
      </button>
    </div>
  );
}
```

Also add CTA bubble CSS (add to same CSS file from Task 1):
```css
.cta-bubble {
  background: #f8f6f1;
  border: 1px dashed #c5b89a;
  padding: 12px 14px;
  border-radius: 4px;
}
```

- [ ] **Step 7: Replace the invalid `useState` in the map with `<CtaBubble>` usage**

In the `m.role === 'cta'` branch from Step 5, replace the broken inline `useState` call with the correct usage (the `CtaBubble` component handles its own state):

```jsx
if (m.role === 'cta') {
  const { question: ctaQ, manual } = m.content || {};
  return (
    <div className="msg msg-ai" key={i}>
      <CtaBubble
        question={ctaQ}
        manual={manual}
        onCast={(q) => castGuaInline(q)}
        disabled={guaStreaming}
      />
    </div>
  );
}
```

Also add `useState` to imports (it's already there — just double check the import line at top includes it).

- [ ] **Step 8: Build and verify**

```bash
cd /Users/veko/code/usual/bazi-analysis/frontend && npm run build 2>&1 | tail -30
```

Expected: build succeeds with no errors. Verify file compiles correctly with `npm run lint`.

---

## Task 4: Manual smoke test — Gua inline flow

This is a browser verification task. Start the dev server and test the three scenarios described in the spec.

- [ ] **Step 1: Start dev server**

```bash
cd /Users/veko/code/usual/bazi-analysis && npm run dev:back &
cd /Users/veko/code/usual/bazi-analysis && npm run dev:front
```

(Server on :3101, Vite on :5173 by default)

- [ ] **Step 2: Verify — CTA triggered by divination intent**

1. Load a chart
2. Type a message like "我今年换工作合适吗" and send
3. Expected: server classifies as `divination` → `onRedirect` fires → CTA bubble appears in chat (no panel above), with "这个问题适合起一卦..." and [起一卦] button

- [ ] **Step 3: Verify — clicking CTA starts gua inline**

1. Click [起一卦] in the CTA bubble
2. Expected: GuaCard appears in chat below the CTA, with hexagram symbol, name, and streaming interpretation text
3. After streaming completes: full body shown, `streaming: false`

- [ ] **Step 4: Verify — refresh preserves gua card**

1. After step 3, refresh the browser
2. Expected: GuaCard is still visible in chat history (stored in zustand chatHistory → localStorage)

- [ ] **Step 5: Verify — manual icon button**

1. Click the ☰ icon button next to the input with an empty input field
2. Expected: CTA bubble appears with text input field (manual mode)
3. Type a question and click [起一卦] → GuaCard streams inline

- [ ] **Step 6: Verify — non-divination messages do NOT show CTA**

Send 5 messages that should NOT trigger gua:
- "七杀格是什么意思" → personality/meta intent, no CTA
- "我的食伤力量如何" → meta intent, no CTA
- "2026年运势怎么样" → timing intent, no CTA (might be borderline — if it triggers, the keyword list needs tuning)
- "你好" → chitchat, no CTA
- "我适合什么工作" → career intent, no CTA

If any false positives, check `classifyByKeywords` in `server/prompts.js` for the divination keywords list and tighten if needed.

---

## Task 5: (Optional) Tune divination keywords if false positives found

**Files:**
- Modify: `server/prompts.js` — only if Task 4 Step 6 reveals false positives

The current divination keywords include: `起卦, 占卜, 卦象, 该不该, 能不能, ...`

If "今年运势怎么样" is triggering divination instead of timing, ensure the keyword priority ordering has `timing` before `divination` (or that "今年" maps to timing, not divination). The spec says: "宁可漏判也别误判".

- [ ] **Step 1: Check current keyword priority in prompts.js**

```bash
grep -n 'classifyByKeywords\|KEYWORDS\|divination' /Users/veko/code/usual/bazi-analysis/server/prompts.js | head -40
```

- [ ] **Step 2: If needed, adjust keyword mapping**

Move any ambiguous keywords (能不能, 合不合适) out of `divination` and into a more specific divination-only set. Safe triggers for divination: `起卦, 占卜, 卦象` (explicit). User questions about specific yes/no decisions are handled by LLM fallback.

- [ ] **Step 3: Restart server and retest**

```bash
pkill -f 'node server.js' && cd server && node server.js &
```

Rerun the 5 non-divination test messages from Task 4 Step 6.

---

## Task 6: core.md — 笔调规范 section

**Files:**
- Modify: `shards/core.md`

Insert the full tone spec between the `## 输出风格` section and `## 力量分析铁律` section.

- [ ] **Step 1: Add 笔调规范 to core.md**

After the `## 输出风格` section (currently ends at line 13), insert:

```markdown
## 笔调规范（Sections 专用）

### 底色
半文半白。白话七，文言腔三。像一个读过书、见过命的老先生，坐在你对面、泡着茶、跟你讲你自己——不是在念报告，也不是在背教材。**准确是底线，读得下去是要求。**

### 开篇钩子（最重要）
第一段第一句必须是钩子，不是定义。要有画面、有张力、有"咦"的一瞬。

好的开头示范：
- "甲木生于酉月，是一棵长在刀口边上的树。"
- "此造妙处不在明处，在那点藏在地支里、轻易不肯露面的伤官。"
- "日主坐下藏着一股倔劲，别人看不见，你自己也未必承认。"
- "这张盘有意思——强在不该强的地方，弱在旁人看不出来的地方。"

禁用的开头：
- "你的日主是……"
- "根据你的八字，你是一个……的人。"
- "你的性格特点包括……"
- "综合来看，你的命盘显示……"

**凡以"你的 X 是"起头的句式，一律重写。**

### 节奏
长短句交错。三五句白话铺陈之后，落一句四到六字的短句作收束：
- "命数如此。"
- "此之谓也。"
- "其人如是。"
- "看的就是这个。"
- "此处是枢机。"

不要连续三句以上平铺的陈述句——读者会走神。

### 比喻先于术语
能用比喻说清的，先比喻、后术语。两者并列，比喻在前：

> "像一把没开刃的刀——财星透而无根，看着锋利，真要砍下去使不上劲。"

禁用：
> "你的财星透干无根，代表你在财运方面看似顺利实则难以把握。"

### 古籍引用
原文用「」包裹，引完立刻接白话翻译，再落一句"对应到你这里——"的桥接。三段式：

> 《滴天髓》云：「得时俱为旺论，失时便作衰看，虽是至理，亦死法也。」——任铁樵这一驳，就是说月令虽重，不是铁板。对应到你这里，日主虽失月令，但年支有根、时干得助，不能一句"身弱"就打发。

禁止编造古文。宁可不引，不可杜撰。

### 禁用词清单
正文里不得出现：
- "综上所述"、"总的来说"、"总而言之"
- "首先……其次……再次……最后"
- "根据……可以看出"
- "可能"、"或许"、"大概"——出现在**结论句**里一律改为明确表述（铺垫句里可以有）
- 所有 emoji
- 正文里的 **加粗**（标题可用；正文里不行）

### 结论句的确定性
十神判定、格局取用、日主强弱、喜忌方向——这四项在结论句里必须明确。"可能偏向身弱"不行，要么"身弱"、要么"身弱偏中和"、要么"介于身弱与从弱之间，按身弱论"。

模糊是留给边界情形的措辞方式，不是回避判断的借口。

### 自检规则（每段写完问自己）
1. 这段的第一句，有没有让我想读第二句？没有就重写第一句。
2. 这段里有没有一个画面或比喻？一个都没有就加一个。
3. 这段的最后一句，是不是一个有重量的短句？不是就补一个。
4. 通读这段，有没有任何一句是"百度百科会这么写"的？有就删。

### 准确性红线（不可为文采让步）
- 十神力量对比该有的 4 维度（透干/得令/根/合克冲）不能省。可以把过程藏进比喻，但结论必须是算出来的，不是编出来的。
- 古籍引用必须真实存在且用得对路。
- REF 标记规则（见下文）不变。文风再花，[[pillar.day.gan|丁火]] 该打还得打。
```

- [ ] **Step 2: Verify core.md loads without breaking the server**

```bash
node -e "const {skillLoaded} = require('./server/prompts.js'); console.log('loaded:', skillLoaded())"
```

Run from `/Users/veko/code/usual/bazi-analysis`. Expected: `loaded: true`

---

## Task 7: personality.md + relationship.md — opening examples

**Files:**
- Modify: `shards/personality.md`
- Modify: `shards/relationship.md`

Each shard gets a new `## 好/坏开头示范` section at the end. These are illustrative examples for the model — not templates.

- [ ] **Step 1: Add opening examples to personality.md**

Append to end of `shards/personality.md`:

```markdown
## 好/坏开头示范

好的开头（感受一下语气，自己发挥，不要照抄）：
- "日主坐下藏着一股倔劲，别人看不见，你自己也未必承认。"
- "此命格的有趣之处在于，温和的表象底下，藏着一把不肯弯的骨头。"
- "食伤近乎于无——这不代表没有表达欲，而是那股劲憋在里头，找不到顺畅的出口。"

坏的开头（禁用这类句式）：
- "你的性格特点是……"
- "根据你的八字，你是一个外向/内向的人。"
- "你的比劫旺，代表你独立性强。"
```

- [ ] **Step 2: Add opening examples to relationship.md**

Append to end of `shards/relationship.md`:

```markdown
## 好/坏开头示范

好的开头：
- "日支坐的那个字，是你一生里走得最近的人的底色——先看它，再看星。"
- "正财透干，但根在哪里？有根者情深，无根者情浮。此盘的妻星……"
- "感情这条线上，最费劲的不是遇不到，是遇到了拿不稳。日支与妻星不呼应，根由在此。"

坏的开头：
- "你的感情运势如下……"
- "根据你的八字，你在感情方面是一个……的人。"
- "你的正财代表你的妻子/伴侣。"
```

---

## Task 8: wealth.md + career.md — opening examples

**Files:**
- Modify: `shards/wealth.md`
- Modify: `shards/career.md`

- [ ] **Step 1: Append to wealth.md**

```markdown
## 好/坏开头示范

好的开头：
- "财星透而无根，像一把没开刃的刀——看着有，真要用时使不上劲。"
- "偏财旺过正财，这个人挣钱靠的不是稳，靠的是胆。"
- "食伤生财这条链子，此盘断在中间——食伤倒是有，财接不住。"

坏的开头：
- "你的财运如下……"
- "你的正财代表稳定收入，偏财代表横财……"
- "根据命盘分析，你的财运整体属于……"
```

- [ ] **Step 2: Append to career.md**

```markdown
## 好/坏开头示范

好的开头：
- "伤官见官，体制里的日子不会好过——但这话要先看格局再说，不是见了就断。"
- "此造食伤有力，财接得住，这是靠手艺吃饭的结构，问题只在'手艺'是什么。"
- "官杀清透，身又不弱，这类命格适合管人——但得先过了那道'能不能立住'的关。"

坏的开头：
- "你的事业运如下……"
- "根据你的格局，你适合从事……行业。"
- "你的官星代表你的事业和上司关系。"
```

---

## Task 9: timing.md + health.md — opening examples

**Files:**
- Modify: `shards/timing.md`
- Modify: `shards/health.md`

- [ ] **Step 1: Append to timing.md**

```markdown
## 好/坏开头示范

好的开头：
- "大运是底色，流年是催化剂——底色不好，流年再好也是借来的热闹。"
- "现在走的这步大运，对你的格局来说是助力还是阻力？先把这个定了，再谈流年。"
- "2026 年，流年地支与原局某个结构形成冲合——这一年被推动的，是哪条线？"

坏的开头：
- "你的大运流年如下……"
- "今年的流年是……，对你的影响是……"
- "根据你的大运分析，未来十年你将……"
```

- [ ] **Step 2: Append to health.md**

```markdown
## 好/坏开头示范

好的开头：
- "五行里水最轻——这不只是肾的问题，冬天的冷、深夜的焦虑、骨头的隐患，都从这里来。"
- "被冲最重的是月柱，月柱主气血与中年健康，冲力在哪一年激活，值得留意。"
- "此造土旺而木弱，肝胆与情绪是要照看的方向；脾胃反而是护着的。"

坏的开头：
- "你的健康运如下……"
- "根据五行分析，你的身体较弱的部位是……"
- "你需要注意……方面的健康问题。"
```

---

## Task 10: appearance.md + meta.md — opening examples

**Files:**
- Modify: `shards/appearance.md`
- Modify: `shards/meta.md`

- [ ] **Step 1: Append to appearance.md**

```markdown
## 好/坏开头示范

好的开头：
- "火形人主神情闪烁，但你食神十分泄火，外露的锐利会被柔化，看起来比实际温和。"
- "《三命通会》论木形：'修长疏秀，眉目清朗'——但木旺遇金冲，清朗里会有一点硬气。"
- "日主金，气质走向是硬朗收敛；但月令有火，金被煅，外形上那种棱角会被打磨过一遍。"

坏的开头：
- "你的外貌特征如下……"
- "根据你的日主，你的外貌是……"
- "你长得比较……"
```

- [ ] **Step 2: Append to meta.md**

```markdown
## 好/坏开头示范

好的开头：
- "格局是一张命盘的主结构，其余的分析都是在这个框架里转——所以先把格局定了。"
- "月令透出的这个字，就是格局的核心；它能不能成，看成败两面各有几分力量。"
- "此盘格局不算清纯，有破有救——这类盘最怕两头押，适合的方向要在破与救之间找。"

坏的开头：
- "你的格局是……格，用神是……"
- "根据月令分析，你的格局类型属于……"
- "你的用神是……，忌神是……"
```

- [ ] **Step 3: Final verification — server loads all shards**

```bash
cd /Users/veko/code/usual/bazi-analysis && node -e "const {skillLoaded} = require('./server/prompts.js'); console.log('skill loaded:', skillLoaded())"
```

Expected: `skill loaded: true`

---

## Verification Checklist (from spec)

- [ ] `npm run build` passes with no errors
- [ ] `npm run lint` passes (frontend)
- [ ] Non-divination messages (5 types) do NOT show CTA bubble
- [ ] Divination intent message shows CTA bubble inline in chat
- [ ] Clicking [起一卦] produces GuaCard inline in chat
- [ ] GuaCard persists after browser refresh (check localStorage in DevTools)
- [ ] Manual ☰ icon button is visible, opens CTA with input field
- [ ] Paipan engine tests still pass: `node paipan-engine/test.js && node paipan-engine/test3.js`

---

## Commit Strategy

One commit per task:
```
feat: add GuaCard inline display component
feat: store — add replacePlaceholderWithCta, pushGuaCard, updateLastGuaCard
feat: Chat — move gua from panel to inline chat flow with CTA trigger
docs(shards): add 笔调规范 to core.md
docs(shards): add opening examples to personality + relationship
docs(shards): add opening examples to wealth + career
docs(shards): add opening examples to timing + health
docs(shards): add opening examples to appearance + meta
```
