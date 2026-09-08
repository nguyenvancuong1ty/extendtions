const fs = require('fs');
const https = require('https');
const path = require('path');

const API_KEY = 'AIzaSyARg2MaWIhw0rGQE8RSE3K2rsp_-10wat0';
const QUERIES = [
  'underwater ruins',
  'thalassophobia',
  'subnautica in real life',
  'flooded earth'
];

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Fetch YouTube autocomplete suggestions (để xem người dùng thực sự gõ gì trên thanh tìm kiếm)
async function getSuggestions(query) {
  return new Promise((resolve, reject) => {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json[1] || []);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', reject);
  });
}

async function runAdvanced() {
  let report = '# BÁO CÁO CHUYÊN SÂU: LƯỢT TÌM KIẾM, TAGS & TỐC ĐỘ TĂNG TRƯỞNG (US)\n\n';
  
  for (const q of QUERIES) {
    report += `## 1. Cụm từ khóa gốc: "${q}"\n`;
    
    // 1. Suggestions (Search Intent)
    const suggestions = await getSuggestions(q);
    report += `### Khán giả thực tế đang gõ tìm kiếm (YouTube Auto-complete):\n`;
    if(suggestions.length > 0) {
       suggestions.slice(0, 10).forEach(s => report += `- ${s}\n`);
    } else {
       report += `- (Ít lượt tìm kiếm tự nhiên)\n`;
    }
    
    // 2. Fetch top 15 videos to analyze Tags & Velocity
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&regionCode=US&relevanceLanguage=en&maxResults=15&key=${API_KEY}`;
    const searchData = await fetchJson(searchUrl);
    
    if (!searchData.items || searchData.items.length === 0) continue;
    
    const videoIds = searchData.items.map(item => item.id.videoId).join(',');
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`;
    const statsData = await fetchJson(statsUrl);

    let tagCount = {};
    let highVelocityVideos = [];
    
    const now = new Date();

    statsData.items.forEach(vid => {
      // Tags
      if (vid.snippet.tags) {
        vid.snippet.tags.forEach(tag => {
          const t = tag.toLowerCase();
          tagCount[t] = (tagCount[t] || 0) + 1;
        });
      }
      
      // Velocity
      const views = parseInt(vid.statistics.viewCount || 0);
      const pubDate = new Date(vid.snippet.publishedAt);
      const daysOld = Math.max(1, (now - pubDate) / (1000 * 60 * 60 * 24));
      const viewsPerDay = Math.round(views / daysOld);
      
      highVelocityVideos.push({
        title: vid.snippet.title,
        viewsPerDay: viewsPerDay,
        totalViews: views,
        daysOld: Math.round(daysOld)
      });
    });

    // Sort tags
    const sortedTags = Object.entries(tagCount).sort((a,b) => b[1] - a[1]).slice(0, 10);
    report += `\n### Top Tags được đối thủ sử dụng nhiều nhất (chuẩn SEO):\n`;
    sortedTags.forEach(t => report += `- #${t[0]} (xuất hiện ${t[1]} lần)\n`);

    // Sort velocity
    highVelocityVideos.sort((a,b) => b.viewsPerDay - a.viewsPerDay);
    report += `\n### Tốc độ tăng trưởng (View/Ngày) của Top Video:\n`;
    report += `*(Chỉ số này cực kỳ quan trọng: Lượt xem/ngày càng cao nghĩa là chủ đề đang rất Viral)*\n`;
    highVelocityVideos.slice(0, 5).forEach(v => {
      report += `- **${v.title.substring(0, 50)}...**\n`;
      report += `  + Tốc độ: **${v.viewsPerDay.toLocaleString()} views/ngày** (Tổng: ${v.totalViews.toLocaleString()}, Tuổi: ${v.daysOld} ngày)\n`;
    });
    
    report += '\n---\n\n';
  }

  const outPath = path.join(__dirname, 'advanced_report.md');
  fs.writeFileSync(outPath, report);
  console.log('Done');
}

runAdvanced().catch(console.error);
