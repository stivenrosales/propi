"""Generate brand assets with Kie.ai (GPT Image 2.6).

Each job in the JSON file has: id, model, input (passed through to createTask as-is).
The key comes from KIE_API_KEY, or from the env file named by KIE_ENV_FILE, or from .env.local.
The key is never printed.

Usage: KIE_ENV_FILE=~/cartas-sofia/.env python3 -I tools/kie_generate.py brand/jobs.json brand/kie
"""
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

API = "https://api.kie.ai/api/v1/jobs"


def load_key():
    if os.environ.get("KIE_API_KEY"):
        return os.environ["KIE_API_KEY"]
    files = [Path(os.path.expanduser(os.environ["KIE_ENV_FILE"]))] if os.environ.get("KIE_ENV_FILE") else []
    files.append(Path(__file__).resolve().parent.parent / ".env.local")
    for env in files:
        if env.exists():
            for line in env.read_text().splitlines():
                k, _, v = line.partition("=")
                if k.strip().removeprefix("export ").strip() == "KIE_API_KEY" and v.strip():
                    return v.strip().strip('"').strip("'")
    sys.exit("KIE_API_KEY missing")


KEY = load_key()


def call(url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, method="POST" if body else "GET",
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "User-Agent": "propi-brand/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"code": e.code, "msg": e.read().decode(errors="replace")[:300]}


def main():
    jobs = json.load(open(sys.argv[1]))
    only = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None
    out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    tasks = {}
    for j in jobs:
        if only and j["id"] not in only:
            continue
        res = call(f"{API}/createTask", {"model": j["model"], "input": j["input"]})
        tid = (res.get("data") or {}).get("taskId") if res.get("code") == 200 else None
        if tid:
            tasks[j["id"]] = (tid, j["input"].get("output_format", "png")); print(f"[{j['id']}] queued", flush=True)
        else:
            print(f"[{j['id']}] refused: {res.get('code')} {res.get('msg')}", flush=True)
    delay, start = 8, time.time()
    while tasks and time.time() - start < 1800:
        time.sleep(delay)
        for jid, (tid, fmt) in list(tasks.items()):
            res = call(f"{API}/recordInfo?taskId={tid}")
            d = res.get("data") or {}
            if d.get("state") == "success":
                urls = json.loads(d.get("resultJson") or "{}").get("resultUrls", [])
                for i, u in enumerate(urls):
                    p = out / f"{jid}{'-' + str(i) if i else ''}.{fmt}"
                    urllib.request.urlretrieve(u, p); print(f"[{jid}] saved {p} credits={d.get('creditsConsumed')}", flush=True)
                del tasks[jid]
            elif d.get("state") == "fail":
                print(f"[{jid}] failed: {d.get('failCode')} {d.get('failMsg')}", flush=True); del tasks[jid]
        delay = min(delay * 1.3, 20)
    for jid in tasks:
        print(f"[{jid}] timeout", flush=True)


main()
