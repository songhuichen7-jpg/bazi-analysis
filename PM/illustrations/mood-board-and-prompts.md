# BaZi Personality Cards — Mood Board & AI Generation Prompts

> Style anchor: **扁平治愈风 (flat healing aesthetic)**
> 20 types · portrait illustrations · 1:1 square

---

## 1. Style Anchor Definition

**扁平治愈风** sits at the intersection of minimal-flat illustration and emotional warmth. It is not clinical flat design (no cold UI icons) and not saccharine kawaii (no glitter or extreme chibi proportions). The goal is a gentle, lived-in calm that feels like a Sunday afternoon — approachable but not infantile.

**Linework.** Slightly thick, uniform-weight outlines (1.5–2 px equivalent at 512px). Closed shapes only — no open brushstroke ends or scratchy sketching. No hand-drawn wobble; shapes are clean but slightly rounded at corners (border-radius feel), not mechanical-geometric. Circles are soft circles, not perfect ellipses.

**Color palette.** Each type has a theme color (see §4). Treat it as the dominant mid-tone. Derive a highlight (+15–20% lightness, −20% saturation) and a shadow tone (−15% lightness, +5% saturation) from it. Background uses an off-white or a very light tint of the theme color (≤8% saturation). Never use pure primaries. All colors are muted pastels — HSL saturation stays in the 25–55% range. No neons, no deep blacks.

**Shading.** Two-tone cel shading: one flat base color + one shadow shape (soft, low-contrast). No gradients. No multiply-blending glow effects. Shadow direction: upper-left light source, soft shadow falling lower-right, but the shadow plane is a single solid shape, not a gradient.

**Composition.** Centered subject, occupying roughly 65–75% of the canvas height. The subject faces slightly off-center (3/4 view or front-facing is both acceptable) but has a gaze that points toward the viewer. Generous white-space breathing room on all sides. Background: single flat color or a simple geometric shape (circle or soft blob) behind the subject in a lighter tint of the theme color. No busy illustrated backgrounds.

**Facial expression rule.** For animal/creature types: calm eyes (slightly drooping outer corner = relaxed), small closed or slightly open mouth. For object/plant types: anthropomorphic hints are fine (a subtle face on the teacup, expressive posture on the plant) but not mandatory — a well-lit object in a serene pose reads as "healing" on its own. The emotional register is "quietly content" — not grinning, not blank.

**What to avoid.** Glossy 3D rendering, specular highlights, realistic fur/feather texture, drop shadows with blur, photo-bashing, hyper-detailed anatomy, lens flare, noise/grain overlays, AI maximalist composition (too many elements competing for attention), heavily saturated backgrounds, and any text embedded in the illustration.

---

## 2. Three Concrete Style References

1. **LINE FRIENDS / Brown & Friends character art** — borrow: the thick-outline flat anatomy, the "quiet round body + small expressionless-but-warm face" formula, and the muted background color drops. Particularly their seasonal illustration sets (not the merchandise — the digital greeting card artwork).

2. **Pockasa / Noritake (Japanese stationery illustration)** — borrow: the restrained color palette (never more than 4–5 hues per piece), the generous white space, and the way objects communicate personality through posture alone rather than facial expression. Noritake's work often features animals and everyday objects with a melancholy-but-cozy feel that maps directly onto 治愈.

3. **Xiaohongshu "治愈系" creator @療癒星球 (Healing Planet) style** — borrow: the soft cel-shaded background blobs behind characters, the limited palette derived from a single warm or cool base hue, and the consistent 1:1 portrait framing used across a series. This is the most direct stylistic peer on the Chinese social media illustration scene.

---

## 3. Global Prompt Template

```
flat illustration of a {subject_noun}, {key_visual_traits},
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on {theme_color_description},
background: soft {bg_color} circular blob on off-white, generous white space,
mood: {mood_descriptors}, quietly content, calm gaze,
composition: centered portrait, slight 3/4 angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no texture detail,
no text, no logos, no busy background
```

