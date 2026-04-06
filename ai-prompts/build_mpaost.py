import re
import os

base_dir = 'ai-prompts'
src_file = os.path.join(base_dir, 'You.com _ Agentic Open-Source Tools (2026 Edition).html')
files_dir = os.path.join(base_dir, 'You.com _ Agentic Open-Source Tools (2026 Edition)_files')
out_file = os.path.join(base_dir, 'mpaost.html')

with open(src_file, 'r', encoding='utf-8', errors='replace') as f:
    html = f.read()

# Read CSS files to inline
css_files = [
    'you-staging.shared.28bccd38e.min.css',
    'you-staging.68ea5ba5a4958d9b677684d6-8f9cda416.min.css',
    'swiper-bundle.min.css',
]
css_content = ''
for cf in css_files:
    cf_path = os.path.join(files_dir, cf)
    if os.path.exists(cf_path):
        with open(cf_path, 'r', encoding='utf-8', errors='replace') as f:
            css_content += f'/* === {cf} === */\n' + f.read() + '\n'

# Remove the link tags pointing to local css files
html = re.sub(r'<link[^>]+You\.com _ Agentic Open-Source Tools[^>]+\.css[^>]+>', '', html)

# Inject combined CSS just before </head>
inline_style = f'<style>\n{css_content}\n</style>'
html = html.replace('</head>', inline_style + '\n</head>', 1)

# Fix local image src -> use CDN srcset first URL
def fix_img_src(m):
    tag = m.group(0)
    srcset_match = re.search(r'srcset="([^"]+)"', tag)
    if srcset_match:
        first_src = srcset_match.group(1).split(' ')[0]
        tag = re.sub(r'src="\.\/You\.com[^"]*"', f'src="{first_src}"', tag)
    return tag

html = re.sub(r'<img[^>]+>', fix_img_src, html)

# Remove tracking scripts
patterns_to_remove = [
    r'<script[^>]*googletagmanager[^>]*>.*?</script>',
    r'<script[^>]*gtm\.js[^>]*></script>',
    r'<script[^>]*warmly[^>]*></script>',
    r'<script[^>]*hs-scripts[^>]*></script>',
    r'<script[^>]*osano[^>]*></script>',
    r'<script[^>]*intellimize[^>]*>.*?</script>',
    r'<script[^>]*117332554[^>]*></script>',
]
for p in patterns_to_remove:
    html = re.sub(p, '', html, flags=re.DOTALL | re.IGNORECASE)

# Remove script tags pointing to local .js.download files
html = re.sub(r'<script[^>]*You\.com _ Agentic Open-Source Tools[^>]*></script>', '', html)
html = re.sub(r'<link[^>]*You\.com _ Agentic Open-Source Tools[^>]*/>', '', html)

