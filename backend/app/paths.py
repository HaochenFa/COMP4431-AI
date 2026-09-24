from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
SNAPSHOTS = DATA / "snapshots"
TRACES = ROOT / "backend" / "traces"
SKILLS = Path(__file__).resolve().parent / "skills"
PROMPTS = Path(__file__).resolve().parent / "agent" / "prompts"
