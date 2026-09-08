const https = require('https');

const queries = [
  'ai video generator',
  'video storyboard ai',
  'ai video agent consistency'
];

async function searchGithub(query) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`,
      headers: { 'User-Agent': 'NodeJS-Script' }
    };
    https.get(options, res => {
      let d = '';
      res.on('data', c => d+=c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(d).items || []);
        } catch(e) { resolve([]); }
      });
    });
  });
}

async function run() {
  for (const q of queries) {
    console.log(`\n🔍 Searching: ${q}`);
    const items = await searchGithub(q);
    items.forEach(i => {
      console.log(`- ${i.name} (⭐ ${i.stargazers_count})`);
      console.log(`  Desc: ${i.description}`);
      console.log(`  URL: ${i.html_url}`);
    });
  }
}
run();
