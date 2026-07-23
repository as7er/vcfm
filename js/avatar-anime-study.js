/**
 * Single-character technical study for a modern football-anime portrait.
 * This is not wired into the production avatar component.
 */

const INK = "#252734";
const INK_SOFT = "#51484a";
const EYE_WHITE = "#f3eee7";

function hashStr(value) {
  let h = 2166136261;
  const text = String(value || "anime-study");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

function stableProfile(person) {
  const seed = person?.appearanceSeed || person?.id || person?.name || "anime-study";
  const h = hashStr(seed);
  const iris = [
    { base: "#697c82", dark: "#34434b" },
    { base: "#7b6f62", dark: "#453b36" },
    { base: "#687561", dark: "#394238" },
  ][h % 3];
  return {
    seed,
    iris,
    gaze: ((h >>> 5) % 3) - 1,
  };
}

function eyeMarkup(cx, cy, scale, iris, gaze) {
  const w = 28 * scale;
  const h = 16 * scale;
  const irisX = cx + gaze * 1.1;
  const r = 8.3 * scale;
  const white = `M${cx - w} ${cy + 1} C${cx - w * .48} ${cy - h} ${cx + w * .45} ${cy - h * .9} ${cx + w} ${cy} C${cx + w * .45} ${cy + h * .7} ${cx - w * .45} ${cy + h * .72} ${cx - w} ${cy + 1} Z`;
  const upper = `M${cx - w} ${cy + 1} C${cx - w * .45} ${cy - h} ${cx + w * .43} ${cy - h * .94} ${cx + w} ${cy}`;
  const lower = `M${cx - w * .72} ${cy + h * .48} C${cx - w * .18} ${cy + h * .8} ${cx + w * .38} ${cy + h * .72} ${cx + w * .72} ${cy + h * .34}`;
  const irisTop = `M${irisX - r} ${cy - 1} A${r} ${r * 1.08} 0 0 1 ${irisX + r} ${cy - 1} Q${irisX} ${cy - r * .4} ${irisX - r} ${cy - 1} Z`;
  return `<path d="${white}" fill="${EYE_WHITE}"/><ellipse cx="${irisX}" cy="${cy}" rx="${r}" ry="${r * 1.08}" fill="${iris.base}"/><path d="${irisTop}" fill="${iris.dark}" opacity=".88"/><ellipse cx="${irisX}" cy="${cy + 1}" rx="${r * .43}" ry="${r * .56}" fill="#25252b"/><circle cx="${irisX - r * .3}" cy="${cy - r * .35}" r="${r * .2}" fill="#fffaf1" opacity=".92"/><circle cx="${irisX + r * .16}" cy="${cy + r * .34}" r="${r * .1}" fill="#bcc9c7" opacity=".7"/><path d="${upper}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="${lower}" fill="none" stroke="${INK_SOFT}" stroke-width="1.7" stroke-linecap="round" opacity=".72"/>`;
}

/**
 * Render one deterministic, original layered SVG portrait.
 * The signature intentionally mirrors the production renderer's person + opts shape.
 */
export function renderAnimeStudySvg(person = {}, opts = {}) {
  const size = Number(opts.size) || 384;
  const primary = colour(opts.kitPrimary, "#176b66");
  const secondary = colour(opts.kitSecondary, "#d8ad4f");
  const background = colour(opts.background, "#172334");
  const profile = stableProfile(person);
  const label = esc(person.name || "原创足球动画球员");

  const skin = {
    base: "#d99a76",
    shadow: "#ad674f",
    shadow2: "#85483f",
    feature: "#70463f",
    lip: "#8e514f",
    warmth: "#c97669",
  };
  const hair = { base: "#5a3529", shadow: "#38272a", light: "#9a6241" };

  const shirt = `<g stroke-linejoin="round">
    <path d="M23 384 L39 329 Q51 292 103 273 Q132 263 159 260 L192 280 L225 260 Q252 263 281 273 Q333 292 345 329 L361 384 Z" fill="${primary}" stroke="${INK}" stroke-width="5"/>
    <path d="M23 384 L39 329 Q52 292 108 272 L141 263 L166 279 L145 384 Z" fill="${secondary}" opacity=".84"/>
    <path d="M361 384 L345 329 Q333 292 281 273 L253 264 L225 280 L245 384 Z" fill="#0f544f" opacity=".74"/>
    <path d="M154 251 L230 251 L236 289 Q192 311 148 289 Z" fill="${skin.base}" stroke="${INK}" stroke-width="4.2"/>
    <path d="M156 262 Q192 291 228 262" fill="none" stroke="#173f49" stroke-width="10" stroke-linecap="round"/>
    <path d="M157 263 Q192 286 227 263" fill="none" stroke="${secondary}" stroke-width="3.4" stroke-linecap="round" opacity=".9"/>
    <path d="M61 322 Q93 292 136 285 M323 322 Q291 292 248 285" fill="none" stroke="#123f46" stroke-width="3" stroke-linecap="round" opacity=".62"/>
    <path d="M77 384 Q88 332 126 306 M307 384 Q296 332 258 306" fill="none" stroke="#102f38" stroke-width="2.4" stroke-linecap="round" opacity=".38"/>
  </g>`;

  const hairBack = `<path d="M109 142 Q96 107 109 78 Q119 53 141 43 L137 26 L158 38 L171 17 L181 39 L204 21 L207 43 L232 31 L226 53 Q251 61 263 86 Q277 112 267 151 L246 127 Q236 95 219 75 Q190 52 155 68 Q128 81 119 120 Z" fill="${hair.shadow}" stroke="${INK}" stroke-width="5.2" stroke-linejoin="round"/>`;

  const ears = `<g stroke="${INK}" stroke-width="3.5">
    <path d="M111 144 Q94 139 93 163 Q93 190 114 194 L121 180 L119 153 Z" fill="${skin.base}"/>
    <path d="M270 142 Q287 139 288 163 Q288 188 268 194 L261 180 L263 153 Z" fill="${skin.base}"/>
  </g><path d="M105 154 Q113 158 107 177 M276 153 Q268 158 274 176" fill="none" stroke="${skin.shadow2}" stroke-width="2.2" stroke-linecap="round" opacity=".72"/>`;

  const face = `<path d="M124 84 Q146 59 185 56 Q226 54 252 81 Q268 102 269 145 L264 194 Q257 232 228 256 Q210 271 190 278 Q168 272 149 257 Q120 233 114 194 L110 146 Q110 105 124 84 Z" fill="${skin.base}" stroke="${INK}" stroke-width="4.7" stroke-linejoin="round"/>`;

  const faceShadows = `<path d="M235 73 Q260 93 264 130 L264 194 Q257 230 228 255 Q210 270 190 277 Q209 253 214 230 Q221 198 218 165 Q217 118 201 77 Z" fill="${skin.shadow}" opacity=".45"/>
    <path d="M126 87 Q143 66 169 60 Q146 82 141 108 Q138 124 127 135 L114 132 Q113 104 126 87 Z" fill="${skin.shadow}" opacity=".22"/>
    <path d="M155 259 Q190 278 225 258 Q219 288 192 296 Q165 288 155 259 Z" fill="${skin.shadow2}" opacity=".34"/>
    <path d="M226 162 Q237 174 230 193 Q225 201 216 203 Q223 185 219 170 Z" fill="${skin.shadow2}" opacity=".18"/>
    <path d="M129 201 Q139 211 153 207" fill="none" stroke="${skin.warmth}" stroke-width="4" stroke-linecap="round" opacity=".34"/>`;

  const leftEye = eyeMarkup(157, 157, 1, profile.iris, profile.gaze);
  const rightEye = eyeMarkup(224, 154, .92, profile.iris, profile.gaze);

  const features = `<path d="M130 127 Q153 115 176 127 Q154 120 132 132 Z" fill="${hair.shadow}"/>
    <path d="M204 123 Q228 113 247 126 Q227 119 206 129 Z" fill="${hair.shadow}"/>
    ${leftEye}${rightEye}
    <path d="M193 166 Q188 190 194 199 Q202 203 209 197" fill="none" stroke="${skin.feature}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M189 200 Q198 205 211 198" fill="none" stroke="${skin.shadow2}" stroke-width="2" stroke-linecap="round" opacity=".7"/>
    <path d="M164 226 Q189 236 218 223 Q207 241 190 243 Q175 241 164 226 Z" fill="${skin.lip}" opacity=".92"/>
    <path d="M170 228 Q190 234 211 226 Q204 235 190 236 Q178 235 170 228 Z" fill="#f2e4d7" opacity=".82"/>
    <path d="M180 247 Q190 250 202 246" fill="none" stroke="${skin.shadow2}" stroke-width="1.8" stroke-linecap="round" opacity=".48"/>`;

  const hairFront = `<g stroke-linejoin="round">
    <path d="M113 129 Q104 96 118 70 Q138 39 176 39 Q217 36 246 64 Q259 78 261 102 L251 120 L235 100 L225 118 L211 91 L197 117 L181 84 L163 116 L148 91 L132 120 L119 108 Z" fill="${hair.base}" stroke="${INK}" stroke-width="4.8"/>
    <path d="M121 76 Q141 48 171 45 L151 91 L174 69 L164 112 L190 77 L183 118 L208 84 L201 113 L225 87 L218 115 L244 93 L235 119 Q220 105 211 91 L197 117 L181 84 L163 116 L148 91 L132 120 L119 108 Z" fill="${hair.base}"/>
    <path d="M133 66 Q157 43 187 46 Q167 55 153 78 Q146 89 133 96 Z" fill="${hair.light}" opacity=".72"/>
    <path d="M188 47 Q218 49 239 69 Q215 59 196 72 Z" fill="${hair.light}" opacity=".38"/>
    <path d="M151 91 L174 69 M164 112 L190 77 M183 118 L208 84 M201 113 L225 87" fill="none" stroke="${hair.shadow}" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 384" width="${size}" height="${size}" role="img" aria-label="${label}">
    <rect width="384" height="384" fill="${background}"/>
    <path d="M0 92 Q96 63 192 78 Q288 55 384 92 V0 H0 Z" fill="#243451" opacity=".7"/>
    <path d="M0 334 Q90 305 192 322 Q294 305 384 334 V384 H0 Z" fill="#233140" opacity=".62"/>
    ${shirt}${hairBack}${ears}${face}${faceShadows}${features}${hairFront}
  </svg>`;
}

export function animeStudyProfile(person = {}) {
  return stableProfile(person);
}
