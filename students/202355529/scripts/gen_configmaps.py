"""src/ 의 파일을 k8s/ ConfigMap YAML로 변환한다.

사용법 (학번 폴더에서):
    python scripts/gen_configmaps.py

포트폴리오 내용(src/portfolio.json)이나 게임 화면을 고친 뒤 실행하면
k8s/ 의 ConfigMap 파일이 다시 만들어진다. 이후:
    oc apply -f k8s/
    oc rollout restart deployment/tia-web   # 마운트된 파일 갱신을 즉시 반영
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
K8S = ROOT / "k8s"

CONFIGMAPS = [
    ("04-web-configmap-app.yaml", "tia-web-app", "웹 서버 코드 (이미지 빌드 없이 Python 이미지에 주입)",
     [SRC / "server.py"]),
    ("05-web-configmap-static.yaml", "tia-web-static", "게임 화면 정적 파일",
     [SRC / "static" / "index.html", SRC / "static" / "game.js", SRC / "static" / "style.css"]),
    ("06-web-configmap-portfolio.yaml", "tia-portfolio", "포트폴리오 데이터 (코드 수정 없이 경력만 갱신 가능)",
     [SRC / "portfolio.json"]),
]


def block(text: str) -> str:
    lines = text.replace("\t", "    ").rstrip("\n").split("\n")
    return "\n".join(("    " + l) if l.strip() else "" for l in [l.rstrip() for l in lines])


def render(name: str, comment: str, files) -> str:
    out = [
        "# 자동 생성 파일: scripts/gen_configmaps.py 로 다시 만든다. 직접 수정하지 말 것.",
        f"# {comment}",
        "apiVersion: v1",
        "kind: ConfigMap",
        "metadata:",
        f"  name: {name}",
        "  labels:",
        "    app.kubernetes.io/name: tia-web",
        "    app.kubernetes.io/part-of: tia-roadmap",
        "data:",
    ]
    for f in files:
        out.append(f"  {f.name}: |")
        out.append(block(f.read_text(encoding="utf-8")))
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    for filename, name, comment, files in CONFIGMAPS:
        existing = [f for f in files if f.exists()]
        if not existing:
            continue
        (K8S / filename).write_text(render(name, comment, existing), encoding="utf-8")
        size = sum(f.stat().st_size for f in existing)
        print(f"k8s/{filename}  ({name}, {len(existing)} files, {size:,} bytes)")
