// HUD art from the original asset pack, at 1x and 2x (Vite bundles and fingerprints them).
import buttonRound from '../../assets/png/default/ui/controls/button_round_normal.png';
import iconPause from '../../assets/png/default/ui/controls/icon_pause.png';
import buttonRound2x from '../../assets/png/retina/ui/controls/button_round_normal.png';
import iconPause2x from '../../assets/png/retina/ui/controls/icon_pause.png';
import counterPanel from '../../assets/png/default/ui/hud/counter_panel.png';
import healthFillAmber from '../../assets/png/default/ui/hud/health_fill_amber.png';
import healthFillGreen from '../../assets/png/default/ui/hud/health_fill_green.png';
import healthFillRed from '../../assets/png/default/ui/hud/health_fill_red.png';
import healthFrame from '../../assets/png/default/ui/hud/health_frame.png';
import iconHeart from '../../assets/png/default/ui/hud/icon_heart.png';
import iconScore from '../../assets/png/default/ui/hud/icon_score.png';
import iconTime from '../../assets/png/default/ui/hud/icon_time.png';
import counterPanel2x from '../../assets/png/retina/ui/hud/counter_panel.png';
import healthFillAmber2x from '../../assets/png/retina/ui/hud/health_fill_amber.png';
import healthFillGreen2x from '../../assets/png/retina/ui/hud/health_fill_green.png';
import healthFillRed2x from '../../assets/png/retina/ui/hud/health_fill_red.png';
import healthFrame2x from '../../assets/png/retina/ui/hud/health_frame.png';
import iconHeart2x from '../../assets/png/retina/ui/hud/icon_heart.png';
import iconScore2x from '../../assets/png/retina/ui/hud/icon_score.png';
import iconTime2x from '../../assets/png/retina/ui/hud/icon_time.png';

import titlePirateBattle from '../../assets/png/default/ui/menu/title_pirate_battle.png';
import titlePirateBattle2x from '../../assets/png/retina/ui/menu/title_pirate_battle.png';

import iconTurnLeft from '../../assets/png/default/ui/controls/icon_turn_left.png';
import iconTurnLeft2x from '../../assets/png/retina/ui/controls/icon_turn_left.png';
import iconForward from '../../assets/png/default/ui/controls/icon_forward.png';
import iconForward2x from '../../assets/png/retina/ui/controls/icon_forward.png';
import iconTurnRight from '../../assets/png/default/ui/controls/icon_turn_right.png';
import iconTurnRight2x from '../../assets/png/retina/ui/controls/icon_turn_right.png';
import iconFireLeft from '../../assets/png/default/ui/controls/icon_fire_left.png';
import iconFireLeft2x from '../../assets/png/retina/ui/controls/icon_fire_left.png';
import iconFireFront from '../../assets/png/default/ui/controls/icon_fire_front.png';
import iconFireFront2x from '../../assets/png/retina/ui/controls/icon_fire_front.png';
import iconFireRight from '../../assets/png/default/ui/controls/icon_fire_right.png';
import iconFireRight2x from '../../assets/png/retina/ui/controls/icon_fire_right.png';

export type Art = { src: string; srcSet: string };

const art = (x1: string, x2: string): Art => ({ src: x1, srcSet: `${x1} 1x, ${x2} 2x` });

export const HUD_ART = {
  buttonRound: art(buttonRound, buttonRound2x),
  iconPause: art(iconPause, iconPause2x),
  counterPanel: art(counterPanel, counterPanel2x),
  healthFrame: art(healthFrame, healthFrame2x),
  healthFillGreen: art(healthFillGreen, healthFillGreen2x),
  healthFillAmber: art(healthFillAmber, healthFillAmber2x),
  healthFillRed: art(healthFillRed, healthFillRed2x),
  iconHeart: art(iconHeart, iconHeart2x),
  iconScore: art(iconScore, iconScore2x),
  iconTime: art(iconTime, iconTime2x),
};

/** Player health bar art: 256 x 48 logical pixels, fill area from the ui atlas `fill_rect`. */
export const HEALTH_BAR = { width: 256, fill: { x: 30, w: 196 } };

export const MENU_ART = {
  title: art(titlePirateBattle, titlePirateBattle2x),
};

export const TOUCH_ART = {
  iconTurnLeft: art(iconTurnLeft, iconTurnLeft2x),
  iconForward: art(iconForward, iconForward2x),
  iconTurnRight: art(iconTurnRight, iconTurnRight2x),
  iconFireLeft: art(iconFireLeft, iconFireLeft2x),
  iconFireFront: art(iconFireFront, iconFireFront2x),
  iconFireRight: art(iconFireRight, iconFireRight2x),
};
