/**
 * Extract session-to-video mappings from the Eichmann Trial YouTube playlist
 * Playlist: https://www.youtube.com/playlist?list=PL8DE7D8BC03983637
 */

const fs = require('fs');
const https = require('https');

const PLAYLIST_ID = 'PL8DE7D8BC03983637';

async function fetchPlaylistPage(pageToken = '') {
  const url = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;
  
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
  });
}

async function extractVideosFromHTML(html) {
  // Extract the initial data JSON from the page
  const match = html.match(/var ytInitialData = ({.+?});/);
  if (!match) {
    console.error('Could not find ytInitialData');
    return [];
  }
  
  try {
    const data = JSON.parse(match[1]);
    const videos = [];
    
    // Navigate through the YouTube data structure
    const contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents || [];
    
    for (const item of contents) {
      const video = item?.playlistVideoRenderer;
      if (video) {
        const videoId = video.videoId;
        const title = video.title?.runs?.[0]?.text || '';
        
        // Extract session numbers from title
        // Format: "משפט אייכמן - ישיבה XX" or "משפט אייכמן - ישיבה XX, ישיבה YY"
        const sessionMatches = title.match(/ישיבה\s+(\d+)/g);
        const sessions = sessionMatches 
          ? sessionMatches.map(m => parseInt(m.match(/\d+/)[0]))
          : [];
        
        if (videoId && sessions.length > 0) {
          videos.push({
            videoId,
            title,
            sessions
          });
        }
      }
    }
    
    return videos;
  } catch (e) {
    console.error('Error parsing YouTube data:', e);
    return [];
  }
}

async function main() {
  console.log('Fetching YouTube playlist...');
  
  const html = await fetchPlaylistPage();
  const videos = await extractVideosFromHTML(html);
  
  console.log(`Found ${videos.length} videos with session info`);
  
  // Create session-to-video mapping
  const sessionMapping = {};
  
  for (const video of videos) {
    for (const session of video.sessions) {
      if (!sessionMapping[session]) {
        sessionMapping[session] = [];
      }
      sessionMapping[session].push({
        videoId: video.videoId,
        title: video.title
      });
    }
  }
  
  // Sort by session number
  const sortedMapping = {};
  Object.keys(sessionMapping)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach(session => {
      sortedMapping[session] = sessionMapping[session];
    });
  
  const output = {
    playlistId: PLAYLIST_ID,
    playlistUrl: `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`,
    extractedAt: new Date().toISOString(),
    totalVideos: videos.length,
    totalSessions: Object.keys(sortedMapping).length,
    sessions: sortedMapping,
    videos: videos
  };
  
  // Save to file
  const outputPath = '../app/public/data/session-videos.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Saved to ${outputPath}`);
  
  // Print summary
  console.log('\nSession coverage:');
  const sessionNums = Object.keys(sortedMapping).map(Number);
  console.log(`Sessions with videos: ${sessionNums.join(', ')}`);
}

main().catch(console.error);
