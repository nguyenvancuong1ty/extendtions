const fs = require('fs');
const path = require('path');

const location = process.argv[2] || "Unknown Location";
const monster = process.argv[3] || "Unknown Monster";
const totalShots = parseInt(process.argv[4]) || 70;
const outputFile = process.argv[5] || "storyboard.json";

console.log(`Generating AI Director Storyboard...`);
console.log(`Location: ${location} | Monster: ${monster} | Shots: ${totalShots}`);

const exportData = {
  activeProjectId: `AI_DIRECTOR_${location.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`,
  nodes: [],
  connections: []
};

const baseSeed = Math.floor(Math.random() * 999999);
const startX = 100;
const startY = 200;
const xSpacing = 350;

// Hồi 1 (Khám phá), Hồi 2 (Căng thẳng), Hồi 3 (Đụng độ/Rượt đuổi), Hồi 4 (Thoát hiểm)
const pacingLimits = {
  phase1: Math.floor(totalShots * 0.3),
  phase2: Math.floor(totalShots * 0.55),
  phase3: Math.floor(totalShots * 0.85)
};

for (let i = 1; i <= totalShots; i++) {
  let prompt = "";

  if (i === 1) {
    // SHOT 1: Establishing Shot (Jellyfish methodology: Camera -> Env -> Subject -> Action -> Atmosphere -> Style)
    prompt = `Extreme high-angle wide drone shot, pointing straight down. Crushing abyssal depths. The colossal, monolithic ${location} rests on the deep ocean floor, completely encrusted in thick dead coral and giant barnacles. A tiny, insignificant scuba diver with a glowing flashlight. Swimming slowly in the extreme foreground, establishing a terrifying massive scale (megalophobia). Pitch black murky green water, dense marine snow, volumetric god rays fading into the dark abyss. Gritty realism, post-apocalyptic cinematic 8k.`;
  } else {
    // SHOT 2+: Prompt for motion only (ArcReel methodology)
    let cameraMotion = "";
    let actionFocus = "";
    
    if (i <= pacingLimits.phase1) {
      const motions = ["Camera slowly pushes forward.", "Camera pans slowly to the left.", "Camera tilts up slightly.", "Smooth forward tracking shot.", "Camera gently pans right."];
      cameraMotion = motions[i % motions.length];
      actionFocus = `The diver swims deeper into the ancient submerged ${location}.`;
    } else if (i <= pacingLimits.phase2) {
      const motions = ["Frantic camera shake, panning left quickly.", "Camera jerks back violently.", "Camera slowly pushes in.", "Fast tilting down.", "Heavy camera shake, rapid tracking."];
      cameraMotion = motions[i % motions.length];
      actionFocus = `A massive shadow moves in the periphery. The diver freezes, scanning the dark water.`;
    } else if (i <= pacingLimits.phase3) {
      const motions = ["Fast shaky camera pushing forward.", "Rapid camera pan looking over the shoulder.", "Violent camera swing to the left.", "Chaotic camera movement.", "Tilting camera upwards."];
      cameraMotion = motions[i % motions.length];
      actionFocus = `A colossal mutated ${monster} suddenly darts past the lens. Swimming frantically to escape, dodging falling debris.`;
    } else {
      const motions = ["Camera slows down, panning back.", "Slow push forward.", "Camera static.", "Smooth slow pan."];
      cameraMotion = motions[i % motions.length];
      actionFocus = "Heavy breathing, observing the distant ruins safely.";
    }

    const envDynamics = "Dense marine snow swirling, tiny air bubbles rising rapidly.";
    prompt = `${cameraMotion} ${actionFocus} ${envDynamics}`;
  }

  exportData.nodes.push({
    id: `node-${i}`,
    prompt: prompt,
    mode: 'video',
    subMode: 'frames',
    modelKey: 'abra_t2v_8s',
    aspectRatio: 'VIDEO_ASPECT_RATIO_LANDSCAPE',
    duration: '8s',
    variationsCount: 1,
    seed: baseSeed + i,
    startFrameUrl: null,
    x: startX + (i - 1) * xSpacing,
    y: startY
  });

  if (i > 1) {
    exportData.connections.push({ from: `node-${i - 1}`, to: `node-${i}` });
  }
}

fs.writeFileSync(path.resolve(process.cwd(), outputFile), JSON.stringify(exportData, null, 2));
console.log(`[+] Success! Storyboard saved to ${outputFile}`);
