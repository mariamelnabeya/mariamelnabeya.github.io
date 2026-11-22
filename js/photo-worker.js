// Runs the background-removal tool in the background (a Web Worker),
// so the admin page never freezes while a photo is being edited.
import { removeBackground } from "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";

self.onmessage = async (e) => {
  const { id, blob, model } = e.data;
  try {
    const result = await removeBackground(blob, {
      model,
      device: "cpu",   // the graphics-chip version needs a second big download and wasn't clearly faster
      output: { format: "image/png" },
      progress: (key, cur, total) => self.postMessage({ id, progress: { key, cur, total } })
    });
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
