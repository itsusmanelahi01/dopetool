# DopeTool — Install Guide

**DopeTool** is DopaMeme's After Effects panel — your whole style library (client colors, styles, effects, assets), a caption importer, auto-captions, the animation toolkit, and the Smoooth easing editor, all in one place.

You only install it **once**. After that, updates happen automatically inside the panel.

---

## Before you start

- **After Effects 2024 or newer** (the panel supports AE 24.0 and up).
- **An internet connection** (the library and updates are synced from the cloud).
- **5 minutes.** That's it.

---

## Step 1 — Download DopeTool from GitHub

1. Open the DopeTool GitHub page:
   **https://github.com/itsusmanelahi01/dopetool**
2. Click the green **`< > Code`** button (top right of the file list).
3. Click **Download ZIP**.

   📸 *[Screenshot: the green "Code" button with "Download ZIP" highlighted]*

4. Find the downloaded file (usually in your **Downloads** folder): `dopetool-main.zip`
5. **Unzip it** (double-click on Mac; right-click → Extract All on Windows).
   You'll get a folder called **`dopetool-main`** — open it. Inside you'll see files like `install_mac.sh`, `install_windows.bat`, `index.html`, etc.

   📸 *[Screenshot: the unzipped folder contents]*

> 💡 Keep this folder somewhere easy to find (like your Desktop) until the install is done. You can delete it afterwards.

---

## Step 2 — Quit After Effects

If After Effects is open, **quit it completely** now. It needs to be closed while you install, then reopened.

---

## Step 3 — Run the installer

### 🍎 On Mac

1. Open **Terminal** (press **Cmd + Space**, type "Terminal", press Enter).
2. In Terminal, type `bash ` (the word bash, then a space) — **don't press Enter yet**.
3. **Drag the `install_mac.sh` file** from the unzipped folder into the Terminal window and drop it. The file path appears automatically.

   📸 *[Screenshot: Terminal showing `bash /Users/you/Desktop/dopetool-main/install_mac.sh`]*

4. Now press **Enter**.
5. If it asks for your **Mac password**, type it and press Enter.
   *(Nothing appears as you type — that's normal, just type it and hit Enter.)*
6. When you see **"Installation complete! 🎉"**, you're done.

### 🪟 On Windows

1. Open the unzipped folder.
2. **Right-click** `install_windows.bat` → **Run as administrator**.
   *(If Windows shows a "Windows protected your PC" warning, click **More info → Run anyway**.)*

   📸 *[Screenshot: right-click menu with "Run as administrator"]*

3. A black window opens and installs automatically.
4. When it says **"Installation complete!"**, press any key to close it.

> **What the installer does:** it turns on Adobe's setting for team panels and copies DopeTool into After Effects' extensions folder. Nothing else on your computer is touched.

---

## Step 4 — Open DopeTool in After Effects

1. Open **After Effects**.
2. Go to the top menu: **Window → Extensions → DopeTool**.

   📸 *[Screenshot: Window → Extensions → DopeTool menu]*

3. The panel opens. **Dock it wherever you like** — most editors dock it as a tall strip on the left or right.

   📸 *[Screenshot: DopeTool panel docked on the side]*

You're in! 🎉

---

## Step 5 — First-time setup (only if you'll use Auto Captions)

The **Style Library, Toolkit, Captions, and Smoooth all work right away** — no setup needed.

**Auto Captions** (transcribe audio → styled captions) needs a one-time setup:

1. In DopeTool, open the **Auto Cap** tab.
2. Click **⚙ Setup — API key & ffmpeg**.
3. Paste your **free Groq API key** (get one at **console.groq.com/keys**) and click Save.
4. Click **Install ffmpeg for DopeTool** (one click — it downloads a private copy just for DopeTool, no admin rights needed).

   📸 *[Screenshot: the Auto Captions Setup popup]*

That's a one-time thing per computer.

---

## Updating (automatic — you don't download anything again)

When a new version is out, a **blue update banner** appears at the top of the panel.

1. Click **Update** — it downloads the new version in place.
2. Click **⟳ Reload** (or the Reload button that appears) to apply it.

   📸 *[Screenshot: the update banner]*

You never have to download from GitHub again — Step 1–3 is a one-time thing.

---

## Quick tour of the panel

- **Left rail** — switch between tools: **Library, Toolkit, Text Anim, Captions, Auto Cap, Smoooth**. Drag the icons to reorder them however you like.
- **Top quick bar** (always visible) — one-click **Fade / Slide / Scale / Add Null / Trim / Align / Distribute** for your selected layers, colour-coded by type. The **⚙** gear sets duration and easing.
- **Library** — click a client to open it; Colors, Styles, FX and Assets all show at once. Click a color to apply fill (**Shift+click** for stroke).
- **Toolkit** — hover a tool to expand it; drag tool headers to reorder.

---

## Troubleshooting

**DopeTool isn't in Window → Extensions**
- Make sure you **fully quit and reopened** After Effects after installing.
- Mac: re-run `install_mac.sh` (Step 3).
- Windows: re-run `install_windows.bat` **as administrator**.
- Make sure you're on **After Effects 2024 or newer**.

**The panel is blank or stuck**
- Close it from **Window → Extensions → DopeTool** and reopen it.
- If a change was just pushed, click the **⟳ Reload** button.

**"Couldn't reach the library" / no clients showing**
- Check your internet connection, then click **retry**.
- If it keeps failing, send the small grey error text under the message to your lead.

**"No layer selected"**
- Click your layer in the AE timeline first, then click the DopeTool button.

**Auto Captions won't transcribe**
- Open **⚙ Setup** and confirm your Groq key is saved and ffmpeg is installed.

---

## Need help?

For install issues, new style requests, or client setup — contact your lead at **DopaMeme**.
