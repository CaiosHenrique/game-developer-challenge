/**
 * Builds the runtime game assets in public/game/ from the original challenge assets.
 * The original files under assets/ are only read, never modified.
 *
 * - ships: Starling XML atlas -> PixiJS JSON spritesheet (1x only; the "retina" ship sheet is identical to 1x)
 * - tiles: named regions of the 2x tile sheet (the sheet has no metadata; 64px logical grid)
 * - water: standalone 2x water tile, so it can be repeated by a TilingSprite
 * - ui:    the provided 2x UI atlas (already PixiJS-compatible), with a stable file name
 * - sounds: the sound effects the game plays (SOUND_IDS), copied byte for byte; the ambient
 *   loops and the interface sounds are not used and not copied
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUND_IDS } from '../src/game/audio/soundMap.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets');
const out = join(root, 'public', 'game');

type Rect = { x: number; y: number; w: number; h: number };
type SpritesheetJson = {
  frames: Record<string, { frame: Rect; sourceSize?: { w: number; h: number } }>;
  meta: { image: string; size: { w: number; h: number }; scale: string };
};

function pngSize(file: string): { w: number; h: number } {
  const header = readFileSync(file).subarray(0, 24);
  if (header.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`Not a PNG: ${file}`);
  return { w: header.readUInt32BE(16), h: header.readUInt32BE(20) };
}

function assertFramesInBounds(name: string, sheet: SpritesheetJson): void {
  for (const [frameName, { frame }] of Object.entries(sheet.frames)) {
    const inside =
      frame.x >= 0 &&
      frame.y >= 0 &&
      frame.x + frame.w <= sheet.meta.size.w &&
      frame.y + frame.h <= sheet.meta.size.h;
    if (!inside) throw new Error(`${name}: frame "${frameName}" is outside the image bounds`);
  }
}

function assertHasFrames(name: string, sheet: SpritesheetJson, required: string[]): void {
  const missing = required.filter((frame) => !(frame in sheet.frames));
  if (missing.length > 0) throw new Error(`${name}: missing frames ${missing.join(', ')}`);
}

function writeSheet(fileName: string, sheet: SpritesheetJson): void {
  writeFileSync(join(out, fileName), `${JSON.stringify(sheet, null, 2)}\n`);
}

function buildShips(): SpritesheetJson {
  const xml = readFileSync(join(src, 'spritesheet', 'ships_miscellaneous_sheet.xml'), 'utf8');
  const pattern =
    /<SubTexture\s+name="([^"]+)\.png"\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"\s*\/>/g;
  const frames: SpritesheetJson['frames'] = {};
  for (const [, name, x, y, w, h] of xml.matchAll(pattern)) {
    frames[name!] = { frame: { x: Number(x), y: Number(y), w: Number(w), h: Number(h) } };
  }
  const declared = (xml.match(/<SubTexture\b/g) ?? []).length;
  if (Object.keys(frames).length !== declared) {
    throw new Error(`ships: parsed ${Object.keys(frames).length} of ${declared} SubTextures`);
  }

  const imageFile = join(src, 'spritesheet', 'ships_miscellaneous_sheet.png');
  copyFileSync(imageFile, join(out, 'ships.png'));
  return { frames, meta: { image: 'ships.png', size: pngSize(imageFile), scale: '1' } };
}

/** Tile sheet regions in 1x logical pixels (64px grid). tile_N in png/ is cell N-1 in row-major order. */
const TILE_REGIONS: Record<string, Rect> = {
  island_sand: { x: 0, y: 0, w: 192, h: 192 },
  island_grass: { x: 320, y: 0, w: 256, h: 256 },
  rock_1: { x: 0, y: 192, w: 64, h: 64 },
  rock_2: { x: 64, y: 192, w: 64, h: 64 },
  rock_3: { x: 128, y: 192, w: 64, h: 64 },
  rock_moss_1: { x: 0, y: 256, w: 64, h: 64 },
  rock_moss_2: { x: 64, y: 256, w: 64, h: 64 },
  rock_moss_3: { x: 128, y: 256, w: 64, h: 64 },
  palm_1: { x: 320, y: 256, w: 64, h: 64 },
  palm_2: { x: 384, y: 256, w: 64, h: 64 },
  palm_3: { x: 448, y: 256, w: 64, h: 64 },
  plant_1: { x: 384, y: 320, w: 64, h: 64 },
  plant_2: { x: 448, y: 320, w: 64, h: 64 },
};

/**
 * The tile sheet has no padding between cells, so linear filtering of a scaled sprite samples
 * the neighbouring cell at the frame border (visible as thin lines). Insetting each frame by
 * one logical pixel (two texels in the 2x sheet) avoids that bleeding.
 */
const TILE_INSET = 2;

function buildTiles(): SpritesheetJson {
  const scale = 2;
  const imageFile = join(src, 'tilesheet', 'tiles_sheet_retina.png');
  const frames: SpritesheetJson['frames'] = {};
  for (const [name, r] of Object.entries(TILE_REGIONS)) {
    frames[name] = {
      frame: {
        x: r.x * scale + TILE_INSET,
        y: r.y * scale + TILE_INSET,
        w: r.w * scale - 2 * TILE_INSET,
        h: r.h * scale - 2 * TILE_INSET,
      },
    };
  }
  copyFileSync(imageFile, join(out, 'tiles.png'));
  return { frames, meta: { image: 'tiles.png', size: pngSize(imageFile), scale: String(scale) } };
}

function buildUi(): SpritesheetJson {
  const json = JSON.parse(
    readFileSync(join(src, 'spritesheet', 'ui_sheet_retina.json'), 'utf8'),
  ) as SpritesheetJson;
  json.meta.image = 'ui.png';
  copyFileSync(join(src, 'spritesheet', 'ui_sheet_retina.png'), join(out, 'ui.png'));
  return json;
}

mkdirSync(out, { recursive: true });

const ships = buildShips();
assertFramesInBounds('ships', ships);
assertHasFrames('ships', ships, [
  'ship_2', 'ship_3', 'ship_5', 'ship_23', 'cannon_ball',
  'explosion_1', 'explosion_2', 'explosion_3', 'fire_1', 'fire_2',
]); // prettier-ignore
writeSheet('ships.json', ships);

const tiles = buildTiles();
assertFramesInBounds('tiles', tiles);
writeSheet('tiles.json', tiles);

const ui = buildUi();
assertFramesInBounds('ui', ui);
assertHasFrames('ui', ui, [
  'enemy_health_frame',
  'enemy_health_fill_green',
  'enemy_health_fill_red',
]);
writeSheet('ui.json', ui);

copyFileSync(join(src, 'png', 'retina', 'tiles', 'tile_73.png'), join(out, 'water@2x.png'));
copyFileSync(join(src, 'png', 'default', 'ships', 'ship_2.png'), join(out, 'favicon.png'));

// A missing file fails here (copyFileSync throws), not silently at run time.
mkdirSync(join(out, 'sounds'), { recursive: true });
for (const id of SOUND_IDS) {
  copyFileSync(join(src, 'sounds', `${id}.wav`), join(out, 'sounds', `${id}.wav`));
}

console.log(
  `prepare-assets: ships=${Object.keys(ships.frames).length} tiles=${Object.keys(tiles.frames).length} ` +
    `ui=${Object.keys(ui.frames).length} frames, sounds=${SOUND_IDS.length} -> public/game/`,
);
