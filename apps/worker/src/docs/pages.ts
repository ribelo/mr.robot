export const PAGES = `# Pages

A Page is a document that a Robot writes for its owner. It is a file under pages/ in the Robot's Workspace, in Markdown (.md) or HTML (.html). The file is the state: the reading view, the PDF and a share link all read the file. The Files view, the file tools, Rewind and Start over work on Pages like on any other file.

## The title

- Markdown: the front matter line title:, else the first heading "# ...", else the file name.
- HTML: the <title> element, else the first <h1>, else the file name.

Rename in the reading view writes the new title into the file, in the same place.

## How a Robot hands a Page over

The Robot writes the file with the file tools. Then it calls say with the path in attachments. The Conversation shows a Page card with the title and the first lines. The card opens the reading view. On Discord, the message links to the reading view. The platform skill pages says when to write a Page and how.

## The reading view

The address is #/r/<robot>/pages/<path>.

- A Markdown Page shows its title, a table of contents from its "##" and "###" headings, and the text with tables, TeX math (KaTeX), Mermaid diagrams and images from the Workspace.
- An HTML Page runs in a frame without the app's origin. It can run its own inline script. It cannot reach the app, its cookies or its API, and it loads nothing from the internet. Links open in a new tab. Source shows the HTML.
- Rename (the owner only) changes the title.
- PDF prints the Page through Browser Rendering and downloads it.

## PDF and its limits

Browser Rendering prints a Page at most once per version of its content: the file and the Workspace images it shows. Every later PDF of the same version, from the app or from a share link, is the kept copy and costs nothing. The rendered HTML of a Page is kept the same way.

- A share link prints at most 5 new PDFs in an hour.
- All Pages of one Member print at most 50 new PDFs in a day, the owner's own included.
- Over a limit, the PDF answers 429 with one sentence. A kept copy is still served.
- The browser time of each print is the Robot's cost, under the source browser. It counts toward the Robot's spend limit. Over that limit, a new PDF answers 503 "PDF unavailable"; the Page itself still opens.

The Robot's panel lists its Pages, newest first. The Files view groups them under Pages, with Open as Page.

## Sharing

Only the owner shares a Page. A Robot has no tool for it. See "Shared Pages" below.

## Shared Pages

The Share switch in the reading view makes a public link: https://<host>/p/<token>. Anyone with the link sees the Page's title, its content and a PDF, without signing in, and nothing else of the app. The token is random. The Home keeps only its hash.

- Stop sharing revokes the link at once. The address then answers "not found".
- The profile lists every shared Page of the owner, with its link and Stop sharing.
- A shared HTML Page is served with a Content-Security-Policy sandbox and no cookies, so it cannot reach the app.
- A shared Markdown Page loads KaTeX styles and Mermaid from a pinned CDN address, and nothing else.
- If the file is deleted or moved, the link answers "not found".
`
