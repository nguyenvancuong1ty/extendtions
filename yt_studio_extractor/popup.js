document.getElementById('copyBtn').addEventListener('click', () => {
    chrome.storage.local.get(['yt_data'], function(result) {
        if (!result.yt_data || result.yt_data.length === 0) {
            document.getElementById('output').value = "Chưa bắt được data nào. Hãy F5 lại trang YouTube Studio Analytics.";
            return;
        }
        const jsonStr = JSON.stringify(result.yt_data, null, 2);
        document.getElementById('output').value = jsonStr;
        navigator.clipboard.writeText(jsonStr).then(() => {
            alert("Đã copy dữ liệu! Dán cho AI nhé.");
        });
    });
});

document.getElementById('clearBtn').addEventListener('click', () => {
    chrome.storage.local.set({yt_data: []}, function() {
        document.getElementById('output').value = "Đã xóa log cũ.";
    });
});

// Load data on open
chrome.storage.local.get(['yt_data'], function(result) {
    if (result.yt_data && result.yt_data.length > 0) {
        document.getElementById('output').value = "Đã có " + result.yt_data.length + " payload. Bấm Lấy Data để copy.";
    }
});
