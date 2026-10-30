// Folia EQ 写入：走官方 `folium.equalizer`（Folium 1.7 起）。
//
// 这个文件替代了原来那套「全局扫 React fiber → 找 settings store 的 setter → 直接改
// customSlots 和 enabled」的做法。那套做法有三个问题，官方在 #819 里明确指出来了：
//
//   1. 写用户的自定义槽：模组按歌自动切换，会把用户自己调好的「自定义 1/2」反复覆盖；
//   2. 顺手把 enabled 设成 true：总开关同时管 EQ 和效果链，模组打开它会带出用户
//      没打算听的效果；
//   3. 依赖 React 内部结构（fiber 链、useSyncExternalStore 的 memoizedState），
//      Folia 一升级就可能失效，而且是静默失效。
//
// 官方接口把这三件事都解决了：
//   · applyCurve() 把曲线作为独立一层放上去，不碰用户的槽，不影响总开关；
//   · 曲线单独存储、重启后保留；用户在音频效果器面板里能一键换回自己的；
//   · 面板开着时写入被拒绝（panel-open），用户始终优先。
//
// 约束（照文档做，别自作主张）：
//   · 频率范围 ±12 dB、精度 0.1 dB，超出的会被夹取，不必自己处理；
//   · 十个频段，第一段 31 Hz（不是 31.5），首尾分别是 lowshelf / highshelf；
//   · 每秒最多 1 次、每分钟最多 20 次「有变化的写入」，所以要写「最终结果」而不是
//     逐帧动画；
//   · 收到 equalizer.changed 且 origin 不是自己/宿主时，要让步，不要抢回来。

/** 官方接口的能力探测：宿主 Folium 版本 ≥ 1.7 且有 equalizer 服务。 */
export function hasOfficialEqualizer(folium) {
  try {
    return Boolean(
      folium &&
      folium.host &&
      folium.host.folium &&
      Number(folium.host.folium.minor) >= 7 &&
      folium.equalizer,
    );
  } catch {
    return false;
  }
}

/**
 * 读当前 EQ 状态。
 * @returns {{ok: true, state: any} | {ok: false, reason: string}}
 */
export function readEqState(folium) {
  if (!hasOfficialEqualizer(folium)) return { ok: false, reason: 'equalizer-unavailable' };
  try {
    return { ok: true, state: folium.equalizer.getState() };
  } catch (error) {
    return { ok: false, reason: 'getState-threw', error: String(error && error.message || error) };
  }
}

/**
 * 把我方曲线放上去。
 *
 * 写入失败不抛错，返回 `{ ok: false, reason }`；只有参数错误 / 没权限 / 在导出窗口里
 * 才会抛。这里一律接住，交给调用方决定要不要重试。
 *
 * @param {number[]} gains 十个频段的增益（dB），从低频开始
 * @returns {{ok: true, state: any} | {ok: false, reason: string}}
 */
export function applyEqCurve(folium, gains) {
  if (!hasOfficialEqualizer(folium)) return { ok: false, reason: 'equalizer-unavailable' };
  if (!Array.isArray(gains)) return { ok: false, reason: 'invalid-arguments' };

  const state = readEqState(folium);
  if (!state.ok) return state;

  const bandCount = state.state.bands.length;
  if (gains.length !== bandCount) {
    // 长度不符是自己算错了，不是宿主的问题 —— 明确报出来，别让宿主兜底成「缺的读 0」。
    return { ok: false, reason: `band-count-mismatch:${gains.length}/${bandCount}` };
  }

  try {
    const result = folium.equalizer.applyCurve(gains);
    if (result && result.ok) return { ok: true, state: result.state };
    return { ok: false, reason: (result && result.reason) || 'unknown-refusal' };
  } catch (error) {
    return { ok: false, reason: 'applyCurve-threw', error: String(error && error.message || error) };
  }
}

/** 撤下我方曲线，回到用户自己的音效。 */
export function releaseEqCurve(folium) {
  if (!hasOfficialEqualizer(folium)) return { ok: false, reason: 'equalizer-unavailable' };
  try {
    return { ok: true, wasApplied: folium.equalizer.releaseCurve() };
  } catch (error) {
    return { ok: false, reason: 'releaseCurve-threw', error: String(error && error.message || error) };
  }
}

/**
 * 判断当前播放的是不是「我方的曲线」。
 * 不是的话说明用户切走了（或者别的模组接管了），按文档要求应当让步、不要再抢回来。
 */
export function isOurCurveInPlace(folium, modId) {
  const state = readEqState(folium);
  if (!state.ok) return false;
  const mode = state.state.mode;
  return Boolean(mode && mode.kind === 'mod' && mode.modId === modId);
}

/**
 * 把一个目标曲线写进去，带必要的克制：
 *   · 曲线已经就是它 —— 不写（不占配额）；
 *   · 我方曲线已不在位（用户换走了）—— 不写，让步；
 *   · 被 rate-limited / panel-open 拒绝 —— 返回失败让调用方稍后再说，不在这里循环重试。
 *
 * @param {number[]} gains
 * @param {{modId: string, force?: boolean}} options
 */
export function syncEqCurve(folium, gains, { modId, force = false }) {
  const state = readEqState(folium);
  if (!state.ok) return state;

  const current = state.state.gains;
  const same = Array.isArray(current)
    && current.length === gains.length
    && current.every((value, index) => Math.abs(value - gains[index]) < 0.05);
  if (same) return { ok: true, skipped: 'unchanged' };

  if (!force && !isOurCurveInPlace(folium, modId)) {
    // 用户（或别的模组）已经改了音效 —— 文档要求此时让步。
    return { ok: false, reason: 'yielded-to-user' };
  }

  if (!state.state.writable) return { ok: false, reason: 'panel-open' };
  if (!state.state.enabled) {
    // 总开关关着时写入会被保存但听不到。仍然写（下次打开就能听到），但让调用方知道。
    const result = applyEqCurve(folium, gains);
    return result.ok ? { ...result, note: 'processing-disabled' } : result;
  }
  return applyEqCurve(folium, gains);
}
