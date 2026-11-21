#!/usr/bin/env bash
# Contract for the owner handbook: one page per language with the same sections, every command of `burhan --help`
# named in both, no removed feature, links that resolve, the two PDFs present and tracked, nothing of it in the package.
. "$(dirname "$0")/lib.sh"
cd "$T_ROOT" || exit 1

EN=handbook/en/handbook.html
AR=handbook/handbook.html
PDF_EN=handbook/en/burhan-handbook-en.pdf
PDF_AR=handbook/burhan-handbook.pdf
GH='https://github.com/ahmedkamaldabour/burhan-kit/'

# Inside a git work tree a file must be listed by `git ls-files`; a source archive has no work tree, so it passes there.
in_git="$(git rev-parse --is-inside-work-tree 2>/dev/null || true)"
is_tracked() { [ -f "$1" ] && { [ "$in_git" != true ] || git ls-files --error-unmatch -- "$1" >/dev/null 2>&1; }; }
count() { grep -o -- "$2" "$1" 2>/dev/null | wc -l | tr -d ' '; }
# The words a reader sees: the style block and the tags are left out.
words() { awk '/<style>/{s=1} !s{print} /<\/style>/{s=0}' "$1" 2>/dev/null | sed 's/<[^>]*>/ /g' | wc -w | tr -d ' '; }

# The command set: every form `burhan --help` lists is named in both pages, in a code element that starts with the form.
check "commands: dist/cli.js exists (run npm run build first)" "$([ -f dist/cli.js ] && echo yes)" has yes
help_forms="$(node dist/cli.js --help 2>&1 | sed -n 's/^  \([a-z][a-z-]*\)\( [a-z][a-z-]*\)\{0,1\}\( .*\)\{0,1\}$/\1\2/p' | sort -u)"
n_forms=0
while IFS= read -r form; do
  [ -n "$form" ] || continue
  n_forms=$((n_forms + 1))
  for f in "$EN" "$AR"; do
    named=""; grep -Eq -- "<code>${form}([ <&]|$)" "$f" 2>/dev/null && named=yes
    check "commands: $f names the command form: $form" "$named" has yes
  done
done <<< "$help_forms"
check "commands: the help lists at least 30 forms (never a pass on an empty list)" "$([ "$n_forms" -ge 30 ] && echo yes)" has yes

