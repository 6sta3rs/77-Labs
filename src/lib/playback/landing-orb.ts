/** Homepage material and reference shader, loaded only for the ElevenLabs variant. */
export { default as landingGradient } from '../assets/landing-orb/gradient.webp?inline';
export { default as landingFallback } from '../assets/landing-orb/fallback.png?inline';
export { default as landingNoise } from '../assets/landing-orb/noise.png?inline';
export { default as landingOrbFragment } from './landing-orb.frag?raw';
export { LandingFluid } from './landing-fluid';

export const landingOrbUniforms = {
  uCircleSize: 1, uAlpha: 1, uExposure: .15, uContrast: 0, uSaturation: 1,
  uNoiseOpacity: 0, uAnimatedNoise: 0, uNoiseSpeed: .25, uNoiseAmplitude: .15, uNoiseScale: .65,
  uSphereScale: .9, uSpherePower: 1.1, uFluidColor: [1, 1, 1], uFluidColorOpacity: .1,
  uRingColorOpacity: .25, uFbmScale: 3.25, uFbmPower: 2.75, uFbmAmplitude: .65, uFbmSpeed: 4.5,
  uAudioAverageInput: [0, 0, 0, 0], uTextureResolution: [512, 512], uFadeInDuration: 0, uDpr: 1,
};
