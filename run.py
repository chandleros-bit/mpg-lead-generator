"""Launcher for the MPG lead dashboard. Run:  python run.py --demo"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from mpg_leads.app import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
