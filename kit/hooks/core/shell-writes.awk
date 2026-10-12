# shell-writes.awk — files a shell command writes via redirection or tee. A heuristic, not a shell
# parser. Input: commands separated by the ASCII RS character (\036); output: one target per line.
#
#   counted   : > f   >> f   >| f   1> f   &> f   &>> f   tee [-a] f1 f2 …   (quoted targets too)
#   ignored   : 2> f   >&2   2>&1   /dev/*   numeric targets ([ 3 > 2 ])   -> =>
#               anything inside quotes, [[ … ]], here-strings, and heredoc BODIES
#               (the heredoc's own `cat > f <<EOF` target is still counted)
#   not seen  : sed -i, generators, mv/cp — documented limits
# Portable awk (mawk/gawk/BSD): no gensub, no regex captures.
BEGIN { RS = "\036"; Q = "\001"; G = "\002" }   # Q = space inside quotes, G = ">" inside quotes

function drop_heredocs(s,    n, line, i, out, delim, strip, h, rest, c, j) {
  n = split(s, line, "\n"); out = ""; delim = ""
  for (i = 1; i <= n; i++) {
    if (delim != "") {
      c = line[i]
      if (strip) sub(/^\t+/, "", c)
      if (c == delim) delim = ""
      continue
    }
    out = out (out == "" ? "" : "\n") line[i]
    h = index(line[i], "<<")
    while (h > 0 && substr(line[i], h + 2, 1) == "<") {          # here-string <<< : not a heredoc
      rest = substr(line[i], h + 3); j = index(rest, "<<"); h = (j > 0) ? h + 2 + j : 0
    }
    if (h > 0) {
      rest = substr(line[i], h + 2); strip = 0
      if (substr(rest, 1, 1) == "-") { strip = 1; rest = substr(rest, 2) }
      sub(/^[ \t]*/, "", rest); gsub(/["']/, "", rest)
      if (match(rest, /^[A-Za-z_][A-Za-z0-9_]*/)) delim = substr(rest, 1, RLENGTH)
    }
  }
  return out
}

function neutralise(s,    out, i, c, q) {   # quotes removed; their spaces / ">" made inert
  out = ""; q = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (q == "") {
      if (c == "\\") {                                           # escaped char: literal, inert
        i++; c = substr(s, i, 1)
        if (c == " " || c == "\t") c = Q; else if (c == ">") c = G
        out = out c; continue
      }
      if (c == "'" || c == "\"") { q = c; continue }
      out = out c
    } else {
      if (c == q) { q = ""; continue }
      if (q == "\"" && c == "\\") { i++; c = substr(s, i, 1) }
      if (c == " " || c == "\t") c = Q; else if (c == ">") c = G
      out = out c
    }
  }
  return out
}

function drop_brackets(s,    a, b) {        # [[ … ]] compares strings with > ; not a redirect
  while ((a = index(s, "[[")) > 0 && (b = index(substr(s, a), "]]")) > 0)
    s = substr(s, 1, a - 1) " " substr(s, a + b + 1)
  return s
}

function restore(t) { gsub(Q, " ", t); gsub(G, ">", t); return t }

function emit(t) {
  t = restore(t)
  if (t == "" || t ~ /^\/dev\// || t ~ /^[0-9]+$/ || t ~ /^&/) return
  print t
}

function token_at(s, j,    k, c) {         # next word starting at j (after blanks)
  while (substr(s, j, 1) == " " || substr(s, j, 1) == "\t") j++
  k = j
  while (k <= length(s)) {
    c = substr(s, k, 1)
    if (c == " " || c == "\t" || c == "\n" || index(";|&<>()", c)) break
    k++
  }
  TOKEN_END = k
  return substr(s, j, k - j)
}

{
  s = drop_brackets(neutralise(drop_heredocs($0)))
  # --- redirections
  for (i = 1; i <= length(s); i++) {
    if (substr(s, i, 1) != ">") continue
    p = substr(s, i - 1, 1)
    if (p == ">" ) continue                                       # second char of >>
    if (p == "-" || p == "=" || p == "<") continue                # -> => <>
    if (p ~ /[0-9]/) {                                            # fd prefix: only 1> is stdout
      k = i - 1; while (k > 1 && substr(s, k - 1, 1) ~ /[0-9]/) k--
      if (substr(s, k, i - k) != "1") continue
      if (k > 1 && substr(s, k - 1, 1) !~ /[ \t;|&(\n]/) continue    # part of a word, e.g. $((3>2))
    }
    j = i + 1
    if (substr(s, j, 1) == ">") j++
    if (substr(s, j, 1) == "|") j++
    if (substr(s, j, 1) == "&") continue                          # >&2 duplication
    emit(token_at(s, j)); i = TOKEN_END - 1
  }
  # --- tee [opts] file…
  n = split(s, w, /[ \t\n]+/)
  for (i = 1; i <= n; i++) {
    if (w[i] != "tee") continue
    for (k = i + 1; k <= n; k++) {
      if (w[k] ~ /[;|&<>()]/) break
      if (w[k] ~ /^-/) continue
      emit(w[k])
    }
  }
}