**Field guide:**
- `{subject_noun}` — English common name of the creature/object/plant
- `{key_visual_traits}` — 2–3 defining physical traits that reinforce the personality
- `{theme_color_description}` — describe the hex in plain language (e.g., "deep forest green #2D6A4F")
- `{bg_color}` — a lighter tint of the theme color (e.g., "pale sage green")
- `{mood_descriptors}` — 2 descriptors derived from the one_liner personality (see §4)

**State modifiers:**
- **绽放 types** → add: `dynamic pose, slight forward lean, energetic body language`
- **蓄力 types** → add: `still pose, settled weight, introspective body language`

---

## 4. Per-Type Prompt Fills (All 20)

### 01 春笋 (甲绽放 · #2D6A4F · "越压越往上长")

```
flat illustration of a bamboo shoot bursting upward through soil, tapered tip pointing 
confidently skyward, pale green leaf sheaths peeling back, slight forward lean,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on deep forest green #2D6A4F, highlight in pale jade,
background: soft pale sage green circular blob on off-white, generous white space,
mood: unstoppable, quietly determined, dynamic pose, energetic upward thrust,
composition: centered portrait, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no texture detail, no text
```

### 02 橡子 (甲蓄力 · #1B4332 · "别催，在攒大招")

```
flat illustration of a plump acorn with its cap snugly fitted, round body resting still 
on a flat surface, small rosy cheeks suggested by blush shapes, still and settled pose,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on deep pine green #1B4332, highlight in pale mint,
background: soft pale green circular blob on off-white, generous white space,
mood: patient, quietly accumulating, introspective body language, settled weight,
composition: centered portrait, slight 3/4 angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no texture detail, no text
```

### 03 萨摩耶 (乙绽放 · #52B788 · "看着随和，底线焊死")

```
flat illustration of a fluffy Samoyed dog, soft rounded white body with mint-green shading, 
gentle smile, friendly open posture with slight forward lean, tail curved upward,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on medium sea green #52B788, white fur with sage shadows,
background: soft pale green circular blob on off-white, generous white space,
mood: approachable, warmly self-assured, dynamic friendly pose, energetic body language,
composition: centered portrait, front-facing, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no fur texture detail, no text
```

### 04 含羞草 (乙蓄力 · #2D7D53 · "碰一下就缩，但根还在")

```
flat illustration of a mimosa plant (sensitive plant) with delicate folded leaflets on one 
side and open feather-frond leaves on the other, slender curved stem rooted firmly in soil,
introspective inward-curling posture,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on medium forest green #2D7D53, soft pink-purple for 
small flower pom, pale sage highlights,
background: soft pale jade circular blob on off-white, generous white space,
mood: delicate yet resilient, quietly self-protective, still pose, settled weight,
composition: centered portrait, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no texture detail, no text
```

### 05 火烈鸟 (丙绽放 · #F5A623 · "自带聚光灯")

```
flat illustration of a flamingo standing tall on one leg, long elegant neck forming a graceful 
S-curve, wings slightly spread, vivid coral-peach body with warm amber-orange shading, 
dynamic confident pose with slight forward lean,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on warm amber-orange #F5A623, coral peach body tones,
background: soft pale golden circular blob on off-white, generous white space,
mood: naturally radiant, effortlessly commanding attention, energetic body language,
composition: centered portrait, slight 3/4 angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no feather texture, no text
```

### 06 热可可 (丙蓄力 · #C47D0E · "不烫手，但离不开")

```
flat illustration of a ceramic mug of hot cocoa, round plump mug shape with a lazy wisp of 
steam rising, small marshmallow floating on top, warm caramel and tan tones, 
still resting pose with settled weight,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on warm amber-brown #C47D0E, cream highlights, 
soft caramel shadows,
background: soft pale amber circular blob on off-white, generous white space,
mood: comforting, quietly indispensable, introspective warmth, soft and approachable,
composition: centered portrait, slight 3/4 angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no texture detail, no text
```

### 07 萤火虫 (丁绽放 · #4A9BE8 · "自己发光，不蹭别人的")

