# Recipe: test `ctx` on a greenfield with TokenRouter + MiniMax-M3

> **Pre-req**: you've installed `ctx` 0.1.1+ (no native build, no Xcode CLI needed):
> ```bash
> npm install -g github:DoozieSoftware/contextforge
> ctx --version   # → 0.1.1 (or later)
> ```
>
> If your install is failing, you almost certainly have the old 0.1.0 tarball
> cached locally. Reinstall with `--force` or clear your npm cache.

---

## 1. Make a tiny greenfield (Python + Flask, 3 files)

```bash
mkdir ~/ctx-demo && cd ~/ctx-demo
git init -q
mkdir -p app tests

cat > app/billing.py <<'PY'
from dataclasses import dataclass

RATES = {"CA": 0.0875, "NY": 0.08, "TX": 0.0625}

@dataclass
class Invoice:
    amount_cents: int
    tax_cents: int
    region: str

def calculate_tax(amount_cents: int, region: str) -> int:
    return int(amount_cents * RATES.get(region, 0))

def create_invoice(amount_cents: int, region: str) -> Invoice:
    return Invoice(amount_cents, calculate_tax(amount_cents, region), region)
PY

cat > app/views.py <<'PY'
from flask import Blueprint, request, jsonify
from app.billing import create_invoice

bp = Blueprint("billing", __name__)

@bp.post("/invoices")
def post_invoice():
    body = request.get_json(force=True)
    inv = create_invoice(int(body["amount"]), body["region"])
    return jsonify(amount_cents=inv.amount_cents, tax_cents=inv.tax_cents), 201
PY

cat > tests/test_billing.py <<'PY'
from app.billing import calculate_tax

def test_ca():
    assert calculate_tax(10000, "CA") == 875
PY
```

## 2. Wire up TokenRouter

```bash
export CTX_PROVIDER=openai-compat
export CTX_OPENAI_COMPAT_BASE_URL=https://api.tokenrouter.com/v1
export CTX_OPENAI_COMPAT_API_KEY="<paste-your-tokenrouter-key>"

# The model id as TokenRouter lists it. If you see "model not found",
# check your TokenRouter dashboard for the exact slug — common patterns
# are MiniMax-M3 (capitalised as TokenRouter lists it).
export CTX_PLANNER_MODEL=MiniMax-M3
export CTX_WRITER_MODEL=MiniMax-M3
```

Optional: pin the env so it survives shell restarts.

```bash
# One-liner that appends the four lines to ~/.zshrc (or ~/.bashrc)
cat >> ~/.zshrc <<'EOF'

# ctx → TokenRouter
export CTX_PROVIDER=openai-compat
export CTX_OPENAI_COMPAT_BASE_URL=https://api.tokenrouter.com/v1
export CTX_OPENAI_COMPAT_API_KEY="<paste-your-tokenrouter-key>"
export CTX_PLANNER_MODEL=MiniMax-M3
export CTX_WRITER_MODEL=MiniMax-M3
EOF

source ~/.zshrc
```

## 3. Smoke test the wiring (offline, no API call)

```bash
cd ~/ctx-demo
ctx scan
```

Expected output (on stderr: `Files discovered: 3` and a `Running with
provider=openai-compat` log line; on stdout: a markdown report). If you
see `No scannable files found`, double-check `ls app tests` shows the
`.py` files.

## 4. First LLM-backed command

```bash
ctx understand app/billing.py
```

What should happen, top to bottom:

1. **Scanner log** on stderr: "Files discovered: 3" plus a `## Scanner
   summary` block.
2. **LLM calls** (2-4 total, visible in the LLM stats block at the end):
   - Planner: 1-2 calls, returns `{"selectedFiles": [...], "planNotes": "..."}`
     in a code fence (TokenRouter's openai-compat endpoint forwards the
     OpenAI Chat Completions shape).
   - Writer: 1-2 calls, returns the markdown body.
3. **Markdown body** with these 5 sections, in order:
   ```
   ## Purpose
   ## Dependencies
   ## Data Flow
   ## Risk Areas
   ## Suggested Reading Order
   ```
4. **Budget footer**:
   ```
   ---
   Files Scanned: 3
   Files Selected: 2
   Repo Size:     150 tokens
   Context Size:  420 tokens
   Reduction:     -180.0%   (negative is fine for tiny repos)
   ```
5. **LLM stats block**:
   ```
   ## LLM Stats
   - PLANNER: MiniMax-M3 • 1 call • 1,200 in / 80 out
   - WRITER:  MiniMax-M3 • 1 call • 420 in / 320 out
   ```

If the planner's JSON parse fails, `ctx` does **one repair pass** before
falling back. If the writer's output misses a required `## Section`, it
also does one repair pass. So expect 2-4 LLM calls in stats.

## 5. Trace, review, package

```bash
ctx trace "tax"                  # root-cause a keyword query
ctx review                       # empty diff, no findings
ctx package app/billing.py --output /tmp/pkg.md
cat /tmp/pkg.md
```

For `ctx review` to be interesting, make a real diff:

```bash
git add . && git commit -qm "init"
echo "# TODO: handle non-US regions" >> app/billing.py
git add . && git commit -qm "add TODO"
ctx review                       # → a "## Low" finding naming billing.py
```

## 6. Disable cache for a fresh call (optional)

The LLM response cache makes repeat invocations free for 7 days. To
force a fresh call:

```bash
ctx understand app/billing.py --no-cache
```

Or wipe the cache:

```bash
rm -f .contextforge/llm-cache.json
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Error: openai-compat requires CTX_OPENAI_COMPAT_BASE_URL` | Env var not exported in this shell | Re-export, or `source ~/.zshrc` |
| `401 Unauthorized` | Wrong TokenRouter key, or key missing the right scope | Re-check the key on tokenrouter.com |
| `404 model not found` | Model id typo or not on your plan | Check your TokenRouter dashboard for the exact slug |
| `429 Too Many Requests` | Rate-limited | The `withRetry` wrapper in `ctx` does exponential backoff; wait, or set `--max-steps 4` to use fewer planner rounds |
| Output missing `##` sections | Writer returned prose without headings | The loop's repair pass usually fixes this; if not, file an issue with the model name + the first 30 lines of output |
| `No scannable files found` | You ran from the wrong directory | `cd ~/ctx-demo` directly; `ls app tests` should show the `.py` files |
| `--max-cost 1.00` doesn't stop overspend | `openai-compat` preset has `inputCostPer1M: 0` | Set a spend limit on https://www.tokenrouter.com/ |

## Quick reference

- TokenRouter: <https://www.tokenrouter.com/> (OpenAI-compat, 300+ models)
- ctx repo: <https://github.com/DoozieSoftware/contextforge>
- ctx docs: <https://github.com/DoozieSoftware/contextforge/tree/main/docs>
- TokenRouter base URL: `https://api.tokenrouter.com/v1`
- Auth header: `Authorization: Bearer <key>`

