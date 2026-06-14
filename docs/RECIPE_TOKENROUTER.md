# Recipe: test `ctx` on a greenfield with TokenRouter + MiniMax-M3

> **TL;DR** — your two install errors are an old tarball + a corrupt npm cache, not a ctx bug. Fix in this order, then run the recipe.

## 0. One-time install fix (run BEFORE the recipe)

Your recent errors:

- `ENOENT: spawn sh … npm-standalone.js` → npm 11.x's tarball cache is corrupted
- `ENOTDIR: rename '/usr/local/lib/node_modules/contextforge' -> '/usr/local/lib/node_modules/.contextforge-XXX'` → stale symlink/file at the install path
- `TAR_ENTRY_ERROR … rxjs` → tarball was extracted into a path that's now a regular file, not a directory

**Single fix sequence** (copy-paste, the `|| true` lets it keep going if a step doesn't apply):

```bash
# Step 1 — nuke the stale install artifact at the destination
sudo rm -rf /usr/local/lib/node_modules/contextforge \
           /usr/local/lib/node_modules/.contextforge-* \
           /usr/local/lib/lib/node_modules/contextforge 2>/dev/null

# Step 2 — repair the npm cache (root-owned files from earlier sudo invocations)
sudo chown -R "$USER" ~/.npm

# Step 3 — install the latest tag from GitHub
npm install -g @dooz-ecosystem/contextforge

# Step 4 — verify
ctx --version   # → 0.1.6
```

If `ctx --version` still says "command not found" after step 3, your global bin dir isn't on PATH. Most brew installs are fine, but if not:

```bash
# Brew default global bin
echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
which ctx
```

If **step 3** itself fails with a fresh error (not the old `spawn sh`), capture the full log and send it back — that's a new failure mode and we'll trace it.

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
# check your TokenRouter dashboard for the exact slug.
export CTX_PLANNER_MODEL=MiniMax-M3
export CTX_WRITER_MODEL=MiniMax-M3
```

Optional: pin the env so it survives shell restarts.

```bash
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

Expected: stderr says `Files discovered: 3` and stdout is a markdown report. If you see `No scannable files found`, double-check `ls app tests` shows the `.py` files.

## 4. First LLM-backed command

```bash
ctx understand app/billing.py
```

What should happen, top to bottom:

1. **Scanner log** on stderr: `Files discovered: 3`
2. **LLM calls** (2-4 total, in the LLM stats block):
   - Planner: 1-2 calls, returns `{"selectedFiles": [...], "planNotes": "..."}` in a code fence
   - Writer: 1-2 calls, returns the markdown body
3. **Markdown body** with these 5 sections, in order:
   ```
   ## Purpose
   ## Dependencies
   ## Data Flow
   ## Risk Areas
   ## Suggested Reading Order
   ```
4. **Budget footer** (negative reduction is fine for tiny repos)
5. **LLM stats block**:
   ```
   ## LLM Stats
   - PLANNER: MiniMax-M3 • 1 call • 1,200 in / 80 out
   - WRITER:  MiniMax-M3 • 1 call • 420 in / 320 out
   ```

If planner JSON parse fails, ctx does **one repair pass** before falling back. Same for the writer. Expect 2-4 LLM calls in stats.

## 5. Trace, review, package

```bash
ctx trace "tax"                  # root-cause a keyword query
ctx review                       # empty diff, no findings
ctx package app/billing.py --output /tmp/pkg.md
cat /tmp/pkg.md
```

For an interesting `ctx review`:

```bash
git add . && git commit -qm "init"
echo "# TODO: handle non-US regions" >> app/billing.py
git add . && git commit -qm "add TODO"
ctx review                       # → a "## Low" finding naming billing.py
```

## 6. Disable cache for a fresh call (optional)

The LLM response cache makes repeat invocations free for 7 days. To force a fresh call:

```bash
ctx understand app/billing.py --no-cache
# or
rm -f .contextforge/llm-cache.json
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Error: openai-compat requires CTX_OPENAI_COMPAT_BASE_URL` | Env var not exported in this shell | Re-export, or `source ~/.zshrc` |
| `401 Unauthorized` | Wrong TokenRouter key, or missing scope | Re-check the key on tokenrouter.com |
| `404 model not found` | Model id typo or not on your plan | Check your TokenRouter dashboard for the exact slug |
| `429 Too Many Requests` | Rate-limited | The `withRetry` wrapper does exponential backoff; wait, or set `--max-steps 4` |
| Output missing `##` sections | Writer returned prose without headings | The loop's repair pass usually fixes this; if not, file an issue with the model name + first 30 lines |
| `No scannable files found` | Wrong directory | `cd ~/ctx-demo`; `ls app tests` should show `.py` files |
| `ENOENT: spawn sh … npm-standalone.js` (during install) | npm tarball cache corrupted | Re-run step 0 above |
| `ENOTDIR: rename … contextforge` (during install) | Stale install path | Re-run step 0 above |
| `ctx: command not found` after install | Global bin not on PATH | `echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc` |

## Quick reference

- TokenRouter: <https://www.tokenrouter.com/> (OpenAI-compat, 300+ models)
- ctx repo: <https://github.com/DoozieSoftware/contextforge>
- ctx docs: <https://github.com/DoozieSoftware/contextforge/tree/main/docs>
- TokenRouter base URL: `https://api.tokenrouter.com/v1`
- Auth header: `Authorization: Bearer <key>`

## Status: shipped on npm

`@dooz-ecosystem/contextforge@0.1.6` is live on the public registry. Install with:

```bash
npm install -g @dooz-ecosystem/contextforge
ctx --version   # → 0.1.6
```

The `github:` install path is no longer the recommended route — use the scoped
package instead. Re-installs after a new version are automatic on next `npm i -g`.
