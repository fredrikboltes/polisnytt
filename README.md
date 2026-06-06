<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1jYfRQHM0T0xsspp_QLlEKKYW3QCv6q19

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key.
3. Run the app:
   `npm run dev`

The development server serves the React app and the `/api/generate-article` endpoint from Node so the Gemini API key is never exposed to the browser bundle.

For a production preview, build the app first and then start the Node server:

```sh
npm run build
npm run preview
```