```
flat illustration of a firefly in mid-flight, small round body with glowing amber-yellow 
tail light, delicate wings spread mid-beat, floating upward with dynamic lift,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on sky blue #4A9BE8, warm amber glow spot on tail, 
pale blue highlights,
background: soft pale twilight blue circular blob on off-white, generous white space,
mood: self-sufficient luminosity, gently purposeful, dynamic pose, energetic body language,
composition: centered portrait, slight 3/4 angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no texture detail, no text
```

### 08 小夜灯 (丁蓄力 · #2B6CB0 · "光不大，但一直亮着")

```
flat illustration of a small bedside night-light lamp, rounded mushroom or dome silhouette 
shape, soft warm glow emanating from the shade as a simple flat halo shape, sturdy base, 
still pose with settled reassuring presence,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on medium blue #2B6CB0, warm cream glow shape, 
soft navy shadows,
background: soft pale blue circular blob on off-white, generous white space,
mood: quietly dependable, steady warmth, introspective body language, constant and calm,
composition: centered portrait, front-facing, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no texture detail, no text
```

### 09 大象 (戊绽放 · #A0785A · "认准了就不挪窝")

```
flat illustration of an elephant in a composed standing pose, broad rounded body and wide 
stable feet planted firmly, short tusks, calm forward-facing gaze, slight forward lean 
suggesting readiness, warm earthy tones,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on warm clay brown #A0785A, pale sand highlights, 
soft umber shadows,
background: soft pale terracotta circular blob on off-white, generous white space,
mood: immovably committed, grounded confidence, dynamic forward-set posture, quietly strong,
composition: centered portrait, slight 3/4 angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no skin texture, no text
```

### 10 松鼠 (戊蓄力 · #7A5438 · "先存够再说")

```
flat illustration of a squirrel sitting upright, both paws clutching an acorn close to 
its chest, fluffy tail curled up behind, calm composed posture with slight inward hunch 
of protective gathering,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on warm chestnut brown #7A5438, pale cream belly, 
soft dark brown shadows,
background: soft pale warm-tan circular blob on off-white, generous white space,
mood: prudent, quietly self-sufficient, introspective still pose, settled gathering weight,
composition: centered portrait, slight 3/4 angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no fur texture, no text
```

### 11 多肉 (己绽放 · #D4A574 · "慢慢长，急不来的")

```
flat illustration of a plump succulent plant in a small round ceramic pot, chubby rosette 
leaves fanning outward in a confident bloom, small star-shaped flower at center, 
energetic upward-opening posture,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on warm sandy tan #D4A574, dusty sage green for leaves, 
pale cream pot with warm shadow,
background: soft pale peach circular blob on off-white, generous white space,
mood: unhurried flourishing, patient vitality, dynamic open bloom pose, quietly energetic,
composition: centered portrait, slight 3/4 overhead angle, subject fills 70% of canvas, 
1:1 square, no gradients, no 3d rendering, no photorealism, no harsh shadows, no texture, no text
```

### 12 树懒 (己蓄力 · #A67C4E · "不是懒，是在充电")

```
flat illustration of a sloth hanging serenely from a branch, arms draped over the branch 
in total relaxation, closed or half-lidded eyes, slow smile, fur rendered as flat 
color blocks, deeply settled hanging pose,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on warm camel brown #A67C4E, cream face and belly, 
soft taupe shadows,
background: soft pale warm-brown circular blob on off-white, generous white space,
mood: deeply restoring, unapologetically still, introspective recharging pose, at peace,
composition: centered portrait, front-facing hanging view, subject fills 70% of canvas, 
1:1 square, no gradients, no 3d rendering, no photorealism, no harsh shadows, no fur texture, no text
```

### 13 刺猬 (庚绽放 · #4A7BA8 · "不挑活，上手就干")

```
flat illustration of a hedgehog trotting forward with purpose, small body leaning into a 
confident stride, spines rendered as simple flat triangular shapes fanning behind, 
tiny determined expression, dynamic forward-momentum pose,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on slate blue #4A7BA8, warm cream belly and face, 
soft gray-blue spine shapes,
background: soft pale steel-blue circular blob on off-white, generous white space,
mood: no-nonsense capable, gets-things-done, dynamic forward lean, energetic stride,
composition: centered portrait, 3/4 side angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no spine texture, no text
```

