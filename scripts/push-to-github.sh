#!/usr/bin/env bash
# Publish this fork to GitHub.
#
# Creates the repository (default: private), optionally removes Git LFS tracking
# for the bundled model catalogue, rewrites the local commit authors to the
# GitHub identity, then pushes the feature branch as `main`.
#
# Usage:
#   GH_TOKEN=github_pat_xxx bash scripts/push-to-github.sh --user <login> [options]
#
# Options:
#   --user <login>     GitHub account name (required)
#   --repo <name>      repository name (default: obsidian-quark-sync)
#   --public           create a public repository (default: private)
#   --de-lfs           stop tracking src/ai/models-api.json with LFS and commit
#                      the real file, so a plain `git clone` works without git-lfs
#   --keep-author      do not rewrite the local commits' author identity
#   --dry-run          print what would happen, change nothing
#
# Env:
#   GH_TOKEN           fine-grained or classic PAT with `repo` (contents: write)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

LOGIN=""
REPO="obsidian-quark-sync"
PRIVATE="true"
DE_LFS="false"
KEEP_AUTHOR="false"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--user) LOGIN="${2:-}"; shift 2 ;;
		--repo) REPO="${2:-}"; shift 2 ;;
		--public) PRIVATE="false"; shift ;;
		--de-lfs) DE_LFS="true"; shift ;;
		--keep-author) KEEP_AUTHOR="true"; shift ;;
		--dry-run) DRY_RUN="true"; shift ;;
		-h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
		*) echo "unknown option: $1" >&2; exit 2 ;;
	esac
done

if [[ -z "${GH_TOKEN:-}" ]]; then
	echo "GH_TOKEN is required (PAT with repo / contents:write scope)" >&2
	exit 2
fi

API="https://api.github.com"
PROXY="${GITHUB_PROXY:-http://127.0.0.1:17891}"
api() {
	local method="$1" path="$2" body="${3:-}"
	if [[ -n "$body" ]]; then
		curl -sS -m 30 -x "$PROXY" -X "$method" \
			-H "Authorization: Bearer $GH_TOKEN" \
			-H "Accept: application/vnd.github+json" \
			-H "Content-Type: application/json" \
			-d "$body" "$API$path"
	else
		curl -sS -m 30 -x "$PROXY" -X "$method" \
			-H "Authorization: Bearer $GH_TOKEN" \
			-H "Accept: application/vnd.github+json" "$API$path"
	fi
}

echo "==> verifying token"
ME="$(api GET /user)"
ME_LOGIN="$(printf '%s' "$ME" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("login",""))')"
ME_ID="$(printf '%s' "$ME" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id",""))')"
if [[ -z "$ME_LOGIN" ]]; then
	echo "token check failed:" >&2
	printf '%s\n' "$ME" | head -5 >&2
	exit 1
fi
echo "    authenticated as $ME_LOGIN"
[[ -z "$LOGIN" ]] && LOGIN="$ME_LOGIN"

# ---------------------------------------------------------------------------
echo "==> creating repository $LOGIN/$REPO (private=$PRIVATE)"
if [[ "$DRY_RUN" == "true" ]]; then
	echo "    [dry-run] POST /user/repos {\"name\":\"$REPO\",\"private\":$PRIVATE}"
else
	CREATED="$(api POST /user/repos "{\"name\":\"$REPO\",\"private\":$PRIVATE,\"description\":\"Obsidian plugin: sync a vault with Quark Drive (direct open-platform API or an Alist/OpenList WebDAV gateway). Derived from nutstore/obsidian-nutstore-sync.\"}")"
	if printf '%s' "$CREATED" | grep -q '"full_name"'; then
		echo "    created"
	else
		echo "    create failed (already exists?) — continuing, push will tell"
		printf '%s\n' "$CREATED" | head -5
	fi
fi

# ---------------------------------------------------------------------------
if [[ "$DE_LFS" == "true" ]]; then
	echo "==> dropping LFS tracking for src/ai/models-api.json"
	if [[ "$(git lfs ls-files 2>/dev/null | wc -l)" -gt 0 ]]; then
		echo "    git-lfs present; keeping LFS (skip)"
	elif [[ "$(head -c 20 src/ai/models-api.json)" == version\ https://git-* ]]; then
		echo "    local file is only the LFS pointer — cannot de-LFS" >&2
		exit 1
	else
		if [[ "$DRY_RUN" == "true" ]]; then
			echo "    [dry-run] git rm --cached + edit .gitattributes + commit"
		else
			git rm --cached -q src/ai/models-api.json
			sed -i '/src\/ai\/models-api.json/d' .gitattributes
			git add src/ai/models-api.json .gitattributes
			git -c user.name="$ME_LOGIN" -c user.email="$ME_ID+$ME_LOGIN@users.noreply.github.com" \
				commit -q -m "chore: stop tracking src/ai/models-api.json with Git LFS

The upstream repo stores the bundled model catalogue in Git LFS. Without
git-lfs a plain clone would only get the pointer file, so the real JSON is
tracked normally here (about 1.9 MB)."
			echo "    committed"
		fi
	fi
fi

# ---------------------------------------------------------------------------
if [[ "$KEEP_AUTHOR" != "true" ]]; then
	echo "==> rewriting commit authors to $ME_LOGIN"
	NEW_NAME="$ME_LOGIN"
	NEW_EMAIL="$ME_ID+$ME_LOGIN@users.noreply.github.com"
	BASE="$(git rev-parse origin/main 2>/dev/null || git rev-list --max-parents=0 HEAD | tail -1)"
	if [[ "$DRY_RUN" == "true" ]]; then
		echo "    [dry-run] rebase --exec 'commit --amend --reset-author' $BASE..HEAD"
	else
		GIT_AUTHOR_NAME="$NEW_NAME" GIT_AUTHOR_EMAIL="$NEW_EMAIL" \
		GIT_COMMITTER_NAME="$NEW_NAME" GIT_COMMITTER_EMAIL="$NEW_EMAIL" \
		git -c user.name="$NEW_NAME" -c user.email="$NEW_EMAIL" \
			rebase "$BASE" --exec "git commit --amend --no-edit --reset-author --quiet" >/dev/null
		echo "    done"
	fi
fi

# ---------------------------------------------------------------------------
echo "==> pushing"
if [[ "$DRY_RUN" == "true" ]]; then
	echo "    [dry-run] git push https://<token>@github.com/$LOGIN/$REPO.git HEAD:main"
	exit 0
fi

git config --local "http.https://github.com.proxy" "$PROXY"
git push "https://x-access-token:$GH_TOKEN@github.com/$LOGIN/$REPO.git" HEAD:main

git remote remove fork >/dev/null 2>&1 || true
git remote add fork "https://github.com/$LOGIN/$REPO.git"
echo
echo "Published: https://github.com/$LOGIN/$REPO"
echo "Remote 'fork' added; 'origin' still points at upstream."
