#!/usr/bin/env python3
"""Publish the phone dashboard.

Runs dashboard_data.py and writes docs/data.json. If that file changed, commits
only that file and pushes it, so GitHub Pages (the docs/ folder on master) updates.

The trading files (portfolio, ledger, logs, state) are left uncommitted.
A token in ~/.config/altcoins-trader/github_token is read for the push and is
never written into the repository.

    python3 publish_data.py
    python3 publish_data.py --no-push
"""
import argparse
import json
import os
import re
import stat
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_REL = os.path.join("docs", "data.json")
OUT = os.path.join(HERE, OUT_REL)
TOKEN_PATH = os.path.expanduser("~/.config/altcoins-trader/github_token")
SECRET_MARKERS = (
    "private_key", "api_key", "api_secret", "secret_key", "ghp_", "github_pat_",
    "BEGIN RSA", "BEGIN OPENSSH", "BEGIN PRIVATE", "x-access-token",
)


def redact(text):
    text = re.sub(r"ghp_[A-Za-z0-9]+", "ghp_[redacted]", text or "")
    text = re.sub(r"github_pat_[A-Za-z0-9_]+", "github_pat_[redacted]", text)
    text = re.sub(r"(https://)[^/\s@]+@", r"\1", text)
    text = re.sub(r"x-access-token[:\s]+\S+", "x-access-token [redacted]", text)
    return text


def run(cmd, env=None, check=True):
    proc = subprocess.run(cmd, cwd=HERE, env=env, text=True, capture_output=True)
    if check and proc.returncode != 0:
        msg = redact((proc.stderr or proc.stdout or "").strip()) or "command failed: " + " ".join(cmd)
        raise SystemExit(msg)
    return proc


def load_token():
    for key in ("GH_TOKEN", "GITHUB_TOKEN"):
        val = os.environ.get(key, "").strip()
        if val:
            return val
    if os.path.isfile(TOKEN_PATH):
        with open(TOKEN_PATH) as f:
            return f.read().strip()
    return ""


def build_json():
    proc = subprocess.run(
        [sys.executable, os.path.join(HERE, "dashboard_data.py")],
        cwd=HERE, text=True, capture_output=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or "")
        raise SystemExit(proc.returncode or 1)
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise SystemExit("dashboard_data.py did not print JSON (%s)" % e)
    if "account" not in data:
        raise SystemExit("dashboard_data.py JSON has no account block")
    raw = json.dumps(data, indent=1, ensure_ascii=False, default=str) + "\n"
    low = raw.lower()
    for mark in SECRET_MARKERS:
        if mark.lower() in low:
            raise SystemExit("refusing to publish docs/data.json: it contains %r" % mark)
    return data, raw


def write_out(raw):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, OUT)


def git_identity():
    name = subprocess.run(["git", "config", "user.name"], cwd=HERE, capture_output=True, text=True)
    email = subprocess.run(["git", "config", "user.email"], cwd=HERE, capture_output=True, text=True)
    args = []
    if name.returncode != 0 or not name.stdout.strip():
        args += ["-c", "user.name=Altcoins Trader"]
    if email.returncode != 0 or not email.stdout.strip():
        args += ["-c", "user.email=paper-bot@localhost"]
    return args


def file_changed():
    tracked = subprocess.run(["git", "ls-files", "--error-unmatch", OUT_REL], cwd=HERE, capture_output=True)
    if tracked.returncode != 0:
        return True
    diff = subprocess.run(["git", "diff", "--quiet", "--", OUT_REL], cwd=HERE)
    return diff.returncode != 0


def commit(message):
    run(["git", "add", "--", OUT_REL])
    cached = subprocess.run(["git", "diff", "--cached", "--quiet", "--", OUT_REL], cwd=HERE)
    if cached.returncode == 0:
        print("docs/data.json unchanged, nothing to commit")
        return False
    run(["git"] + git_identity() + ["commit", "-m", message, "--", OUT_REL])
    return True


def push(remote, branch, token):
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    ask = None
    try:
        if token:
            fd, ask = tempfile.mkstemp(prefix="altcoins-askpass-", suffix=".sh")
            os.write(
                fd,
                b"#!/bin/sh\n"
                b"case \"$1\" in\n"
                b"  *Username*|*username*) printf '%s\\n' 'x-access-token' ;;\n"
                b"  *) printf '%s\\n' \"$ALTCOINS_GH_TOKEN\" ;;\n"
                b"esac\n",
            )
            os.close(fd)
            os.chmod(ask, stat.S_IRUSR | stat.S_IXUSR)
            env["GIT_ASKPASS"] = ask
            env["ALTCOINS_GH_TOKEN"] = token
        return subprocess.run(
            ["git", "push", remote, "HEAD:%s" % branch],
            cwd=HERE, env=env, text=True, capture_output=True,
        )
    finally:
        if ask and os.path.exists(ask):
            os.remove(ask)


def retry_push(remote, branch, token):
    """Remote moved. Park other local edits, rebase this commit, push, restore."""
    env = os.environ.copy()
    env["GIT_EDITOR"] = "true"
    stash = subprocess.run(["git", "stash", "push", "-m", "publish-data"], cwd=HERE, text=True, capture_output=True)
    stashed = "No local changes" not in (stash.stdout or "")
    try:
        run(["git", "pull", "--rebase", remote, branch], env=env)
        proc = push(remote, branch, token)
        if proc.returncode != 0:
            raise SystemExit(redact((proc.stderr or proc.stdout or "git push failed").strip()))
    finally:
        if stashed:
            pop = subprocess.run(["git", "stash", "pop"], cwd=HERE, text=True, capture_output=True)
            if pop.returncode != 0:
                sys.stderr.write(redact((pop.stderr or pop.stdout or "").strip()) + "\n")
                sys.stderr.write("The dashboard file was pushed. Other local edits are saved in git stash.\n")


def main():
    ap = argparse.ArgumentParser(description="Publish docs/data.json for the phone dashboard")
    ap.add_argument("--no-push", action="store_true", help="write docs/data.json and stop")
    ap.add_argument("--allow-branch", action="store_true", help="commit even if this checkout is not master")
    ap.add_argument("--remote", default="origin")
    args = ap.parse_args()

    data, raw = build_json()
    write_out(raw)
    stamp = data.get("last_updated_athens") or "update"
    print("wrote %s (%s)" % (OUT_REL, stamp))
    if args.no_push:
        return

    branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    if branch in ("HEAD", ""):
        raise SystemExit("detached HEAD: check out master on the server before publishing")
    if branch not in ("master", "main") and not args.allow_branch:
        raise SystemExit(
            "This checkout is on '%s'. The phone site is the docs folder on master. "
            "Check out master on the server, or pass --allow-branch." % branch
        )
    if not file_changed():
        print("docs/data.json unchanged, nothing to commit")
        return
    if not commit("Update phone dashboard data (%s Athens)" % stamp):
        return
    proc = push(args.remote, branch, load_token())
    if proc.returncode != 0:
        err = (proc.stderr or "") + (proc.stdout or "")
        if any(s in err.lower() for s in ("non-fast-forward", "fetch first", "failed to push some refs")):
            print("remote is ahead, rebasing this one commit and pushing again")
            retry_push(args.remote, branch, load_token())
        else:
            raise SystemExit(redact(err.strip()) or "git push failed")
    print("pushed %s" % branch)


if __name__ == "__main__":
    main()
