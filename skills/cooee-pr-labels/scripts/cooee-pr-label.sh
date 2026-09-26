#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  cooee-pr-label.sh status [PR]
  cooee-pr-label.sh apply --confirmed <cooee:label> <PR>
  cooee-pr-label.sh replace --confirmed <old-cooee:label> <new-cooee:label> <PR>

PR may be a pull request number, URL, or branch. It may be omitted only for
status, in which case GitHub CLI uses the pull request for the current branch.
EOF
}

require_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "GitHub CLI (gh) is required. Install it and authenticate with 'gh auth login'." >&2
    exit 1
  fi

  if ! gh auth status >/dev/null 2>&1; then
    echo "GitHub CLI is not authenticated. Run 'gh auth login' and retry." >&2
    exit 1
  fi
}

label_details() {
  case "$1" in
    cooee:feature)
      printf '%s\t%s\n' '0969DA' 'Cooee changelog: new customer capability.'
      ;;
    cooee:improvement)
      printf '%s\t%s\n' '1D76DB' 'Cooee changelog: improved customer workflow or quality.'
      ;;
    cooee:fix)
      printf '%s\t%s\n' 'D73A4A' 'Cooee changelog: customer-visible bug fix.'
      ;;
    cooee:maintenance)
      printf '%s\t%s\n' '6A737D' 'Cooee changelog: customer-relevant maintenance.'
      ;;
    cooee:skip)
      printf '%s\t%s\n' 'B60205' 'Exclude this pull request from Cooee changelog generation.'
      ;;
    cooee:internal)
      printf '%s\t%s\n' '5319E7' 'Exclude this internal pull request from Cooee changelog generation.'
      ;;
    cooee:private)
      printf '%s\t%s\n' 'B60205' 'Cooee privacy label; configure it in Cooee before relying on it.'
      ;;
    *)
      printf '%s\t%s\n' '8250DF' 'Cooee changelog category override.'
      ;;
  esac
}

repository_from_pr() {
  local pr="$1"
  if [[ "$pr" =~ ^https?://([^/]+)/([^/]+/[^/]+)/pull/[0-9]+/?$ ]]; then
    local host="${BASH_REMATCH[1]}"
    local repository="${BASH_REMATCH[2]}"
    if [[ "$host" == "github.com" ]]; then
      printf '%s\n' "$repository"
    else
      printf '%s/%s\n' "$host" "$repository"
    fi
  fi
}

ensure_label() {
  local label="$1"
  local repository="${2:-}"
  local repo_args=()
  if [[ -n "$repository" ]]; then
    repo_args=(--repo "$repository")
  fi

  if gh label list "${repo_args[@]}" --limit 1000 --json name --jq '.[].name' | grep -Fqx -- "$label"; then
    return
  fi

  local details color description
  details="$(label_details "$label")"
  color="${details%%$'\t'*}"
  description="${details#*$'\t'}"
  gh label create "$label" "${repo_args[@]}" --color "$color" --description "$description"
}

is_cooee_label() {
  [[ "$1" =~ ^cooee:[a-z0-9]+(-[a-z0-9]+)*$ ]]
}

command="${1:-}"
if [[ -z "$command" || "$command" == "--help" || "$command" == "-h" ]]; then
  usage
  exit 0
fi
shift

require_gh

case "$command" in
  status)
    if [[ "$#" -gt 1 ]]; then
      usage >&2
      exit 2
    fi
    if [[ "$#" -eq 1 ]]; then
      gh pr view "$1" --json number,title,body,url,baseRefName,headRefName,labels
    else
      gh pr view --json number,title,body,url,baseRefName,headRefName,labels
    fi
    ;;
  apply)
    if [[ "${1:-}" != "--confirmed" ]]; then
      echo "Refusing to change the PR without --confirmed. Ask the user to confirm the exact Cooee label first." >&2
      exit 2
    fi
    shift
    if [[ "$#" -ne 2 ]] || ! is_cooee_label "$1"; then
      echo "apply requires --confirmed, a label in the form cooee:<category-id>, and the confirmed PR." >&2
      usage >&2
      exit 2
    fi
    label="$1"
    pr="$2"
    ensure_label "$label" "$(repository_from_pr "$pr")"
    gh pr edit "$pr" --add-label "$label"
    echo "Added $label to the pull request. Existing labels were preserved."
    ;;
  replace)
    if [[ "${1:-}" != "--confirmed" ]]; then
      echo "Refusing to change the PR without --confirmed. Ask the user to confirm the exact replacement first." >&2
      exit 2
    fi
    shift
    if [[ "$#" -ne 3 ]] || ! is_cooee_label "$1" || ! is_cooee_label "$2" || [[ "$1" == "$2" ]]; then
      echo "replace requires --confirmed, different old and new cooee:<category-id> labels, and the confirmed PR." >&2
      usage >&2
      exit 2
    fi
    old_label="$1"
    new_label="$2"
    pr="$3"
    ensure_label "$new_label" "$(repository_from_pr "$pr")"
    gh pr edit "$pr" --remove-label "$old_label" --add-label "$new_label"
    echo "Replaced $old_label with $new_label on the pull request. Other labels were preserved."
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
