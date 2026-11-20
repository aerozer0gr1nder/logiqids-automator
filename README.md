# 🧠 LogIQids ThinkSheet Assistant

A helper for LogIQids reasoning ThinkSheets. You stay in control: start, pause, resume, or stop it from the extension popup.

## ✨ What it uses

It sends the visible question to **NVIDIA NIM**, using the **Nemotron 3.5 Super VL** vision model to read text, pictures, patterns, and answer choices. The helper can then select an answer and move through the ThinkSheet.

You must log in yourself. The extension does not enter your password or get around login checks. Please review its answers before submitting.

## 🚀 Get started

1. Download this project.
2. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
3. Turn on **Developer mode** and choose **Load unpacked**.
4. Select the downloaded project folder.
5. Open the extension’s **Settings** and enter your own NVIDIA API key.
6. Sign in to LogIQids and open the ThinkSheets page.
7. Open the extension, press **Start**, then confirm on the page.

## ⚙️ Starting settings

- **Model:** `nvidia/nemotron-3.5-super-vl-120b-a12b`
- **API key:** none included; add your own in Settings
- **NVIDIA NIM address:** `https://integrate.api.nvidia.com/v1/chat/completions`
- **Request time:** 300 seconds
- **Token limit:** 8192
- **Request attempts:** 3 total, including the first try
- **Dark mode:** off
- **Progress counters:** 0

You can change the model and request settings in Settings. Your API key stays in your browser and is not included in this project. When solving is used, the question screenshot and its text are sent to NVIDIA NIM.

## 🛠️ If something goes wrong

- **The extension isn’t visible:** Return to the Extensions page and reload it.
- **Start seems idle:** Open the LogIQids ThinkSheets page and confirm the start prompt.
- **It pauses:** Check the Activity log, confirm your NVIDIA key and model in Settings, then resume when ready.
- **You want to start the counters over:** Use **Reset to defaults** in Settings to clear the saved key, restore every default, and reset all counters to 0.
- **Want a darker screen?** Turn on **Dark mode** in Settings.

## 📁 Included

The project includes the extension popup, Settings page, NVIDIA NIM connection, ThinkSheet page helper, and the LogIQids logo.

💡 Keep an eye on the page while it works, and check answers before submitting them.
