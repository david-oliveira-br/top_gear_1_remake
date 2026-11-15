/** Tunable handling constants. `SIM` is the original physics (also used by the AI); `ARCADE` is the NFS4-style player preset. */
export interface Handling {
  arcade: boolean;
  /** steering-limit margin (rad) added to the grip-limit angle */
  margin: number;
  /** sim steer rate = (steerBase + steerPoise*poise) * steerRate * (steerOff + lim) */
  steerBase: number; steerPoise: number; steerOff: number;
  /** front cornering stiffness (per unit of w*b/L) and grip kept under braking/driving (cap on the friction-circle loss) */
  frontStiff: number; frontKeepCap: number;
  /** rear grip multiplier = rearBase + rearPoise*poise - balance */
  rearBase: number; rearPoise: number;
  /** auto counter-steer gain on slip angle (0 = none), slip dead zone (rad), min speed (m/s), clamp (rad) */
  counterGain: number; counterDead: number; counterMinV: number; counterClamp: number;
  /** handbrake: rear friction-circle factor for lateral grip, rear longitudinal drag as share of mu*fzR */
  hbLateral: number; hbDrag: number;
  /** stability controller: active above stabMinV, fade-in over stabFade m/s, disabled while the handbrake is held when stabOffHb */
  stabMinV: number; stabFade: number; stabOffHb: boolean;
  /** yaw-rate clamp factor = yawBase + yawDrift*drift, gain (x inertia) */
  yawBase: number; yawDrift: number; yawGain: number;
  /** slide dead zone (rad) = deadBase + deadDrift*drift; slide gain = (gainBase+gainPoise*poise)*(1-drift) + gainDrift*drift */
  deadBase: number; deadDrift: number; gainBase: number; gainPoise: number; gainDrift: number;
  /** off-road grip multiplier and rolling resistance coefficient */
  offGrip: number; offRoll: number;
  /** slip angle (rad) that reads as full slip for the skid sound, front and rear */
  slipFNorm: number; slipRNorm: number;
}

export const SIM: Handling = {
  arcade: false, margin: 0.085,
  steerBase: 3.2, steerPoise: 1.4, steerOff: 0.35,
  frontStiff: 19, frontKeepCap: 0.45,
  rearBase: 1.02, rearPoise: 0.03,
  counterGain: 0, counterDead: 0.04, counterMinV: 8, counterClamp: 0.6,
  hbLateral: 0.5, hbDrag: 0.7,
  stabMinV: 10, stabFade: 10, stabOffHb: true,
  yawBase: 1.25, yawDrift: 0, yawGain: 4,
  deadBase: 0.1, deadDrift: 0, gainBase: 4, gainPoise: 3, gainDrift: 0,
  offGrip: 0.58, offRoll: 0.09,
  slipFNorm: 0.16, slipRNorm: 0.14,
};

export const ARCADE: Handling = {
  arcade: true, margin: 0.07,
  steerBase: 1.6, steerPoise: 1.0, steerOff: 0.2,
  frontStiff: 12, frontKeepCap: 0.6,
  rearBase: 1.08, rearPoise: 0.04,
  counterGain: 0.9, counterDead: 0.04, counterMinV: 3, counterClamp: 0.6,
  hbLateral: 0.5, hbDrag: 0.5,
  stabMinV: 3, stabFade: 6, stabOffHb: false,
  yawBase: 1.05, yawDrift: 3.5, yawGain: 30,
  deadBase: 0.05, deadDrift: 0.32, gainBase: 26, gainPoise: 6, gainDrift: 40,
  offGrip: 0.7, offRoll: 0.06,
  slipFNorm: 0.18, slipRNorm: 0.108,
};
