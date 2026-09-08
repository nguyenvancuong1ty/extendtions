const fs = require('fs');
const path = require('path');

/**
 * AI DIRECTOR SCRIPT - VEO 3 STORYBOARD GENERATOR
 * Áp dụng chuẩn luật: 
 * 1. Shot 1 miêu tả chi tiết (Establishing).
 * 2. Shot 2+ CHỈ miêu tả chuyển động (Prompt for motion only).
 * 3. Hợp lý hóa sinh thái: Quái vật bản địa.
 */

function generateStoryboard(location, monster, totalShots = 70) {
  const exportData = {
    activeProjectId: "AI_DIRECTOR_ARCREEL_METHOD",
    nodes: [],
    connections: []
  };

  const baseSeed = Math.floor(Math.random() * 999999);
  const startX = 100;
  const startY = 200;
  const xSpacing = 350;

  // SHOT 1: Establishing Shot (Chuẩn Jellyfish: Camera -> Environment -> Subject -> Action -> Atmosphere -> Style)
  const shot1Camera = "Extreme high-angle wide drone shot, pointing straight down.";
  const shot1Env = `Crushing abyssal depths. The colossal, monolithic Great Pyramid of Giza rests on the deep ocean floor, completely encrusted in thick dead coral and giant barnacles.`;
  const shot1Subject = "A tiny, insignificant scuba diver with a glowing flashlight.";
  const shot1Action = "Swimming slowly in the extreme foreground, establishing a terrifying massive scale (megalophobia).";
  const shot1Atmosphere = "Pitch black murky green water, dense marine snow, volumetric god rays fading into the dark abyss.";
  const shot1Style = "Gritty realism, post-apocalyptic cinematic 8k.";
  
  const shot1Prompt = `${shot1Camera} ${shot1Env} ${shot1Subject} ${shot1Action} ${shot1Atmosphere} ${shot1Style}`;

  exportData.nodes.push({
    id: `node-1`,
    prompt: shot1Prompt,
    mode: 'video',
    subMode: 'frames',
    modelKey: 'abra_t2v_8s',
    aspectRatio: 'VIDEO_ASPECT_RATIO_LANDSCAPE',
    duration: '8s',
    variationsCount: 1,
    seed: baseSeed + 1,
    startFrameUrl: null,
    x: startX,
    y: startY
  });

  // CHUẨN VEO 3 CỦA ARCREEL: "Prompt for motion only" cho các shot tiếp theo
  for (let i = 2; i <= totalShots; i++) {
    let cameraMotion = "";
    let actionFocus = "";
    
    if (i <= 20) {
      const motions = [
        "Camera slowly pushes forward.",
        "Camera pans slowly to the left.",
        "Camera tilts up slightly.",
        "Smooth forward tracking shot.",
        "Camera gently pans right."
      ];
      cameraMotion = motions[i % motions.length];
      actionFocus = "The diver swims deeper into the ancient ruins.";
    }
    else if (i > 20 && i <= 40) {
      const motions = [
        "Frantic camera shake, panning left quickly.",
        "Camera jerks back violently.",
        "Camera slowly pushes in.",
        "Fast tilting down.",
        "Heavy camera shake, rapid tracking."
      ];
      cameraMotion = motions[i % motions.length];
      actionFocus = `A colossal mutated ${monster} suddenly darts past the lens. The diver takes evasive action.`;
    }
    else if (i > 40 && i <= 65) {
      const motions = [
        "Fast shaky camera pushing forward.",
        "Rapid camera pan looking over the shoulder.",
        "Violent camera swing to the left.",
        "Chaotic camera movement.",
        "Tilting camera upwards."
      ];
      cameraMotion = motions[i % motions.length];
      actionFocus = "Swimming frantically to escape, dodging falling debris.";
    }
    else {
      const motions = [
        "Camera slows down, panning back.",
        "Slow push forward.",
        "Camera static.",
        "Smooth slow pan."
      ];
      cameraMotion = motions[i % motions.length];
      actionFocus = "Heavy breathing, observing the distant ruins safely.";
    }

    // "Environmental dynamics" (ArcReel rule: add environmental dynamics instead of static descriptions)
    const envDynamics = "Dense marine snow swirling, tiny air bubbles rising rapidly.";
    
    exportData.nodes.push({
      id: `node-${i}`,
      prompt: `${cameraMotion} ${actionFocus} ${envDynamics}`, 
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

    exportData.connections.push({
      from: `node-${i - 1}`,
      to: `node-${i}`
    });
  }

  const fileName = `episode_${location.replace(/ /g, '_')}_70shots.json`;
  fs.writeFileSync(path.join(__dirname, fileName), JSON.stringify(exportData, null, 2));
  console.log(`[+] Đã tạo thành công kịch bản: ${fileName} (${totalShots} shots)`);
}

// Chạy Script cho Tập 1
generateStoryboard("Pyramid of Giza", "abyssal Nile Crocodile", 70);