for f in "$EN" "$AR"; do
  body="$(cat "$f" 2>/dev/null)"
  check "page: $f exists and is not empty" "$([ -s "$f" ] && echo yes)" has yes
  check "page: $f is an HTML5 document" "$(head -n 1 "$f" 2>/dev/null)" has '<!doctype html>'
  check "page: $f has no script" "$body" lacks '<script'
  check "page: $f has no link element (one self-contained file)" "$body" lacks '<link'
  check "page: $f has no image" "$body" lacks '<img'
  check "page: $f has its own style block" "$body" has '<style>'
  check "page: $f has an A4 print stylesheet" "$body" has '@page{size:A4'
  check "page: $f has dark colours" "$body" has 'prefers-color-scheme:dark'
  n="$(words "$f")"
  check "size: $f has 1500 to 4000 words (words: $n)" "$([ "$n" -ge 1500 ] && [ "$n" -le 4000 ] && echo yes)" has yes
  n="$(count "$f" 'class="source"')"
  check "page: $f has at least 8 source lines (count: $n)" "$([ "$n" -ge 8 ] && echo yes)" has yes

  # What was removed or renamed must not come back.
  for gone in 'Superpowers' 'superpowers' 'WF_SKILLS' 'allow-outside-settings' 'work/<task>/' 'work/&lt;task&gt;/'; do
    check "banned: $f lacks $gone" "$body" lacks "$gone"
  done
  # One stamp line carries the version and the commit; no other line names a version number.
  check_eq "stamp: $f has exactly one stamp line" "$(count "$f" 'class="stamp"')" 1
  stamp="$(grep 'class="stamp"' "$f" 2>/dev/null)"
  check "stamp: $f stamp names a version" "$(printf '%s' "$stamp" | grep -oE '(^|[^0-9.])0\.[0-9]+\.[0-9]+' | head -n 1)" has '0.'
  check "stamp: $f stamp names a commit" "$(printf '%s' "$stamp" | grep -oE '<code>[0-9a-f]{7,40}</code>' | head -n 1)" has '<code>'
  check "banned: $f has no version number outside the stamp" "$(grep -v 'class="stamp"' "$f" 2>/dev/null | grep -nE '(^|[^0-9.])0\.[0-9]+\.[0-9]+' || true)" lacks ':'

  # Facts the pages must carry (names, not sentences).
  for needle in 'all 6 hooks wired' 'NNN-slug' '--apply' '--already-satisfied' 'allow-outside-links' 'WF_ITEM_CONTRACT' \
    'ubuntu-24.04' 'macos-latest' 'windows-latest' 'ci.yml' 'release.yml' '2.1.139' 'npm i -D burhan-kit' 'npm i -g burhan-kit' 'kit command' \
    'burhan-story' 'burhan-plan' 'burhan-build' 'burhan-debug' 'burhan-review' 'burhan-done' \
    'session-gates' 'prompt-router' 'pre-commit-check' 'pre-edit-skill' 'post-edit-reminder' 'turn-audit'; do
    check "facts: $f has $needle" "$body" has "$needle"
  done

  # A setting a page names is a key of the kit's example config (or the WF_MODE_<TYPE>_<SCOPE> family).
  n_keys=0
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    n_keys=$((n_keys + 1))
    if [ "$key" = WF_MODE_ ]; then ok=yes; else ok="$(grep -q "^$key=" kit/workflow.config.example && echo yes)"; fi
    check "settings: $f key $key is in kit/workflow.config.example" "$ok" has yes
  done <<< "$(grep -o 'WF_[A-Z0-9_]*' "$f" 2>/dev/null | sort -u)"
  check "settings: $f names at least 10 keys (count: $n_keys)" "$([ "$n_keys" -ge 10 ] && echo yes)" has yes

  # Every link resolves: an anchor of the page, a file next to it, or a file of the repository by its absolute URL.
  dir="$(dirname "$f")"
  n_links=0
  while IFS= read -r href; do
    [ -n "$href" ] || continue
    n_links=$((n_links + 1))
    case "$href" in
      '#'*) ok="$(grep -qF "id=\"${href#\#}\"" "$f" && echo yes)" ;;
      "${GH}issues"|'https://www.npmjs.com/package/burhan-kit') ok=yes ;;
      "${GH}blob/main/"*|"${GH}tree/main/"*)
        p="$(printf '%s' "$href" | sed -E 's#^https://github.com/ahmedkamaldabour/burhan-kit/(blob|tree)/main/##; s/#.*$//')"
        ok="$([ -e "$p" ] && echo yes)" ;;
      http*) ok="" ;;
      *) ok="$([ -e "$dir/${href%%#*}" ] && echo yes)" ;;
    esac
    check "links: $f link $href resolves" "$ok" has yes
  done <<< "$(grep -o 'href="[^"]*"' "$f" 2>/dev/null | sed 's/^href="//; s/"$//' | sort -u)"
  check "links: $f has at least 5 links (count: $n_links)" "$([ "$n_links" -ge 5 ] && echo yes)" has yes
done
check "page: the English page is lang en, left to right" "$(cat "$EN" 2>/dev/null)" has '<html lang="en" dir="ltr">'
check "page: the Arabic page is lang ar, right to left" "$(cat "$AR" 2>/dev/null)" has '<html lang="ar" dir="rtl">'

# The two pages are one book in two languages.
check_eq "sections: the two pages carry the same ids in the same order" "$(grep -o ' id="[^"]*"' "$EN" 2>/dev/null | tr '\n' ' ')" "$(grep -o ' id="[^"]*"' "$AR" 2>/dev/null | tr '\n' ' ')"
n="$(count "$EN" '<h2')"
check "sections: the English page has at least 8 sections (count: $n)" "$([ "$n" -ge 8 ] && echo yes)" has yes
for tag in '<h2' '<h3' '<table' '<tr' '<pre' 'class="source"'; do
  check_eq "pair: same number of $tag" "$(count "$EN" "$tag")" "$(count "$AR" "$tag")"
done
check "pair: the English page links the Arabic one" "$(cat "$EN" 2>/dev/null)" has 'href="../handbook.html"'
check "pair: the Arabic page links the English one" "$(cat "$AR" 2>/dev/null)" has 'href="en/handbook.html"'

# The old overview pages are retired.
for gone in handbook/index.html handbook/en/index.html; do
  check "retired: $gone does not exist" "$([ ! -e "$gone" ] && echo yes)" has yes
done

# The PDFs are there, are PDFs, and everything of the handbook is tracked. (A test cannot tell whether a PDF is fresh.)
for p in "$PDF_EN" "$PDF_AR"; do
  check "pdf: $p exists and is not empty" "$([ -s "$p" ] && echo yes)" has yes
  check "pdf: $p starts with %PDF-" "$(head -c 5 "$p" 2>/dev/null)" has '%PDF-'
done
for p in "$EN" "$AR" "$PDF_EN" "$PDF_AR" handbook/README.md; do
  check "tracked: $p is in git ls-files" "$(is_tracked "$p" && echo yes)" has yes
done

# The print command is written in the repository.
rec="$(cat handbook/README.md 2>/dev/null)"
for needle in '--headless' '--print-to-pdf' '--no-pdf-header-footer' "$EN" "$AR" "$PDF_EN" "$PDF_AR"; do
  check "print: handbook/README.md has $needle" "$rec" has "$needle"
done

# The handbook is not in the npm package.
check "package: package.json has a files list" "$(node -e 'console.log("files:" + (require("./package.json").files || []).length)')" has 'files:'
check "package: package.json files names no handbook path" "$(node -e 'console.log((require("./package.json").files || []).join(" "))')" lacks 'handbook'
if command -v npm >/dev/null 2>&1; then
  packed="$(npm_config_logs_max=0 npm pack --dry-run --ignore-scripts --json 2>/dev/null | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8"))[0].files.map((f) => f.path).join("\n"))' 2>/dev/null)"
  check "package: npm pack --dry-run lists files (never a pass on an empty list)" "$packed" has 'package.json'
  check "package: npm pack --dry-run lists no handbook file" "$packed" lacks 'handbook'
else
  check "package: npm is not on this machine, the pack listing is skipped" skipped has skipped
fi

t_summary
