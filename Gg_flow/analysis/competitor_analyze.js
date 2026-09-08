const fs = require('fs');
const https = require('https');
const path = require('path');

const API_KEY = 'AIzaSyARg2MaWIhw0rGQE8RSE3K2rsp_-10wat0';

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

async function analyzeCompetitors() {
  const queries = ['subnautica in real life ai', 'thalassophobia pov', 'underwater ruins ai'];
  let channelIds = new Set();
  let videoData = [];

  for (const q of queries) {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&regionCode=US&maxResults=8&key=${API_KEY}`;
    const searchData = await fetchJson(searchUrl);
    if(searchData.items) {
      for(const item of searchData.items) {
        channelIds.add(item.snippet.channelId);
        videoData.push({
           query: q,
           title: item.snippet.title,
           channelId: item.snippet.channelId,
           channelTitle: item.snippet.channelTitle,
           videoId: item.id.videoId
        });
      }
    }
  }

  const cIdsArray = Array.from(channelIds).slice(0, 45); // Max 50 per request
  const channelsUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${cIdsArray.join(',')}&key=${API_KEY}`;
  const channelsData = await fetchJson(channelsUrl);
  
  let channelStats = {};
  if(channelsData.items) {
     channelsData.items.forEach(c => {
       channelStats[c.id] = c.statistics.subscriberCount;
     });
  }

  let report = '# PHÂN TÍCH ĐỐI THỦ CẠNH TRANH\n\n';
  
  let smallChannels = 0;
  let mediumChannels = 0;
  let largeChannels = 0;

  videoData.forEach(v => {
     const subs = parseInt(channelStats[v.channelId] || 0);
     if (subs < 50000) smallChannels++;
     else if (subs < 500000) mediumChannels++;
     else largeChannels++;

     report += `- Kênh: **${v.channelTitle}** (${subs.toLocaleString()} Subs) -> Niche: ${v.query}\n`;
     report += `  + Video: ${v.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'")}\n\n`;
  });

  report += `## THỐNG KÊ KÊNH:\n`;
  report += `- Kênh nhỏ (<50k sub): ${smallChannels}\n`;
  report += `- Kênh trung bình (50k-500k sub): ${mediumChannels}\n`;
  report += `- Kênh lớn (>500k sub): ${largeChannels}\n`;

  const outPath = path.join(__dirname, 'competitor_report.md');
  fs.writeFileSync(outPath, report);
  console.log('Done');
}

analyzeCompetitors().catch(console.error);
