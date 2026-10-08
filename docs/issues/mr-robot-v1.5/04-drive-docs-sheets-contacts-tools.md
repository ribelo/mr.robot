# 04: Drive, Docs, Sheets and Contacts tools

**Parent:** mr-robot-v1.5 (../mr-robot-v1.5.md) — stories cn-9mzm, cn-pcf6, cn-0c23

**What to build:** Drive: list/search, download, upload, folders, move, share, export and import Docs/Sheets; Docs and Sheets in-place editing; Contacts search and read. Fixture tests; a live upload, a live Docs edit and a live contact lookup.

**Blocked by:** 02 Google: guided OAuth client setup and Connect Google

**Status:** in-progress

- [ ] All tools pass fixture tests
- [ ] Live: file uploaded to Drive, a Doc edited in place, a Sheet cell written, a contact found

## How it works

- **Drive** (connectors/google/drive.ts):
  - drive_search (plain words become a full-text query; a Drive query is kept as written).
  - drive_download: files as they are, Docs as text and Sheets as CSV, into the Workspace under drive/.
  - drive_export: Docs as text, markdown, docx or pdf; Sheets as csv, xlsx or pdf.
  - drive_upload: multipart; convert turns CSV into a Sheet and text into a Doc.
  - drive_import: replaces an existing Doc or Sheet's content and keeps its id, link and sharing.
  - drive_create_folder, drive_move (out of the old folders), drive_share (as reader, commenter or writer).
- **Docs and Sheets in place** (connectors/google/docs-sheets.ts):
  - docs_read (headings and tables as text), docs_replace (replaceAllText), docs_append.
  - sheets_info, sheets_read, sheets_write (USER_ENTERED, so formulas work), sheets_append (INSERT_ROWS).
- **Contacts** (connectors/google/contacts.ts): contacts_search (warms the People API's search cache first, as Google documents) and contacts_get.

## Verified

- **google-files.test.ts:** every tool against recorded Drive, Docs, Sheets and People responses: queries, multipart and media uploads, export formats, the cache warm-up, and in-place writes. Totals: worker 245 tests.
- **Open, needs the owner's account:** a live upload, a Doc edited in place, a Sheet cell written, a contact found.
