// 跨页面共享：stageLayer 每帧把宿主频谱/频段写进来，UI 读。

export const shared = {
  /** @type {any} */ bands: null,
  power: 0,
  at: 0,
};

/** @param {any} b @param {number} p */
export function feed(b, p) {
  if (b) shared.bands = b;
  if (typeof p === 'number' && Number.isFinite(p)) shared.power = p;
  shared.at = Date.now();
}

export function alive() {
  return Date.now() - shared.at < 1500;
}

export function reset() {
  shared.bands = null;
  shared.power = 0;
  shared.at = 0;
}
