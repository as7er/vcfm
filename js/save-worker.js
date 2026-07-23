import { compressToUTF16 } from "./compress.js";

self.onmessage = (event) => {
  const { token, json } = event.data || {};
  try {
    self.postMessage({ token, packed: compressToUTF16(json) });
  } catch (error) {
    self.postMessage({ token, error: error?.message || String(error) });
  }
};
