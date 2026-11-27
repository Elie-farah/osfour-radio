# Osfour Radio Station

A Lebanese village café at sunset, with an old radio and a visitors' notebook.

- `public/` is the website (index.html, the café photo, playlist.json, and a `music/` folder for songs).
- `netlify/functions/notes.mjs` saves the notebook articles in Netlify Blobs.

## Put it online with Netlify
1. Put this folder in a GitHub repository.
2. On app.netlify.com choose "Add new site" > "Import an existing project", and pick the repository. Netlify reads `netlify.toml`, so no settings are needed.
3. In Site configuration > Environment variables, add `HOST_KEY` with a secret word only you know.
4. Open `https://YOUR-SITE.netlify.app/?host=YOUR-SECRET-WORD` once on your own computer. After that you can remove any article in the notebook.

## Add songs
Put MP3 files in `public/music/` and list them in `public/playlist.json` under `morning` or `night`
with `"file": "music/song.mp3"` and `"duration"` in seconds.
