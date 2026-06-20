# Agent Notes

This repository is a standalone local patch kit for the shipped
`openai.chatgpt` VS Code extension bundle.

## Scope

- Keep the publishable repo small: `README.md`, `package.json`, `src/index.js`,
  `.gitignore`, `.gitattributes`, and this file.
- Do not commit local forensic notes, local session examples, backup paths, or
  debug scratch files.
- Run `npm run scan` and `npm run apply:dry` before applying patch changes to an
  installed extension bundle.
- Treat minified-bundle anchors as version-sensitive. If anchors drift, retarget
  them deliberately and verify with a dry run.

## Codex Contribution Attribution

When committing work that should appear on GitHub as authored by Codex, use the
tested repo-local git identity:

```bash
git config user.name "Codex"
git config user.email "codex@openai.com"
```

This is an attribution method for commit authorship. It does not grant GitHub
repository permissions by itself. Push permissions still come from the
authenticated local GitHub account, GitHub CLI session, deploy key, or GitHub App
used for the push.

Before using this identity on meaningful history:

- confirm the target repo should show Codex-authored commits
- keep the setting repo-local, not global
- inspect `git config --local --get user.name` and
  `git config --local --get user.email`
- use normal review discipline before pushing

To return to the user's normal local identity:

```bash
git config --unset user.name
git config --unset user.email
```
