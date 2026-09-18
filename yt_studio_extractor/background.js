// This observes only a file the user explicitly downloaded on Pixabay.
// It never searches, clicks, or downloads audio by itself.
const BRIDGE = "http://127.0.0.1:7861";

async function hasPendingMarker() {
  const response = await fetch(`${BRIDGE}/pending`);
  if (!response.ok) return false;
  const data = await response.json();
  return Boolean(data.pending);
}

chrome.downloads.onChanged.addListener(async (change) => {
  if (change.state?.current !== "complete") return;
  try {
    const [item] = await chrome.downloads.search({ id: change.id });
    const source = `${item.referrer || ""} ${item.url || ""} ${item.finalUrl || ""}`;
    if (!item?.filename || !/(^|\s)https:\/\/(?:www\.)?(?:pixabay\.com|cdn\.pixabay\.com)\//i.test(source)) return;
    if (!await hasPendingMarker()) return;
    await fetch(`${BRIDGE}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: item.filename, url: item.finalUrl || item.url || "" }),
    });
  } catch (error) {
    console.warn("[Studio SFX Bridge] failed to report a download", error);
  }
});
