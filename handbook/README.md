# The burhan-kit handbook

The owner handbook, one page per language: [English](en/handbook.html) and [Arabic](handbook.html). Each page is printed to a PDF next to it: `handbook/en/burhan-handbook-en.pdf` and `handbook/burhan-handbook.pdf`. The repository README links the two PDFs; GitHub shows a PDF as a page, and it shows an `.html` file only as source. The pages are plain HTML (inline style, no script). Nothing in this folder is in the npm package.

## Print the PDFs

Run this from the repository root, after the last edit of a page. Chrome 157 printed the committed files; another version prints slightly different bytes. Each command uses a fresh Chrome profile and the page's own A4 print style, with no header or footer.

    CHROME=/usr/bin/google-chrome
    P="$(mktemp -d)"
    "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --user-data-dir="$P/en" --print-to-pdf="$PWD/handbook/en/burhan-handbook-en.pdf" "file://$PWD/handbook/en/handbook.html"
    "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --user-data-dir="$P/ar" --print-to-pdf="$PWD/handbook/burhan-handbook.pdf" "file://$PWD/handbook/handbook.html"
    rm -rf "$P"
    pdfinfo handbook/en/burhan-handbook-en.pdf | grep -E 'Pages|File size'
    pdfinfo handbook/burhan-handbook.pdf | grep -E 'Pages|File size'

Open the Arabic PDF once: its text must run from right to left and no table may be cut off at the page edge.

## Keep it true

- `bash tests/handbook.test.sh` fails when a command printed by `burhan --help` is not named in both pages, when a removed feature comes back, when the two pages differ in their sections, when a link is dead, or when a page or a PDF is not tracked in git. It cannot tell whether a PDF is fresh: print again after every change of a page.
- Each page carries one stamp line with a version and a commit. At each release, check the pages against the code again, change the stamp, and print the PDFs again.
- The handbook is tracked in git. If `git status` does not show a new file here, look for a `/handbook/` line in `.git/info/exclude`, which hides files that are not tracked yet.
