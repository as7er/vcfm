/**
 * Phase-one portrait study for the avatar redesign.
 *
 * This renderer is intentionally isolated from avatar.js. It is a visual
 * sample only; production avatars keep their existing API and save contract
 * until the style is approved.
 */

const OUTLINE = "#202735";
const EYE = "#20232c";
const EYE_WHITE = "#f8f5ed";
const MOUTH = "#8d514c";
const SHIRT_DARK = "#1f2735";

const SKINS = [
  { base: "#f0c8a5", shadow: "#c9876e", featureLine: "#9a6054", lipTone: "#995e5b", highlight: "#f7ddc2" },
  { base: "#dba27c", shadow: "#a96250", featureLine: "#75443d", lipTone: "#884f4e", highlight: "#edbd99" },
  { base: "#bd7959", shadow: "#82453c", featureLine: "#5e3735", lipTone: "#764443", highlight: "#d99570" },
  { base: "#92583f", shadow: "#60352f", featureLine: "#432b2d", lipTone: "#613d3f", highlight: "#b87355" },
  { base: "#70402f", shadow: "#452a29", featureLine: "#34252a", lipTone: "#503337", highlight: "#8f5840" },
  { base: "#4d2f2c", shadow: "#2f2327", featureLine: "#28232a", lipTone: "#3f2b32", highlight: "#684138" },
];

const HAIR = [
  { base: "#231f25", hi: "#55414a" },
  { base: "#3a2924", hi: "#735043" },
  { base: "#6b442d", hi: "#a77950" },
  { base: "#a46d3e", hi: "#d6a46a" },
  { base: "#b94832", hi: "#de8061" },
  { base: "#b4a07a", hi: "#d7c7a4" },
];

const FACE_SHAPES = ["oval", "soft-square", "long", "round", "broad"];
const HAIR_STYLES = ["crop", "wave", "curl", "side", "buzz", "coils"];
const BEARDS = ["none", "none", "stubble", "short", "full"];