# Analysis text to prepend
analysis = """<section id="filmbuff-analysis" style="background:#1a1a2e;color:#e8e8f0;padding:2.5rem 2rem;font-family:system-ui,sans-serif;border-bottom:3px solid #5368EE;">
<div style="max-width:860px;margin:0 auto;">
<h1 style="color:#bdfd2e;font-size:1.6rem;margin-bottom:0.5rem;">FilmBuff × Agentic Open-Source Tools: Applicability Analysis</h1>
<p style="color:#aaa;font-size:0.85rem;margin-bottom:2rem;">Source: <a href="https://you.com/resources/popular-agentic-open-source-tools-2026" style="color:#5368EE;">you.com/resources/popular-agentic-open-source-tools-2026</a></p>

<h2 style="color:#bdfd2e;font-size:1.2rem;border-bottom:1px solid #333;padding-bottom:0.5rem;margin-bottom:1rem;">✅ Highly Applicable — Direct Fit</h2>

<h3 style="color:#e8e8f0;margin-top:1.5rem;">1. LangGraph ⭐ 23k</h3>
<p><strong>Why it fits:</strong> FilmBuff's 10-step production pipeline (<code style="background:#333;padding:2px 6px;border-radius:3px;">filmbuff start → continue → complete</code>) is <em>exactly</em> what LangGraph is designed for — stateful, multi-step workflows with conditional paths, retries, and human-in-the-loop checkpoints. The current pipeline uses a <code style="background:#333;padding:2px 6px;border-radius:3px;">project_steps</code> state machine in SQLite. LangGraph would let you define that pipeline as a first-class graph with explicit nodes (logline, synopsis, treatment…) and edges, handling retry logic and step branching natively — replacing the custom state machine code in <code style="background:#333;padding:2px 6px;border-radius:3px;">start.ts</code>, <code style="background:#333;padding:2px 6px;border-radius:3px;">continue.ts</code>, <code style="background:#333;padding:2px 6px;border-radius:3px;">complete.ts</code>.</p>

<h3 style="color:#e8e8f0;margin-top:1.5rem;">2. Promptfoo ⭐ 10k</h3>
<p><strong>Why it fits:</strong> FilmBuff already has <code style="background:#333;padding:2px 6px;border-radius:3px;">ai-prompts/</code> (including the open <code style="background:#333;padding:2px 6px;border-radius:3px;">write-docs-prompt.md</code>), and routes to three providers (Anthropic, OpenAI, Google). Promptfoo is a prompt regression testing framework — you write test cases, point it at your prompts and providers, and it evaluates output quality automatically. Every time you edit a prompt, you can run <code style="background:#333;padding:2px 6px;border-radius:3px;">promptfoo eval</code> to ensure the change didn't regress a prior use case. It generates a side-by-side comparison dashboard showing which provider scored best on each test. Given that FilmBuff already has multiple prompts and providers, this is a near-zero-config addition.</p>

<h3 style="color:#e8e8f0;margin-top:1.5rem;">3. Helicone ⭐ 5k</h3>
<p><strong>Why it fits:</strong> FilmBuff makes live LLM calls across Anthropic, OpenAI, and Google. Helicone is an open-source LLM observability proxy — drop it between your provider calls and instantly get token usage, latency, cost-per-call, and error tracking. The current JSONL logging in <code style="background:#333;padding:2px 6px;border-radius:3px;">document-repository.ts</code> tracks generation attempts manually. Helicone would give you a full dashboard automatically, without changing your core logic, just by pointing the SDK base URL to the Helicone proxy.</p>

<h2 style="color:#bdfd2e;font-size:1.2rem;border-bottom:1px solid #333;padding-bottom:0.5rem;margin-top:2rem;margin-bottom:1rem;">⚠️ Moderately Applicable — Useful with Some Work</h2>

<h3 style="color:#e8e8f0;margin-top:1.5rem;">4. LlamaIndex ⭐ 38k</h3>
<p><strong>Why it fits:</strong> If FilmBuff were to add screenplay ingestion (parsing uploaded screenplays for context, style matching, or reference), LlamaIndex provides the full document-to-vector-to-query pipeline. Not immediately needed, but a natural next step if the pipeline grows to include "write in the style of [existing screenplay]" features.</p>

<h3 style="color:#e8e8f0;margin-top:1.5rem;">5. n8n ⭐ 53k</h3>
<p><strong>Why it fits:</strong> The 10-step pipeline could be externalized into n8n workflows, making it configurable without code changes. n8n also handles webhook triggers — useful if FilmBuff ever needs to trigger a pipeline from an external event (e.g., a Beads task update or a CI event).</p>

<h2 style="color:#bdfd2e;font-size:1.2rem;border-bottom:1px solid #333;padding-bottom:0.5rem;margin-top:2rem;margin-bottom:1rem;">❌ Not Applicable — Wrong Fit for This Project</h2>
<table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
<thead><tr style="border-bottom:1px solid #444;"><th style="text-align:left;padding:6px 8px;color:#aaa;">Tool</th><th style="text-align:left;padding:6px 8px;color:#aaa;">Reason</th></tr></thead>
<tbody>
<tr style="border-bottom:1px solid #2a2a3e;"><td style="padding:6px 8px;"><strong>CrewAI</strong></td><td style="padding:6px 8px;">Multi-agent orchestration; FilmBuff uses single-agent, sequential steps</td></tr>
<tr style="border-bottom:1px solid #2a2a3e;"><td style="padding:6px 8px;"><strong>AutoGen</strong></td><td style="padding:6px 8px;">Conversational multi-agent; FilmBuff has a defined linear pipeline</td></tr>
<tr style="border-bottom:1px solid #2a2a3e;"><td style="padding:6px 8px;"><strong>Haystack / AutoRAG / Ragas</strong></td><td style="padding:6px 8px;">Require an established RAG pipeline that doesn't exist yet</td></tr>
<tr style="border-bottom:1px solid #2a2a3e;"><td style="padding:6px 8px;"><strong>Appwrite</strong></td><td style="padding:6px 8px;">Cloud backend platform; FilmBuff uses local SQLite</td></tr>
<tr style="border-bottom:1px solid #2a2a3e;"><td style="padding:6px 8px;"><strong>Browser Use</strong></td><td style="padding:6px 8px;">No web scraping / browser interaction use case</td></tr>
<tr style="border-bottom:1px solid #2a2a3e;"><td style="padding:6px 8px;"><strong>Semantic Kernel</strong></td><td style="padding:6px 8px;">.NET-centric; FilmBuff is TypeScript/Node.js</td></tr>
<tr style="border-bottom:1px solid #2a2a3e;"><td style="padding:6px 8px;"><strong>Composio</strong></td><td style="padding:6px 8px;">SaaS API integrations; FilmBuff is a local CLI tool</td></tr>
<tr style="border-bottom:1px solid #2a2a3e;"><td style="padding:6px 8px;"><strong>OpenHands</strong></td><td style="padding:6px 8px;">Full autonomous coding agent; different scope entirely</td></tr>
<tr style="border-bottom:1px solid #2a2a3e;"><td style="padding:6px 8px;"><strong>GPT Researcher</strong></td><td style="padding:6px 8px;">Research synthesis; FilmBuff generates creative content</td></tr>
<tr><td style="padding:6px 8px;"><strong>GitHub Copilot SDK</strong></td><td style="padding:6px 8px;">Only relevant for Copilot extension development</td></tr>
</tbody>
</table>

<h2 style="color:#bdfd2e;font-size:1.2rem;border-bottom:1px solid #333;padding-bottom:0.5rem;margin-top:2rem;margin-bottom:1rem;">🎯 Priority Recommendation</h2>
<p>If you were to integrate one tool today, <strong>Promptfoo</strong> has the lowest barrier — you have the prompts already in <code style="background:#333;padding:2px 6px;border-radius:3px;">ai-prompts/</code> and three providers to compare against. <strong>LangGraph</strong> would be the highest-impact architectural change, essentially replacing the custom pipeline state machine with a purpose-built framework.</p>
</div>
</section>"""

# Insert analysis after <body ...>
html = re.sub(r'(<body[^>]*>)', r'\1\n' + analysis, html, count=1)

with open(out_file, 'w', encoding='utf-8') as f:
    f.write(html)

print(f'Written to {out_file} ({len(html)} chars)')