### 14 河豚 (庚蓄力 · #2C5282 · "别惹我，会膨胀的")

```
flat illustration of a pufferfish in calm (un-inflated) state, compact round body with 
small relaxed fins, mild-mannered expression with closed eyes, a subtle readiness in the 
slightly puffed cheek shape, still composed pose,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on deep navy blue #2C5282, pale periwinkle belly, 
soft dark blue speckle shapes (flat dots, not texture),
background: soft pale indigo circular blob on off-white, generous white space,
mood: quietly composed, latent power, introspective contained pose, deceptively serene,
composition: centered portrait, slight 3/4 angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no skin texture, no text
```

### 15 琉璃 (辛绽放 · #9B7AC4 · "光对了就发光")

```
flat illustration of a glass bead or glazed liuli glass ornament, faceted teardrop or 
sphere shape with two-tone flat color planes suggesting refraction, subtle internal glow 
implied by a lighter flat shape at center, dynamic angled pose as if catching light,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on medium lavender purple #9B7AC4, pale lilac highlights, 
soft violet shadows — NO actual gradients, simulate refraction with flat color planes,
background: soft pale lavender circular blob on off-white, generous white space,
mood: conditionally radiant, self-contained luminosity, dynamic open pose, quietly brilliant,
composition: centered portrait, angled 3/4 view to suggest refraction, subject fills 70% 
of canvas, 1:1 square, no actual gradients, no 3d rendering, no photorealism, no text
```

### 16 猫 (辛蓄力 · #6B4E99 · "不是冷，是在挑人")

```
flat illustration of a cat sitting in a composed upright pose, tail wrapped neatly around 
its feet, eyes half-lidded in selective appraisal, chin slightly raised, still regal 
posture suggesting discernment not coldness,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on deep violet #6B4E99, pale lilac-gray coat, 
soft dark purple shadows,
background: soft pale mauve circular blob on off-white, generous white space,
mood: discerning, quietly self-possessed, introspective still pose, regal settled weight,
composition: centered portrait, slight 3/4 angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no fur texture, no text
```

### 17 水獭 (壬绽放 · #1A759F · "会玩才是正经事")

```
flat illustration of an otter floating on its back on water surface (implied by a flat 
reflective blue shape), arms spread wide in playful contentment, bright curious eyes, 
small item (pebble or shell) balanced on its belly, dynamic relaxed-energetic pose,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on ocean teal blue #1A759F, warm cream belly, 
soft dark blue-brown back shading,
background: soft pale aqua circular blob on off-white, generous white space,
mood: joyfully present, play-as-philosophy, dynamic carefree pose, energetic ease,
composition: centered portrait, top-down floating angle, subject fills 70% of canvas, 
1:1 square, no gradients, no 3d rendering, no photorealism, no harsh shadows, no fur texture, no text
```

### 18 章鱼 (壬蓄力 · #0D4F72 · "看不透我很正常")

```
flat illustration of an octopus at rest, round mantle head and several tentacles curled 
softly beneath it, large calm eyes with a knowing quality, tentacles wrapped partly around 
itself in an introspective coil, still settled pose,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on deep ocean blue #0D4F72, pale blue-gray underbelly, 
soft dark teal shadows, suction cups as simple flat circles,
background: soft pale deep-blue circular blob on off-white, generous white space,
mood: mysteriously calm, unfathomably deep, introspective still pose, contained complexity,
composition: centered portrait, front-facing, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no skin texture detail, no text
```

### 19 水母 (癸绽放 · #4AC4C0 · "随波不逐流")