function hashStr(value) {
  let h = 2166136261;
  const text = String(value || "portrait");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function num(hash, salt, max) {
  return ((hash ^ Math.imul(salt + 11, 2246822519)) >>> 0) % max;
}

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function colour(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function portraitTraits(person = {}) {
  const seed = person.appearanceSeed || person.id || person.name || "portrait";
  const h = hashStr(seed);
  const age = Number(person.age) || 25;
  const skin = SKINS[num(h, 1, SKINS.length)];
  const rawHair = HAIR[num(h, 2, HAIR.length)];
  const hair = age >= 38 ? { base: "#706666", hi: "#9b8c86" } : rawHair;
  return {
    h,
    age,
    skin,
    hair,
    face: FACE_SHAPES[num(h, 3, FACE_SHAPES.length)],
    hairStyle: HAIR_STYLES[num(h, 4, HAIR_STYLES.length)],
    beard: age < 21 ? "none" : BEARDS[num(h, 5, BEARDS.length)],
    brow: num(h, 6, 3),
    eyes: num(h, 7, 3),
    nose: num(h, 8, 3),
    mouth: num(h, 9, 3),
    smile: num(h, 10, 4),
    eyeStyle: num(h, 11, 4),
    jaw: num(h, 12, 3),
    collar: num(h, 13, 2),
  };
}

function facePath(shape) {
  switch (shape) {
    case "soft-square":
      return "M85 68 Q128 47 171 68 L173 128 Q168 160 128 179 Q88 160 83 128 Z";
    case "long":
      return "M91 65 Q128 47 165 65 L167 133 Q161 166 128 183 Q95 166 89 133 Z";
    case "round":
      return "M86 72 Q128 47 170 72 Q178 106 170 137 Q160 169 128 179 Q96 169 86 137 Q78 106 86 72 Z";
    case "broad":
      return "M82 70 Q128 48 174 70 L173 130 Q166 163 128 179 Q90 163 83 130 Z";
    default:
      return "M88 67 Q128 47 168 67 L170 131 Q163 164 128 181 Q93 164 86 131 Z";
  }
}

function hairMarkup(style, base, hi) {
  const common = `fill="${base}" stroke="${OUTLINE}" stroke-width="3.75" stroke-linejoin="round"`;
  switch (style) {
    case "wave":
      return `<path d="M75 79 Q69 47 94 35 Q126 12 162 34 Q190 47 181 82 Q169 66 157 62 Q140 78 125 57 Q110 77 96 61 Q87 75 75 79 Z" ${common}/><path d="M91 47 Q111 29 131 42 M145 35 Q163 35 174 51" fill="none" stroke="${hi}" stroke-width="6" stroke-linecap="round"/>`;
    case "curl":
      return `<path d="M72 84 Q65 48 88 34 Q101 13 122 29 Q143 8 159 31 Q188 28 187 63 Q194 76 178 91 Q165 71 151 72 Q139 83 127 69 Q111 83 99 69 Q85 82 72 84 Z" ${common}/><path d="M83 50 Q91 36 101 44 M110 39 Q120 27 129 39 M140 31 Q153 22 160 39 M163 48 Q177 39 181 53" fill="none" stroke="${hi}" stroke-width="5" stroke-linecap="round"/>`;
    case "side":
      return `<path d="M72 83 Q67 43 99 31 Q137 16 178 40 Q188 51 181 83 Q165 65 143 59 Q115 53 83 75 Z" ${common}/><path d="M93 43 Q124 29 157 44" fill="none" stroke="${hi}" stroke-width="6" stroke-linecap="round"/>`;
    case "buzz":
      return `<path d="M80 73 Q78 39 103 30 Q128 19 153 30 Q179 38 176 73 Q159 56 128 56 Q98 56 80 73 Z" ${common}/><path d="M101 39 Q128 29 154 39" fill="none" stroke="${hi}" stroke-width="4" stroke-linecap="round"/>`;
    case "coils":
      return `<path d="M67 88 Q57 53 79 34 Q86 15 103 27 Q116 8 131 27 Q148 8 160 29 Q181 17 188 45 Q201 62 181 91 Q164 73 151 74 Q137 87 126 71 Q111 86 99 72 Q82 87 67 88 Z" ${common}/><path d="M79 47 Q84 33 94 40 M104 39 Q111 25 120 39 M133 37 Q143 23 151 39 M162 39 Q174 32 180 48" fill="none" stroke="${hi}" stroke-width="5" stroke-linecap="round"/>`;
    default:
      return `<path d="M78 80 Q73 50 94 36 Q106 26 122 30 L132 22 L139 30 Q159 25 176 42 Q185 55 179 81 Q166 70 153 66 Q140 78 128 65 Q114 79 101 65 Q89 76 78 80 Z" ${common}/><path d="M96 42 Q110 31 126 37 M135 34 Q151 28 165 42 M88 58 Q96 47 106 48 M113 55 Q125 45 135 53 M145 51 Q158 42 172 54" fill="none" stroke="${hi}" stroke-width="4" stroke-linecap="round" opacity=".9"/>`;
  }
}

function eyesMarkup(traits) {
  const y = traits.eyes === 1 ? 101 : traits.eyes === 2 ? 104 : 103;
  const lid = traits.eyes === 1 ? 3 : traits.eyes === 2 ? 0 : -2;
  const pupilX = traits.eyes === 2 ? 2 : traits.eyes === 1 ? -1 : 0;
  return `<path d="M93 ${y} Q107 ${y - 12 + lid} 122 ${y} Q108 ${y + 10} 93 ${y} Z" fill="${EYE_WHITE}" stroke="${OUTLINE}" stroke-width="2.7" stroke-linejoin="round"/><path d="M134 ${y} Q149 ${y - 12 + lid} 164 ${y} Q150 ${y + 10} 134 ${y} Z" fill="${EYE_WHITE}" stroke="${OUTLINE}" stroke-width="2.7" stroke-linejoin="round"/><ellipse cx="${108 + pupilX}" cy="${y}" rx="7" ry="8" fill="#7f8794" stroke="${EYE}" stroke-width="2"/><ellipse cx="${150 + pupilX}" cy="${y}" rx="7" ry="8" fill="#7f8794" stroke="${EYE}" stroke-width="2"/><ellipse cx="${108 + pupilX}" cy="${y + 1}" rx="3.4" ry="5" fill="${EYE}"/><ellipse cx="${150 + pupilX}" cy="${y + 1}" rx="3.4" ry="5" fill="${EYE}"/><circle cx="${105 + pupilX}" cy="${y - 3}" r="2.2" fill="${EYE_WHITE}"/><circle cx="${147 + pupilX}" cy="${y - 3}" r="2.2" fill="${EYE_WHITE}"/>`;
}

function featuresMarkup(traits) {
  const browTilt = traits.brow === 0 ? 0 : traits.brow === 1 ? -3 : 3;
  const nose = traits.nose === 0 ? "M128 108 Q121 125 126 130 Q132 133 137 129" : traits.nose === 1 ? "M128 108 Q128 124 135 129" : "M128 108 Q134 123 128 132 Q124 134 121 131";
  const mouth = traits.smile === 2
    ? `<path d="M112 145 Q128 155 144 145 Q141 161 128 162 Q115 160 112 145 Z" fill="${MOUTH}" stroke="${OUTLINE}" stroke-width="2.75" stroke-linejoin="round"/><path d="M117 149 Q128 152 139 149 Q136 154 128 154 Q120 154 117 149 Z" fill="${EYE_WHITE}"/>`
    : traits.smile === 1
      ? "M114 146 Q128 155 142 146"
      : traits.mouth === 1
        ? "M115 148 Q128 145 141 148"
        : "M115 146 Q128 151 141 146";
  const cheek = `<path d="M91 130 Q97 134 103 131 M153 131 Q159 134 165 130" fill="none" stroke="${traits.skin.shadow}" stroke-width="2.5" stroke-linecap="round" opacity=".45"/>`;
  return `<path d="M96 92 Q108 ${84 + browTilt} 120 91" fill="none" stroke="${OUTLINE}" stroke-width="3.6" stroke-linecap="round"/><path d="M136 91 Q148 ${84 - browTilt} 160 92" fill="none" stroke="${OUTLINE}" stroke-width="3.6" stroke-linecap="round"/>${eyesMarkup(traits)}<path d="${nose}" fill="none" stroke="${traits.skin.shadow}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${cheek}<path d="${mouth}" fill="none" stroke="${MOUTH}" stroke-width="3.25" stroke-linecap="round"/>`;
}

function beardMarkup(kind, skin, hair) {
  if (kind === "none") return "";
  if (kind === "stubble") {
    return `<path d="M96 142 Q128 164 160 142 Q155 169 128 174 Q101 169 96 142 Z" fill="${hair}" opacity=".38"/>`;
  }
  if (kind === "short") {
    return `<path d="M94 139 Q128 158 162 139 Q157 169 128 174 Q99 169 94 139 Z" fill="${hair}" stroke="${OUTLINE}" stroke-width="3" opacity=".9"/><path d="M108 157 Q128 164 148 157" fill="none" stroke="${skin.shadow}" stroke-width="3" stroke-linecap="round"/>`;
  }
  return `<path d="M91 136 Q128 154 165 136 Q161 171 128 181 Q95 171 91 136 Z" fill="${hair}" stroke="${OUTLINE}" stroke-width="4"/><path d="M108 157 Q128 164 148 157" fill="none" stroke="${skin.shadow}" stroke-width="3" stroke-linecap="round"/>`;
}

function shirtMarkup(primary, secondary, pos, skinBase) {
  const collar = secondary === primary ? SHIRT_DARK : secondary;
  const sleeve = `<path d="M25 256 L36 194 Q55 175 92 169 L108 181 L148 181 L164 169 Q201 175 220 194 L231 256 Z" fill="${primary}" stroke="${OUTLINE}" stroke-width="5" stroke-linejoin="round"/>`;
  const panel = `<path d="M85 175 L103 184 L153 184 L171 175 L184 256 L72 256 Z" fill="${secondary}" opacity=".9"/>`;
  const neck = `<path d="M111 153 L145 153 L149 190 Q128 202 107 190 Z" fill="${skinBase}" stroke="${OUTLINE}" stroke-width="4"/><path d="M112 169 Q128 181 144 169" fill="none" stroke="#7e4b43" stroke-width="3" opacity=".45"/>`;
  const collarMarkup = `<path d="M104 174 L128 190 L152 174" fill="none" stroke="${collar}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
  const seams = `<path d="M41 204 Q61 190 84 188 M215 204 Q195 190 172 188 M72 237 Q128 224 184 237" fill="none" stroke="${SHIRT_DARK}" stroke-width="3" opacity=".32" stroke-linecap="round"/><path d="M61 256 L72 219 M195 256 L184 219" fill="none" stroke="${SHIRT_DARK}" stroke-width="3" opacity=".2"/>`;
  const keeper = pos === "GK" ? `<path d="M61 214 Q128 198 195 214 L197 256 L59 256 Z" fill="${secondary}" opacity=".38"/>` : "";
  return `${sleeve}${panel}${neck}${collarMarkup}${seams}${keeper}`;
}

// Second-pass study: restrained adult proportions and a quieter facial hierarchy.
// It shares the same seed and SVG composition contract with the first renderer.
function refinedFaceSpec(traits) {
  const shape = traits.face === "broad" && traits.jaw === 2 ? "strong-jaw" : traits.face;
  const specs = {
    long: {
      path: "M94 63 Q128 45 162 63 L164 128 Q159 161 128 182 Q97 161 92 128 Z",
      earX: 88,
      eyeGap: 36,
      eyeY: 105,
      noseY: 111,
      mouthY: 148,
    },
    oval: {
      path: "M87 65 Q128 45 169 65 Q176 101 169 133 Q159 166 128 180 Q97 166 87 133 Q80 101 87 65 Z",
      earX: 80,
      eyeGap: 40,
      eyeY: 103,
      noseY: 109,
      mouthY: 147,
    },
    "soft-square": {
      path: "M83 67 Q128 46 173 67 L174 128 Q169 160 128 181 Q87 160 82 128 Z",
      earX: 76,
      eyeGap: 43,
      eyeY: 102,
      noseY: 109,
      mouthY: 148,
    },
    broad: {
      path: "M79 70 Q128 46 177 70 L176 129 Q168 162 128 179 Q88 162 80 129 Z",
      earX: 72,
      eyeGap: 46,
      eyeY: 103,
      noseY: 110,
      mouthY: 148,
    },
    round: {
      path: "M84 74 Q128 47 172 74 Q179 107 170 138 Q159 169 128 180 Q97 169 86 138 Q77 107 84 74 Z",
      earX: 77,
      eyeGap: 42,
      eyeY: 101,
      noseY: 108,
      mouthY: 146,
    },
    "strong-jaw": {
      path: "M80 67 Q128 46 176 67 L174 128 Q166 164 128 184 Q90 164 82 128 Z",
      earX: 73,
      eyeGap: 45,
      eyeY: 104,
      noseY: 111,
      mouthY: 151,
    },
  };
  return specs[shape] || specs.oval;
}

function refinedHairMarkup(style, base, hi, small) {
  const outer = `fill="${base}" stroke="${OUTLINE}" stroke-width="3.25" stroke-linejoin="round"`;
  const detail = small ? "" : hi;
  switch (style) {
    case "side":
      return `<path d="M82 79 Q79 45 103 31 Q133 15 167 34 Q183 45 179 76 Q162 62 143 58 Q117 53 88 72 Z" ${outer}/>${detail ? `<path d="M98 43 Q127 27 158 41 Q142 38 119 50 Z" fill="${detail}" opacity=".62"/>` : ""}`;
    case "curl":
      return `<path d="M75 84 Q68 56 82 39 Q91 22 108 28 Q123 11 139 28 Q158 12 169 32 Q190 28 185 57 Q195 70 177 87 Q161 72 148 74 Q136 84 126 71 Q112 85 99 73 Q85 86 75 84 Z" ${outer}/>${detail ? `<path d="M86 45 Q96 30 106 38 Q119 22 129 38 Q144 23 154 39 Q168 28 177 44" fill="none" stroke="${detail}" stroke-width="3.5" stroke-linecap="round" opacity=".72"/>` : ""}`;
    case "coils":
      return `<path d="M72 87 Q62 57 78 37 Q88 19 104 29 Q119 10 133 28 Q150 10 163 31 Q184 18 190 46 Q198 68 179 90 Q164 74 151 76 Q138 87 126 73 Q112 87 99 75 Q84 89 72 87 Z" ${outer}/>${detail ? `<path d="M83 47 Q91 30 101 41 M107 40 Q117 23 127 40 M135 39 Q146 23 156 40 M163 43 Q175 31 181 48" fill="none" stroke="${detail}" stroke-width="3.5" stroke-linecap="round" opacity=".7"/>` : ""}`;
    case "buzz":
      return `<path d="M84 73 Q82 44 103 33 Q128 23 153 33 Q175 43 173 73 Q157 61 128 59 Q100 61 84 73 Z" ${outer}/>${detail ? `<path d="M103 40 Q128 31 152 40" fill="none" stroke="${detail}" stroke-width="3" stroke-linecap="round" opacity=".65"/>` : ""}`;
    case "wave":
      return `<path d="M76 81 Q72 48 96 34 Q125 14 159 32 Q185 43 181 79 Q165 65 151 62 Q137 77 124 60 Q109 77 96 63 Q85 76 76 81 Z" ${outer}/>${detail ? `<path d="M94 46 Q111 29 130 40 M142 34 Q160 31 173 47" fill="none" stroke="${detail}" stroke-width="3.5" stroke-linecap="round" opacity=".72"/>` : ""}`;
    default:
      return `<path d="M85 79 Q81 48 101 34 Q125 22 150 31 Q174 40 173 75 Q158 65 145 61 Q136 74 126 63 Q113 76 101 64 Q91 75 85 79 Z" ${outer}/>${detail ? `<path d="M99 43 Q112 32 127 38 M135 35 Q151 30 164 42" fill="none" stroke="${detail}" stroke-width="3.25" stroke-linecap="round" opacity=".7"/>` : ""}`;
  }
}

function refinedEyesMarkup(traits, spec, small) {
  const style = traits.eyeStyle;
  const gap = spec.eyeGap + (traits.jaw === 0 ? -1 : traits.jaw === 2 ? 1 : 0);
  const left = 128 - gap / 2;
  const right = 128 + gap / 2;
  const y = spec.eyeY + (style === 2 ? 1 : 0);
  const widths = [17, 19, 18, 16];
  const heights = [7, 9, 8, 6];
  const w = widths[style];
  const h = heights[style];
  const irisR = style === 0 || style === 3 ? 3.6 : 4.1;
  const pathFor = (cx, down = false) => {
    const top = y - h;
    const bottom = y + (down ? 4 : h * 0.7);
    return `M${cx - w / 2} ${y} Q${cx} ${top} ${cx + w / 2} ${y} Q${cx + 3} ${bottom} ${cx} ${bottom - 1} Q${cx - 4} ${bottom} ${cx - w / 2} ${y} Z`;
  };
  const upperOnly = (cx, down = false) => `M${cx - w / 2} ${y} Q${cx} ${y - h} ${cx + w / 2} ${y}` + (down ? ` Q${cx + 2} ${y + 3} ${cx + w / 2 - 2} ${y + 4}` : "");
  const eyeFill = style === 3 ? `<path d="${pathFor(left)} M${right - w / 2} ${y} Q${right} ${y - h} ${right + w / 2} ${y} Q${right + 3} ${y + 3} ${right} ${y + 3} Q${right - 4} ${y + 3} ${right - w / 2} ${y}" fill="${traits.skin.shadow}" opacity=".12"/>` : "";
  const iris = (cx) => `<ellipse cx="${cx}" cy="${y}" rx="${irisR}" ry="${irisR + .5}" fill="#626a77" stroke="${EYE}" stroke-width="1.35"/><ellipse cx="${cx}" cy="${y + .4}" rx="${Math.max(2.1, irisR * .62)}" ry="${Math.max(2.5, irisR * .72)}" fill="${EYE}"/>${small ? "" : `<circle cx="${cx - 1.1}" cy="${y - 1.6}" r="1.1" fill="${EYE_WHITE}"/>`}`;
  const upper = style === 2
    ? `<path d="${upperOnly(left, true)}" fill="none" stroke="${OUTLINE}" stroke-width="2.2" stroke-linecap="round"/><path d="${upperOnly(right, false)}" fill="none" stroke="${OUTLINE}" stroke-width="2.2" stroke-linecap="round"/>`
    : `<path d="${pathFor(left)}" fill="${EYE_WHITE}" stroke="${OUTLINE}" stroke-width="2.15" stroke-linejoin="round"/><path d="${pathFor(right)}" fill="${EYE_WHITE}" stroke="${OUTLINE}" stroke-width="2.15" stroke-linejoin="round"/>`;
  const lower = style === 0 || style === 3
    ? `<path d="M${left - 5} ${y + 3} Q${left} ${y + 5} ${left + 5} ${y + 3} M${right - 5} ${y + 3} Q${right} ${y + 5} ${right + 5} ${y + 3}" fill="none" stroke="${traits.skin.featureLine}" stroke-width="1.35" stroke-linecap="round" opacity=".8"/>`
    : "";
  return `${eyeFill}${upper}${lower}${iris(left)}${iris(right)}`;
}

function refinedFeaturesMarkup(traits, spec, small) {
  const browLift = traits.brow === 0 ? 0 : traits.brow === 1 ? -2 : 2;
  const gap = spec.eyeGap + (traits.jaw === 0 ? -1 : traits.jaw === 2 ? 1 : 0);
  const left = 128 - gap / 2;
  const right = 128 + gap / 2;
  const browY = spec.eyeY - 18 + browLift;
  const browWidth = traits.brow === 2 ? 13 : 15;
  const brows = `<path d="M${left - browWidth / 2} ${browY + 1} Q${left} ${browY - 3} ${left + browWidth / 2} ${browY}" fill="none" stroke="${traits.skin.featureLine}" stroke-width="3" stroke-linecap="round"/><path d="M${right - browWidth / 2} ${browY} Q${right} ${browY - 3} ${right + browWidth / 2} ${browY + 1}" fill="none" stroke="${traits.skin.featureLine}" stroke-width="3" stroke-linecap="round"/>`;
  const nose = traits.nose === 0
    ? `M128 ${spec.noseY} Q124 ${spec.noseY + 13} 127 ${spec.noseY + 17} M127 ${spec.noseY + 17} Q132 ${spec.noseY + 19} 135 ${spec.noseY + 16}`
    : traits.nose === 1
      ? `M128 ${spec.noseY} Q128 ${spec.noseY + 13} 134 ${spec.noseY + 17}`
      : `M128 ${spec.noseY} Q133 ${spec.noseY + 12} 128 ${spec.noseY + 18} M128 ${spec.noseY + 18} Q124 ${spec.noseY + 19} 122 ${spec.noseY + 17}`;
  const mouthY = spec.mouthY + (traits.mouth === 1 ? 1 : 0);
  const mouth = traits.smile === 1
    ? `M119 ${mouthY} Q128 ${mouthY + 3} 137 ${mouthY}`
    : traits.mouth === 1
      ? `M119 ${mouthY + 2} Q128 ${mouthY} 137 ${mouthY + 2}`
      : `M120 ${mouthY + 1} Q128 ${mouthY + 2} 136 ${mouthY + 1}`;
  const noseLine = `<path d="${nose}" fill="none" stroke="${traits.skin.featureLine}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const mouthLine = `<path d="${mouth}" fill="none" stroke="${traits.skin.lipTone}" stroke-width="2.25" stroke-linecap="round"/>`;
  return `${brows}${refinedEyesMarkup(traits, spec, small)}${noseLine}${mouthLine}`;
}

function refinedBeardMarkup(kind, skin, hair) {
  if (kind === "none") return "";
  if (kind === "stubble") return `<path d="M101 145 Q128 161 155 145 Q151 166 128 172 Q105 166 101 145 Z" fill="${hair}" opacity=".2"/>`;
  if (kind === "short") return `<path d="M98 143 Q128 159 158 143 Q153 169 128 175 Q103 169 98 143 Z" fill="${hair}" opacity=".68"/><path d="M112 158 Q128 162 144 158" fill="none" stroke="${skin.shadow}" stroke-width="1.8" stroke-linecap="round"/>`;
  return `<path d="M96 141 Q128 158 160 141 Q155 171 128 178 Q101 171 96 141 Z" fill="${hair}" opacity=".78"/><path d="M111 158 Q128 163 145 158" fill="none" stroke="${skin.shadow}" stroke-width="1.8" stroke-linecap="round"/>`;
}

function refinedShirtMarkup(primary, secondary, pos, skinBase, collarStyle) {
  const body = `<path d="M38 256 L45 204 Q57 183 89 175 L106 184 L150 184 L167 175 Q199 183 211 204 L218 256 Z" fill="${primary}" stroke="${OUTLINE}" stroke-width="3.4" stroke-linejoin="round"/>`;
  const panel = collarStyle === 0
    ? `<path d="M103 181 L128 192 L153 181 L158 256 L98 256 Z" fill="${secondary}" opacity=".62"/>`
    : `<path d="M39 256 L45 204 Q57 183 91 176 L108 185 L128 192 L128 256 Z" fill="${secondary}" opacity=".58"/>`;
  const neck = `<path d="M104 153 L152 153 L155 188 Q128 201 101 188 Z" fill="${skinBase}" stroke="${OUTLINE}" stroke-width="2.8"/>`;
  const collar = collarStyle === 0
    ? `<path d="M106 176 Q128 193 150 176" fill="none" stroke="${secondary}" stroke-width="5" stroke-linecap="round"/>`
    : `<path d="M105 176 L128 193 L151 176" fill="none" stroke="${secondary}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const seams = `<path d="M48 204 Q66 190 87 188 M208 204 Q190 190 169 188" fill="none" stroke="${SHIRT_DARK}" stroke-width="2" opacity=".32" stroke-linecap="round"/><path d="M61 256 Q67 222 83 199 M195 256 Q189 222 173 199" fill="none" stroke="${SHIRT_DARK}" stroke-width="2" opacity=".2" stroke-linecap="round"/>`;
  const keeper = pos === "GK" ? `<path d="M60 220 Q128 207 196 220 L198 256 L58 256 Z" fill="${secondary}" opacity=".25"/>` : "";
  return `${body}${panel}${neck}${collar}${seams}${keeper}`;
}

function refinedAvatarSvg(person, opts, traits) {
  const size = Number(opts.size) || 192;
  const small = size <= 48;
  const primary = colour(opts.kitPrimary, "#3558a8");
  const secondary = colour(opts.kitSecondary, "#d95a48");
  const bg = colour(opts.background, "#202d3f");
  const skin = traits.skin;
  const spec = refinedFaceSpec(traits);
  const shirt = refinedShirtMarkup(primary, secondary, person.pos, skin.base, traits.collar);
  const earY = spec.eyeY + 11;
  const ears = `<ellipse cx="${spec.earX}" cy="${earY}" rx="8" ry="16" fill="${skin.base}" stroke="${OUTLINE}" stroke-width="2.8"/><ellipse cx="${256 - spec.earX}" cy="${earY}" rx="8" ry="16" fill="${skin.base}" stroke="${OUTLINE}" stroke-width="2.8"/>`;
  const head = `<path d="${spec.path}" fill="${skin.base}" stroke="${OUTLINE}" stroke-width="3.2" stroke-linejoin="round"/>`;
  const shadows = `<path d="M161 73 Q172 106 166 136 Q160 163 145 174 Q161 150 158 113 Q157 89 151 73 Z" fill="${skin.shadow}" opacity=".22"/><path d="M103 177 Q128 188 153 177 Q147 195 128 198 Q109 195 103 177 Z" fill="${skin.shadow}" opacity=".22"/><path d="M124 ${spec.noseY + 15} Q128 ${spec.noseY + 20} 135 ${spec.noseY + 16}" fill="none" stroke="${skin.shadow}" stroke-width="2" stroke-linecap="round"/>`;
  const hair = refinedHairMarkup(traits.hairStyle, traits.hair.base, traits.hair.hi, small);
  const beard = refinedBeardMarkup(traits.beard, skin, traits.hair.base);
  const age = traits.age >= 34 && !small ? `<path d="M99 121 l-6 2 M157 123 l6 2" fill="none" stroke="${skin.featureLine}" stroke-width="1.7" stroke-linecap="round" opacity=".7"/>` : "";
  const label = esc(person.name || "球员头像");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}" role="img" aria-label="${label}"><rect width="256" height="256" fill="${bg}"/><path d="M0 234 Q64 215 128 224 Q192 215 256 234 V256 H0 Z" fill="${secondary}" opacity=".18"/>${shirt}${ears}${head}${shadows}${beard}${hair}${refinedFeaturesMarkup(traits, spec, small)}${age}</svg>`;
}

function thirdFaceSpec(traits) {
  if (traits.hairStyle === "crop") {
    return {
      key: "iris",
      path: "M91 67 Q128 49 165 67 Q170 101 165 130 Q158 158 128 176 Q98 158 91 130 Q86 101 91 67 Z",
      earX: 88,
      eyeGap: 38,
      eyeY: 103,
      noseY: 110,
      mouthY: 146,
    };
  }
  if (traits.hairStyle === "side") {
    return {
      key: "marek",
      path: "M80 68 Q128 49 176 68 L175 127 Q168 158 128 179 Q88 158 81 127 Z",
      earX: 79,
      eyeGap: 44,
      eyeY: 103,
      noseY: 110,
      mouthY: 148,
    };
  }
  if (traits.hairStyle === "curl") {
    return {
      key: "sami",
      path: "M82 70 Q128 50 174 70 L174 127 Q167 157 128 177 Q89 157 82 127 Z",
      earX: 81,
      eyeGap: 43,
      eyeY: 102,
      noseY: 109,
      mouthY: 147,
    };
  }
  return {
    key: "noah",
    path: "M87 72 Q128 50 169 72 Q174 104 167 133 Q157 159 128 175 Q99 159 89 133 Q82 104 87 72 Z",
    earX: 85,
    eyeGap: 39,
    eyeY: 101,
    noseY: 108,
    mouthY: 145,
  };
}

function thirdHairMarkup(traits, detailLevel) {
  const base = traits.hair.base;
  const hi = traits.hair.hi;
  const outer = `fill="${base}" stroke="${OUTLINE}" stroke-width="3.15" stroke-linejoin="round"`;
  const highlight = (d) => detailLevel >= 2 ? `<path d="${d}" fill="${hi}" opacity=".5"/>` : "";
  switch (traits.hairStyle) {
    case "side":
      return `<path d="M84 75 Q83 52 99 39 Q123 25 151 34 Q169 40 173 60 L170 72 Q153 61 133 59 Q111 60 91 73 Z" ${outer}/>${highlight("M101 42 Q124 31 148 38 Q135 38 117 49 Z")}`;
    case "curl":
      return `<path d="M78 82 Q72 58 87 42 Q98 29 113 36 Q126 21 140 34 Q157 23 169 39 Q184 40 182 61 Q188 72 175 82 Q160 70 147 73 Q136 82 125 71 Q112 82 100 73 Q88 84 78 82 Z" ${outer}/>${highlight("M91 45 Q103 34 113 43 Q126 29 137 42 Q151 31 164 43 Q150 42 137 49 Q119 45 104 51 Z")}`;
    case "coils":
      return `<path d="M83 80 Q77 54 97 38 Q119 22 148 31 Q168 36 177 55 Q181 68 170 79 Q155 67 140 67 Q128 76 116 67 Q102 77 90 72 Z" ${outer}/>${highlight("M103 39 Q126 27 151 36 Q138 36 126 45 Q114 40 103 47 Z")}`;
    default:
      return `<path d="M89 77 Q87 54 101 40 Q122 28 147 34 Q164 39 169 57 L167 70 Q153 62 142 63 L132 58 L121 68 L110 62 L99 71 Z" ${outer}/>${highlight("M105 42 Q125 33 146 38 Q132 39 119 47 Z")}`;
  }
}

function thirdEyesMarkup(traits, spec, detailLevel) {
  const style = traits.eyeStyle;
  const left = 128 - spec.eyeGap / 2;
  const right = 128 + spec.eyeGap / 2;
  const y = spec.eyeY + (style === 2 ? 1 : 0);
  const widths = [22, 24, 23, 21];
  const heights = [6.8, 9.1, 8, 6.3];
  const w = widths[style];
  const h = heights[style];
  const lidWidth = detailLevel === 0 ? 2.85 : 2.15;
  const eyeFill = traits.skin.highlight;
  const upperPath = (cx) => {
    if (style === 2) return `M${cx - w / 2} ${y - 1} Q${cx} ${y - h} ${cx + w / 2} ${y + 1}`;
    if (style === 3) return `M${cx - w / 2} ${y} Q${cx} ${y - h} ${cx + w / 2} ${y}`;
    return `M${cx - w / 2} ${y} Q${cx} ${y - h} ${cx + w / 2} ${y}`;
  };
  const whitePath = (cx) => `M${cx - w / 2} ${y} Q${cx} ${y - h} ${cx + w / 2} ${y} Q${cx} ${y + h * .48} ${cx - w / 2} ${y} Z`;
  const upper = `<path d="${upperPath(left)} M${upperPath(right)}" fill="none" stroke="${OUTLINE}" stroke-width="${lidWidth}" stroke-linecap="round"/>`;
  const whites = detailLevel === 0 ? "" : `<path d="${whitePath(left)} M${whitePath(right)}" fill="${eyeFill}" opacity=".66"/>`;
  const pupil = (cx) => detailLevel === 0
    ? `<path d="M${cx} ${y - 2} L${cx} ${y + 2}" stroke="${EYE}" stroke-width="2.25" stroke-linecap="round"/>`
    : `<ellipse cx="${cx}" cy="${y - .1}" rx="${detailLevel === 1 ? 2.5 : 3.2}" ry="${detailLevel === 1 ? 3.2 : 3.8}" fill="${EYE}"/>${detailLevel >= 2 ? `<circle cx="${cx - 1}" cy="${y - 1.3}" r=".75" fill="${eyeFill}" opacity=".8"/>` : ""}`;
  const lower = detailLevel >= 2 && style !== 2
    ? `<path d="M${left - 5} ${y + 2.8} Q${left} ${y + 4.1} ${left + 4} ${y + 2.8} M${right - 4} ${y + 2.8} Q${right} ${y + 4.1} ${right + 5} ${y + 2.8}" fill="none" stroke="${traits.skin.featureLine}" stroke-width="1.15" stroke-linecap="round" opacity=".62"/>`
    : "";
  return `${whites}${upper}${pupil(left)}${pupil(right)}${lower}`;
}

function thirdFeaturesMarkup(traits, spec, detailLevel) {
  const left = 128 - spec.eyeGap / 2;
  const right = 128 + spec.eyeGap / 2;
  const browY = spec.eyeY - 17 + (traits.brow === 1 ? -1 : traits.brow === 2 ? 1 : 0);
  const brows = spec.key === "sami"
    ? `<path d="M${left - 8} ${browY + 1} Q${left} ${browY - 3} ${left + 8} ${browY} M${right - 8} ${browY} Q${right} ${browY - 3} ${right + 8} ${browY + 1}" fill="none" stroke="${traits.skin.featureLine}" stroke-width="3" stroke-linecap="round"/>`
    : `<path d="M${left - 7.5} ${browY} Q${left} ${browY - 2.5} ${left + 7.5} ${browY + .5} M${right - 7.5} ${browY + .5} Q${right} ${browY - 2.5} ${right + 7.5} ${browY}" fill="none" stroke="${traits.skin.featureLine}" stroke-width="2.85" stroke-linecap="round"/>`;
  const nose = spec.key === "iris"
    ? `M127 ${spec.noseY} Q124 ${spec.noseY + 12} 127 ${spec.noseY + 16} M123 ${spec.noseY + 17} Q128 ${spec.noseY + 19} 135 ${spec.noseY + 16}`
    : spec.key === "marek"
      ? `M128 ${spec.noseY} Q128 ${spec.noseY + 12} 132 ${spec.noseY + 16} M122 ${spec.noseY + 17} Q128 ${spec.noseY + 20} 136 ${spec.noseY + 17}`
      : spec.key === "sami"
        ? `M128 ${spec.noseY} Q132 ${spec.noseY + 12} 128 ${spec.noseY + 17} M121 ${spec.noseY + 17} Q128 ${spec.noseY + 20} 136 ${spec.noseY + 17}`
        : `M128 ${spec.noseY} Q125 ${spec.noseY + 11} 128 ${spec.noseY + 15} M123 ${spec.noseY + 16} Q128 ${spec.noseY + 18} 134 ${spec.noseY + 16}`;
  const mouth = spec.key === "iris"
    ? `M117 ${spec.mouthY} Q128 ${spec.mouthY + 1} 139 ${spec.mouthY}`
    : spec.key === "marek"
      ? `M118 ${spec.mouthY} Q128 ${spec.mouthY + 1} 138 ${spec.mouthY}`
      : spec.key === "sami"
        ? `M117 ${spec.mouthY + 1} Q128 ${spec.mouthY - 1} 139 ${spec.mouthY + 1}`
        : `M117 ${spec.mouthY} Q128 ${spec.mouthY + 2} 139 ${spec.mouthY}`;
  return `${brows}${thirdEyesMarkup(traits, spec, detailLevel)}<path d="${nose}" fill="none" stroke="${traits.skin.featureLine}" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"/><path d="${mouth}" fill="none" stroke="${traits.skin.lipTone}" stroke-width="2.25" stroke-linecap="round"/>`;
}

function thirdBeardMarkup(traits, spec, detailLevel) {
  const hair = traits.hair.base;
  if (traits.beard === "none") return "";
  if (spec.key === "marek") {
    const moustache = detailLevel === 0 ? "" : `<path d="M118 144 Q123 141 128 145 Q133 141 138 144 Q133 147 128 146 Q123 147 118 144 Z" fill="${hair}" opacity=".66"/>`;
    return `<path d="M99 140 Q103 153 112 162 Q120 169 128 172 Q136 169 144 162 Q153 153 157 140 Q154 160 145 169 Q128 178 111 169 Q102 160 99 140 Z" fill="${hair}" opacity=".42"/>${moustache}`;
  }
  const moustache = detailLevel === 0 ? "" : `<path d="M116 142 Q123 138 128 143 Q133 138 140 142 Q134 146 128 145 Q122 146 116 142 Z" fill="${hair}" opacity=".7"/>`;
  return `${moustache}<path d="M101 142 Q104 154 111 161 M155 142 Q152 154 145 161" fill="none" stroke="${hair}" stroke-width="4.2" stroke-linecap="round" opacity=".48"/><path d="M106 154 Q128 170 150 154 Q146 174 128 178 Q110 174 106 154 Z" fill="${hair}" opacity=".5"/>`;
}

function thirdShirtMarkup(primary, secondary, skinBase, collarStyle, detailLevel) {
  const body = `<path d="M42 256 L47 211 Q56 190 91 178 L107 182 L149 182 L165 178 Q200 190 209 211 L214 256 Z" fill="${primary}" stroke="${OUTLINE}" stroke-width="3.25" stroke-linejoin="round"/>`;
  const panel = collarStyle === 0
    ? `<path d="M109 181 L128 190 L147 181 L151 256 L105 256 Z" fill="${secondary}" opacity=".58"/>`
    : `<path d="M43 256 L47 211 Q56 190 91 178 L108 183 L128 190 L128 256 Z" fill="${secondary}" opacity=".56"/>`;
  const neck = `<path d="M103 153 L153 153 L154 182 Q128 193 102 182 Z" fill="${skinBase}" stroke="${OUTLINE}" stroke-width="2.65"/>`;
  const collar = collarStyle === 0
    ? `<path d="M106 177 Q128 191 150 177" fill="none" stroke="${secondary}" stroke-width="4.6" stroke-linecap="round"/>`
    : `<path d="M106 177 L128 191 L150 177" fill="none" stroke="${secondary}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const seams = detailLevel >= 2 ? `<path d="M50 209 Q67 193 89 189 M206 209 Q189 193 167 189" fill="none" stroke="${SHIRT_DARK}" stroke-width="1.8" opacity=".24" stroke-linecap="round"/>` : "";
  return `${body}${panel}${neck}${collar}${seams}`;
}

function thirdAvatarSvg(person, opts, traits) {
  const size = Number(opts.size) || 192;
  const detailLevel = size <= 40 ? 0 : size <= 48 ? 1 : 2;
  const primary = colour(opts.kitPrimary, "#3558a8");
  const secondary = colour(opts.kitSecondary, "#d95a48");
  const bg = colour(opts.background, "#202d3f");
  const skin = traits.skin;
  const spec = thirdFaceSpec(traits);
  const shirt = thirdShirtMarkup(primary, secondary, skin.base, traits.collar, detailLevel);
  const earY = spec.eyeY + 10;
  const innerEar = detailLevel >= 2 ? `<path d="M${spec.earX + 1} ${earY - 4} Q${spec.earX + 4} ${earY} ${spec.earX + 1} ${earY + 4} M${255 - spec.earX} ${earY - 4} Q${252 - spec.earX} ${earY} ${255 - spec.earX} ${earY + 4}" fill="none" stroke="${skin.shadow}" stroke-width="1.45" stroke-linecap="round" opacity=".7"/>` : "";
  const ears = `<ellipse cx="${spec.earX}" cy="${earY}" rx="6.7" ry="13.4" fill="${skin.base}" stroke="${OUTLINE}" stroke-width="2.55"/><ellipse cx="${256 - spec.earX}" cy="${earY}" rx="6.7" ry="13.4" fill="${skin.base}" stroke="${OUTLINE}" stroke-width="2.55"/>${innerEar}`;
  const head = `<path d="${spec.path}" fill="${skin.base}" stroke="${OUTLINE}" stroke-width="3.15" stroke-linejoin="round"/>`;
  const shadows = `<path d="M151 72 Q165 93 164 122 Q162 147 146 164 Q156 143 155 112 Q154 88 147 73 Z" fill="${skin.shadow}" opacity=".2"/><path d="M105 174 Q128 184 151 174 Q146 188 128 191 Q110 188 105 174 Z" fill="${skin.shadow}" opacity=".22"/>`;
  const hair = thirdHairMarkup(traits, detailLevel);
  const beard = thirdBeardMarkup(traits, spec, detailLevel);
  const label = esc(person.name || "球员头像");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}" role="img" aria-label="${label}"><rect width="256" height="256" fill="${bg}"/><path d="M0 236 Q64 218 128 226 Q192 218 256 236 V256 H0 Z" fill="${secondary}" opacity=".16"/>${shirt}${ears}${head}${shadows}${beard}${hair}${thirdFeaturesMarkup(traits, spec, detailLevel)}</svg>`;
}

/** Render a deterministic, adult head-and-shoulders SVG for the style sample. */
export function editorialAvatarSvg(person = {}, opts = {}) {
  const traits = portraitTraits(person);
  if (opts.refinement === 3) return thirdAvatarSvg(person, opts, traits);
  if (opts.refined) return refinedAvatarSvg(person, opts, traits);
  const primary = colour(opts.kitPrimary, "#3558a8");
  const secondary = colour(opts.kitSecondary, "#d95a48");
  const bg = colour(opts.background, "#d7dee5");
  const skin = traits.skin;
  const shirt = shirtMarkup(primary, secondary, person.pos, skin.base);
  const ears = `<ellipse cx="82" cy="116" rx="9" ry="18" fill="${skin.base}" stroke="${OUTLINE}" stroke-width="4"/><ellipse cx="174" cy="116" rx="9" ry="18" fill="${skin.base}" stroke="${OUTLINE}" stroke-width="4"/><path d="M80 111 q7 4 1 12 M176 111 q-7 4 -1 12" fill="none" stroke="${skin.shadow}" stroke-width="2.5" stroke-linecap="round"/>`;
  const head = `<path d="${facePath(traits.face)}" fill="${skin.base}" stroke="${OUTLINE}" stroke-width="3.5" stroke-linejoin="round"/>`;
  const shadow = `<path d="M87 119 Q91 154 113 170 Q138 184 161 158 Q154 175 128 181 Q94 165 87 119 Z" fill="${skin.shadow}" opacity=".3"/><path d="M158 76 Q169 101 166 131 Q163 148 153 160 Q162 135 159 105 Z" fill="${skin.shadow}" opacity=".18"/>`;
  const highlight = `<path d="M96 75 Q111 59 127 58 Q109 75 104 92 Q99 99 94 93 Z" fill="${skin.highlight}" opacity=".46"/>`;
  const ageMarks = traits.age >= 34 ? `<path d="M94 119 l-7 2 M162 119 l7 2" stroke="${skin.shadow}" stroke-width="2.5" stroke-linecap="round"/>` : "";
  const hair = `<g transform="translate(12.8 0) scale(.9 1)">${hairMarkup(traits.hairStyle, traits.hair.base, traits.hair.hi)}</g>`;
  const beard = beardMarkup(traits.beard, skin, traits.hair.base);
  const size = Number(opts.size) || 192;
  const label = esc(person.name || "球员头像");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}" role="img" aria-label="${label}"><rect width="256" height="256" fill="${bg}"/><path d="M0 224 Q60 197 128 209 Q196 197 256 224 V256 H0 Z" fill="${bg === "#d7dee5" ? "#c0cbd4" : secondary}" opacity=".38"/>${shirt}${ears}${head}${shadow}${highlight}${hair}${featuresMarkup(traits)}${beard}${ageMarks}</svg>`;
}

export function editorialPortraitTraits(person = {}) {
  return portraitTraits(person);
}
