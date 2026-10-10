<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All backend network calls live in src/lib/api.ts; UI never calls fetch directly — keeps Demo Mode fallback in one place.
- App state (files, chats, settings, index) lives in src/lib/store.tsx and persists to localStorage — no server database in this frontend.
- RAGScript UI components live in src/components/rag/; the single app screen is src/routes/index.tsx.
