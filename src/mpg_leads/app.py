import argparse
import os
import sys

from flask import Flask, jsonify, render_template, request

from mpg_leads.config import ConfigError, load_config
from mpg_leads.fetcher import fetch_nearby, load_demo_businesses
from mpg_leads.pipeline import build_leads, summarize

app = Flask(__name__)
app.config["MPG"] = {}   # populated in main(): {"config": Config, "demo": bool}


def _cfg_dict(cfg):
    return {"search": cfg.search, "personal": cfg.personal, "weights": cfg.weights}


@app.route("/")
def index():
    state = app.config["MPG"]
    cfg = state["config"]
    return render_template(
        "dashboard.html",
        demo=state["demo"],
        company=cfg.personal.get("company", "MPG"),
        operator=cfg.personal.get("name", ""),
        verticals=cfg.search.get("verticals", []),
        radius_km=round(cfg.search.get("radius_meters", 0) / 1000, 1),
        threshold=cfg.search.get("score_threshold", 40),
    )


@app.route("/api/leads")
def api_leads():
    """Run the pipeline and return scored leads + campaigns as JSON."""
    state = app.config["MPG"]
    cfg = state["config"]
    demo = state["demo"] or request.args.get("demo") == "1"

    try:
        if demo:
            businesses = load_demo_businesses()
        else:
            s = cfg.search
            businesses = fetch_nearby(
                api_key=cfg.api_key, location=s["location"],
                radius_meters=s["radius_meters"], included_types=s["verticals"],
                max_results=s.get("batch_size", 20),
            )
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:  # network/HTTP/parse failures surface cleanly
        return jsonify({"error": f"Fetch failed: {e}"}), 502

    rows = build_leads(_cfg_dict(cfg), businesses)
    return jsonify({
        "leads": rows,
        "summary": summarize(rows),
        "demo": demo,
        "threshold": cfg.search.get("score_threshold", 40),
    })


def main(argv=None):
    parser = argparse.ArgumentParser(description="MPG lead dashboard (local)")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--demo", action="store_true",
                        help="Use bundled demo data; no API key needed")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args(argv)

    try:
        cfg = load_config(args.config, require_key=not args.demo)
    except ConfigError as e:
        print(f"Config error: {e}", file=sys.stderr)
        return 2

    app.config["MPG"] = {"config": cfg, "demo": args.demo}
    mode = "DEMO (bundled data)" if args.demo else "LIVE (Google Places API)"
    print(f"MPG lead dashboard — {mode}")
    print(f"Open http://127.0.0.1:{args.port} in your browser. Ctrl-C to stop.")
    app.run(host="127.0.0.1", port=args.port, debug=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
