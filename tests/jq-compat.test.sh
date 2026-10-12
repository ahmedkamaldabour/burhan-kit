#!/usr/bin/env bash
# The hooks must run on every supported jq (doctor: JQ_MIN), not only on the one a developer has.
# jq accepts more syntax with each release; a filter that newer jq parses fails to compile on an older
# one, and a hook that fails open then writes nothing — silently. This test reads every jq program
# written inline in the hooks (`jq … '<program>'`) and rejects what jq 1.6 / 1.7 cannot parse:
#   - a postfix `?` on a call or a parenthesised expression followed by a path (`f(x)?.n`, `(…)?[0]`):
#     jq ≤ 1.7 has no `Term '?'` production — only `.a?`, `.[e]?` and `Exp '?'` (parser.y, jq-1.7.1);
#   - `if … then … end` without `else` (jq 1.7+);
#   - builtins newer than jq 1.6.
# CI also runs the whole suite on the jq the Ubuntu runner ships (1.7.1); this is the fast, local guard.
. "$(dirname "$0")/lib.sh"

SEP=$'\x1e'
# jq_programs <file> -> every single-quoted program after a `jq` command — whatever options come first,
# across `\` line continuations — and the jq definitions kept in JQ_* / STRIP_AGENTS variables, each
# followed by a SEP line. Limit: the first single-quoted word after `jq` is taken as the program, so an
# option value in single quotes (`--arg a 'x'`) would be read instead — the hooks pass values as "$…". Programs built in double quotes are one-line wrappers around these
# (`jq -r "($1) // empty"`, `jq -c "$STRIP_AGENTS"`).
jq_programs() {
  awk -v Q="'" -v SEP="$SEP" '
    # the opening quote of the program that follows position k (just after a `jq` word): skips
    # double-quoted arguments and $(...) substitutions with their own quotes; stops at | ; & (no program).
    function prog_start(s, k,    n, c, d, dq) {
      n = length(s); d = 0; dq[0] = 0
      for (; k <= n; k++) {
        c = substr(s, k, 1)
        if (c == "\\") { k++; continue }
        if (c == Q && !dq[d]) {
          if (d == 0) return k
          k += index(substr(s, k + 1), Q); continue          # a quoted word inside $(...)
        }
        if (c == "\"") { dq[d] = !dq[d]; continue }
        if (c == "$" && substr(s, k + 1, 1) == "(") { d++; dq[d] = 0; k++; continue }
        if (c == ")" && d > 0 && !dq[d]) { d--; continue }
        if (d == 0 && !dq[0] && (c == "|" || c == ";" || c == "&")) return 0
      }
      return 0
    }
    {
      line = $0
      if (!inprog && line ~ /^[[:space:]]*#/) next     # a shell comment is not a command
      if (!inprog) {                                   # join `\` continuations of the command line
        while (line ~ /\\$/ && (getline nxt) > 0) line = substr(line, 1, length(line) - 1) " " nxt
      }
      while (line != "") {
        if (!inprog) {
          if (match(line, /(^|[[:space:]])(JQ_[[:alnum:]_]*|STRIP_AGENTS)='"'"'/)) {   # a jq definition kept in a variable
            line = substr(line, RSTART + RLENGTH); inprog = 1; prog = ""; continue
          }
          if (!match(line, /(^|[^[:alnum:]_.-])jq[[:space:]]/)) break
          rest = substr(line, RSTART + RLENGTH); k = prog_start(rest, 1)
          if (k == 0) { line = rest; continue }
          line = substr(rest, k + 1); inprog = 1; prog = ""
        } else {
          q = index(line, Q)
          if (q == 0) { prog = prog line "\n"; break }
          prog = prog substr(line, 1, q - 1); line = substr(line, q + 1); inprog = 0
          print prog; print SEP
        }
      }
    }
  ' "$1"
}

# jq_problems -> reads programs (separated by SEP) on stdin; prints one line per problem.
jq_problems() {
  awk -v RS="$SEP" '
    {
      p = $0
      gsub(/"([^"\\]|\\.)*"/, "\"\"", p)          # string literals (they may contain any word)
      n = split(p, ls, "\n"); p = ""
      for (i = 1; i <= n; i++) { sub(/#.*/, "", ls[i]); p = p ls[i] "\n" }   # jq comments
      # jq < 1.8 has `?` only after a field or a subscript (.a? .[e]? ."s"?) or after a whole
      # expression — not after a call, (…), {…}, a string or a $variable when a path follows.
      if (p ~ /[)}][[:space:]]*\?[[:space:]]*[.[]/ || p ~ /(^|[^.])""[[:space:]]*\?[[:space:]]*[.[]/ \
          || p ~ /\$[[:alnum:]_]+[[:space:]]*\?[[:space:]]*[.[]/)
        print "postfix ? on a call, (...), {...}, a string or a variable followed by a path (jq < 1.8): " substr($0, 1, 120)
      if (match(p, /(^|[^[:alnum:]_$])(pick|abs|toarray|trim|ltrim|rtrim|trimstr|have_decnum|have_literal_numbers|significand|skip)([^[:alnum:]_]|$)|@base32d|@urid|\$__loc__|(^|[^[:alnum:]_])(debug|add)[[:space:]]*\(|(^|[^[:alnum:]_])scan[[:space:]]*\([^);]*;/))
        print "builtin newer than jq 1.6: " substr(p, RSTART, RLENGTH)
      if (p ~ /[{,][[:space:]]*(if|then|elif|else|end|and|or|not|as|def|reduce|foreach|try|catch|label|import|include|__loc__)[[:space:]]*:/)
        print "keyword as an object key (jq < 1.7): " substr($0, 1, 120)
      # if/else/end balance: every `if` needs an `else` before its `end` (jq < 1.7)
      w = p; gsub(/[^[:alnum:]_]+/, " ", w); n = split(w, t, " "); d = 0
      for (i = 1; i <= n; i++) {
        if (t[i] == "if") { d++; hasElse[d] = 0 }
        else if (t[i] == "else" && d > 0) hasElse[d] = 1
        else if (t[i] == "end" && d > 0) { if (!hasElse[d]) print "if without else (jq < 1.7): " substr($0, 1, 120); d-- }
      }
    }
  '
}

echo "jq compatibility — the checker itself"
bad="$(t_tmp)/bad.sh"
cat > "$bad" <<'EOF'
x="$(printf '%s' "$p" | jq -c '{a: (.r | capture("^E: (?<n>[0-9]+)")?.n)}')"
y="$(jq -r --arg k "$v" 'if .a then 1 end' f)"
z="$(jq -n '[1,2] | pick(.[0])')"
w="$(jq -n '"if it is" | ascii_downcase')"
v="$(jq -c --slurpfile s "$f" \
  --arg k "$v" '$s[0] | {a: $k}?.a')"
u="$(jq -n '[1] | .[0] as $x | {if: $x} | ltrimstr("a")')"
s="$(jq -n '[1,2] | skip(1; .[])')"
r="$(jq -c --argjson r "$(printf '%s' "$x" | jq '.a')" '$r?.n')"
# when jq isn't installed the hook skips
c="$(jq -n '{a:1}?.a')"
EOF
probs="$(jq_programs "$bad" | jq_problems)"
check "catches capture(…)?.n (the record filter that failed on the jq 1.7.1 runner)" "$probs" has "postfix ?"
check_eq "catches if without else, once" "$(printf '%s\n' "$probs" | grep -c 'if without else')" "1"
check "catches a builtin newer than jq 1.6" "$probs" has "pick"
check "a word inside a string literal is not code" "$probs" lacks "ascii_downcase"
check "a program after --slurpfile and a line continuation is read" "$probs" has "{a: \$k}"
check "ltrimstr (jq 1.5) is not mistaken for ltrim (jq 1.7.1)" "$probs" lacks "ltrim\n"
check_eq "...exactly one builtin problem on the ltrimstr line (skip)" "$(printf '%s\n' "$probs" | grep -c 'newer than jq 1.6')" "2"
check "a keyword as an object key (jq < 1.7)" "$probs" has "keyword as an object key"
check "the program after a \$(…) argument with its own quotes is read" "$probs" has "\$r?.n"
check "a comment with an apostrophe does not swallow the next program" "$probs" has "{a:1}?.a"

echo "jq compatibility — every inline program in the hooks"
total=0; all=""; allprogs=""
while IFS= read -r f; do
  progs="$(jq_programs "$f")"; allprogs="$allprogs$progs"$'\n'
  n="$(printf '%s\n' "$progs" | grep -c "^$SEP\$")"; total=$((total + n))
  # every hook that calls jq with a quoted program yields at least one
  if grep -qE "(^|[^[:alnum:]_.-])jq[[:space:]][^|;&]*'" "$f"; then
    check "${f#"$T_KIT"/} yields its jq programs" "$([ "$n" -ge 1 ] && echo yes)" has yes
  fi
  p="$(printf '%s' "$progs" | jq_problems)"
  [ -n "$p" ] && all="${all}${f#"$T_ROOT"/}: ${p}"$'\n'
done < <(find "$T_KIT/hooks" -name '*.sh' -type f | sort)
check "read the hooks' jq programs ($total) — never a pass on an empty list" "$([ "$total" -ge 50 ] && echo yes)" has yes
# The large programs must be among them (they follow --slurpfile, --arg or a line continuation).
for marker in 'def results:' 'def prompt_like:' '{ts: $ts, agent: $a' 'patch_exit: (if' 'def patch_files:' '($subs | from_entries)' '.turn += $t[0]' '{files_created:$c[0]'; do
  check "the program with '$marker' is read" "$allprogs" has "$marker"
done
check "no jq syntax or builtin newer than jq 1.6" "$all" lacks ":"
[ -n "$all" ] && printf '%s' "$all" | sed 's/^/        /'
t_summary
