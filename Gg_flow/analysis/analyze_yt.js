const fs = require('fs');
const https = require('https');
const path = require('path');

const API_KEY = 'AIzaSyARg2MaWIhw0rGQE8RSE3K2rsp_-10wat0';
const QUERIES = [
  'flooded earth city ruins POV',
  'underwater post apocalyptic exploration',
  'thalassophobia underwater ruins',
  'subnautica real life POV'
];

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function analyze() {
  let report = '# Báo cáo Phân tích Thị trường YouTube (US)\n\n';
  report += 'Ngách: Khám phá tàn tích dưới nước hậu tận thế (POV)\n';
  report += 'Thời gian quét: ' + new Date().toLocaleString() + '\n\n';

  for (const q of QUERIES) {
    report += `## Từ khóa: "${q}"\n`;
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&regionCode=US&relevanceLanguage=en&maxResults=10&key=${API_KEY}`;
    
    const searchData = await fetchJson(searchUrl);
    if (!searchData.items || searchData.items.length === 0) {
      report += 'Không tìm thấy kết quả.\n\n';
      continue;
    }

    const videoIds = searchData.items.map(item => item.id.videoId).join(',');
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`;
    const statsData = await fetchJson(statsUrl);

    let totalViews = 0;
    let maxView = 0;

    report += '### Top Videos:\n';
    statsData.items.forEach((vid, idx) => {
      const views = parseInt(vid.statistics.viewCount || 0);
      totalViews += views;
      if (views > maxView) maxView = views;
      
      if (idx < 5) {
        report += `- **${vid.snippet.title}** | Views: ${views.toLocaleString()} | [Link](https://www.youtube.com/watch?v=${vid.id})\n`;
      }
    });

    const avgViews = Math.round(totalViews / statsData.items.length);
    report += `\n**=> Trung bình lượt xem top 10:** ${avgViews.toLocaleString()}\n`;
    report += `**=> Video cao nhất:** ${maxView.toLocaleString()} views\n\n`;
    report += '---\n\n';
  }

  const reportPath = path.join(__dirname, 'report.md');
  fs.writeFileSync(reportPath, report);
  console.log('Đã lưu dữ liệu báo cáo vào file:', reportPath);
}

analyze().catch(console.error);