```
flat illustration of a jellyfish drifting upward, translucent bell rendered as a soft 
flat dome shape with gentle trailing tentacles flowing below, dynamic upward-drifting 
pose with a sense of purposeful grace,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on aqua teal #4AC4C0, pale cyan bell highlight, 
soft teal shadow, tentacles in slightly deeper teal — NO actual transparency/gradient,
background: soft pale turquoise circular blob on off-white, generous white space,
mood: flowing with intention, self-directed grace, dynamic drifting pose, ethereally energetic,
composition: centered portrait, slight upward angle, subject fills 70% of canvas, 1:1 square,
no gradients, no actual transparency, no 3d rendering, no photorealism, no texture, no text
```

### 20 蒲公英 (癸蓄力 · #2A8F8C · "等风来就出发")

```
flat illustration of a dandelion seed head, perfectly round fluffy globe of seeds each 
with a tiny parachute filament (rendered as simple flat lines), two or three seeds lifting 
off at the edge, still composed overall pose of patient readiness,
style: 扁平治愈风 healing aesthetic, thick clean outlines, two-tone cel shading,
color: muted pastel palette centered on deep teal-green #2A8F8C, pale jade seed filaments, 
soft teal shadow at stem base,
background: soft pale seafoam circular blob on off-white, generous white space,
mood: poised readiness, waiting with purpose, introspective still pose with latent release,
composition: centered portrait, slight 3/4 angle, subject fills 70% of canvas, 1:1 square,
no gradients, no 3d rendering, no photorealism, no harsh shadows, no texture detail, no text
```

---

## 5. Batch Generation Workflow

**Recommended tool:** Midjourney v6 (best style consistency via `--seed`) or Flux.1 [dev] (best for flat illustration style adherence). DALL-E 3 as fallback for quick iteration.

**Consistency flow:** Generate types 01 (春笋), 05 (火烈鸟), and 16 (猫) first as a stylistic trio — they span plant, animal-energetic, and animal-calm. If the three feel coherent, note the seed (`--seed XXXXX` in MJ) and use it for all remaining 17. If not, adjust the global style block and re-test on those three before batching.

**Output spec:** 512×512 PNG, white or transparent background. If the generator produces a colored background, crop and export with the blob bg removed, or keep it (the blob bg is part of the design spec and matches the card component's existing placeholder layout).

**Save path:** `server/app/data/cards/illustrations/{id}-{cosmic_name_pinyin}.png`
Example: `server/app/data/cards/illustrations/01-chunsun.png` — these filenames already match the `illustration` field in `types.json`.

---

## 6. Three Mood Board Direction Variants

Choose ONE before batch-generating. Lock the choice and apply the corresponding style modifier to all 20 prompts.

---

### Variant A — Soft Watercolor Lean

Slightly blurred edges on shadows (still only two tones, but the boundary between base and shadow has a 2px feathered edge rather than a hard line). Color palette shifts toward more desaturated, slightly chalky pastels — think washed-out risograph. Background blobs are less perfectly round, more organic blob shapes. Feels like a children's picture book printed on uncoated paper. Add to every prompt: `soft feathered shadow edges, chalky muted palette, organic blob background, picture book warmth`.

---

### Variant B — Clean Vector Lean

Crisp hard edges everywhere — no feathering at all. Shapes are slightly more geometric (the cat's ears are triangles, the acorn is a perfect oval + circle). Color palette is slightly more saturated (HSL saturation 40–65%) with higher contrast between base and shadow. Feels like a polished Figma community illustration set or a well-designed WeChat sticker pack. Add to every prompt: `crisp geometric shapes, hard shadow edges, slightly more saturated, vector-clean finish, sticker-pack precision`.

---

### Variant C — Illustrated Storybook Lean

Fills have a very subtle paper or gouache texture (just enough to distinguish from sterile vector — one light noise layer). Colors trend warm overall — even the cool blues have a tiny warm offset. Line weight varies very slightly (thicker at bottom of shapes, thinner at top), creating a hand-inked feel. Closest to the Noritake reference in §2. Feels like a limited-run art print. Add to every prompt: `slight paper texture fill, warm-offset color palette, slightly variable line weight, hand-inked feel, gouache illustration aesthetic`.

---

*Pick your variant, reply with "A", "B", or "C", and the batch prompts in §4 are ready to paste with the chosen modifier appended.*
