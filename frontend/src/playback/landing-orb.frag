// Adapted from the ElevenLabs homepage fragment captured on 2026-10-20.
// Source, pinned digest and transformations: docs/features/orb-flow.md.
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying vec2 uv;
#define vUv vec2(1.0 - uv.x, uv.y)

uniform float time;
#define uTime (time * 1.4)
uniform float uCircleSize;
uniform float uAlpha;
uniform vec4 uAudioAverage;
uniform vec4 uAudioAverageInput;
uniform vec4 uCumulativeAudio;

// Settings demo only. Zero keeps the original source material unchanged.
uniform float previewPalette;
uniform float textureReady;
uniform vec3 darkColor, midColor, lightColor;

uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uNoiseOpacity;
uniform int uNoiseBlendMode;
uniform float uAnimatedNoise;

uniform float uNoiseSpeed;
uniform float uNoiseAmplitude;
uniform float uNoiseScale;

uniform float uSphereScale;
uniform float uSpherePower;

uniform vec3 uFluidColor;
uniform int uFluidBlendMode;
uniform float uFluidColorOpacity;
uniform float uRingColorOpacity;

uniform float uFbmScale;
uniform float uFbmPower;
uniform float uFbmAmplitude;
uniform float uFbmSpeed;

uniform sampler2D gradientTexture;
#define uTexture gradientTexture
uniform sampler2D uFluidSimTexture;

uniform float uFadeInDuration;

uniform float uCornerRadius;
uniform vec2 resolution;
#define uResolution resolution
uniform float uDpr;
uniform vec2 uTextureResolution;

vec4 outColor;

// ============================================
// COVER UV CALCULATION (like CSS background-size: cover)
// ============================================
vec2 getCoverUv(vec2 textureUv, vec2 containerRes, vec2 textureRes) {
    float containerAspect = containerRes.x / containerRes.y;
    float textureAspect = textureRes.x / textureRes.y;

    vec2 scale = vec2(1.0);

    if (containerAspect > textureAspect) {
        // Container is wider - fit width, crop height (shrink Y range)
        scale.y = textureAspect / containerAspect;
    } else {
        // Container is taller - fit height, crop width (shrink X range)
        scale.x = containerAspect / textureAspect;
    }

    // Scale from center (scale < 1 zooms in / crops)
    vec2 coverUv = (textureUv - 0.5) * scale + 0.5;
    return coverUv;
}

// ============================================
// ROUNDED RECTANGLE SDF
// ============================================
float sdRoundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// ============================================
// NOISE FUNCTIONS
// ============================================
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ============================================
// COLOR CORRECTION FUNCTIONS
// ============================================
vec3 contrast(vec3 color, float value) {
    return clamp(0.5 + (1.0 + value) * (color - 0.5), vec3(0.0), vec3(1.0));
}

vec3 exposure(vec3 color, float value) {
    return (1.0 + value) * color;
}

vec3 czm_saturation(vec3 rgb, float adjustment) {
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    vec3 intensity = vec3(dot(rgb, W));
    return mix(intensity, rgb, adjustment);
}

// ============================================
// BLEND MODE FUNCTIONS (simplified set)
// ============================================

vec3 blendMultiply_19_17(vec3 base, vec3 blend) {
	return base*blend;
}

vec3 blendMultiply_19_17(vec3 base, vec3 blend, float opacity) {
	return (blendMultiply_19_17(base, blend) * opacity + base * (1.0 - opacity));
}

float blendOverlay_9_12(float base, float blend) {
	return base<0.5?(2.0*base*blend):(1.0-2.0*(1.0-base)*(1.0-blend));
}

vec3 blendOverlay_9_12(vec3 base, vec3 blend) {
	return vec3(blendOverlay_9_12(base.r,blend.r),blendOverlay_9_12(base.g,blend.g),blendOverlay_9_12(base.b,blend.b));
}

vec3 blendOverlay_9_12(vec3 base, vec3 blend, float opacity) {
	return (blendOverlay_9_12(base, blend) * opacity + base * (1.0 - opacity));
}

vec3 blendHardLight_7_13(vec3 base, vec3 blend) {
	return blendOverlay_9_12(blend,base);
}

vec3 blendHardLight_7_13(vec3 base, vec3 blend, float opacity) {
	return (blendHardLight_7_13(base, blend) * opacity + base * (1.0 - opacity));
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
float random(in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(2127.1, 81.17)), dot(p, vec2(1269.5, 283.37)));
    return fract(sin(p) * 43758.5453);
}

float filmGrainNoise(in vec2 textureUv) {
    return length(hash(vec2(textureUv.x, textureUv.y)));
}

float noise(in vec2 _st) {
    vec2 i = floor(_st);
    vec2 f = fract(_st);

    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) +
            (c - a) * u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y;
}

#define NUM_OCTAVES 4
float fbm(in vec2 _st) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < NUM_OCTAVES; ++i) {
        v += a * noise(_st);
        _st = rot * _st * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

// ============================================
// MAIN
// ============================================
void main() {
    vec3 color = vec3(vUv, 0.);
    float circleSize = uCircleSize - pow(uAudioAverageInput.x * .75, 3.) * .2;  // Range  [0.0, 1.0]
    vec2 textureUv = vec2(1. - vUv.x, vUv.y);

    vec3 fluid = texture2D(uFluidSimTexture, vUv).rgb;


    // Sphere UV
    float sphereScale = uSphereScale; //+ (pow(uAudioAverage.y * .75, 2.) * .5); // 1.5;
    float spherePower = uSpherePower; // .15
    vec2 uvDot = ((textureUv - 0.5) * 2.);

    float d = sqrt(1.-clamp(dot(uvDot, uvDot), 0., 1.));
    d = pow(d, spherePower);
    vec3 normals = vec3(uvDot, d); // Keep for later


    vec2 uv_scale = 1./vec2(sphereScale);
    uvDot /= (vec2(d, d) + vec2(1.,1.)) * uv_scale;
    uvDot = (uvDot +1.) * 0.5;

    textureUv = uvDot;

    // FBM
    float fbmScale = uFbmScale;
    float fbmPower = uFbmPower;
    float fbmAmplitude = uFbmAmplitude;
    float fbmTime1 = uTime * uFbmSpeed;
    float fbmTime2 = uTime * (uFbmSpeed * .5) + uCumulativeAudio.x * .25;

    vec2 fbmUv = textureUv * fbmScale;
    vec2 q = vec2(0.);
    q.x = fbm( fbmUv + 0.00 * fbmTime1);
    q.y = fbm( fbmUv + vec2(1.0));
    vec2 r = vec2(0.);
    r.x = fbm( fbmUv + 1.0 * q + vec2(91.3, .55) + 0.15 * fbmTime2 );
    r.y = fbm( fbmUv + 1.0 * q - vec2(45.33, 1.2) + 0.126 * fbmTime2);

    float f = fbm(fbmUv+r);
    float ffbm = mix(0.8, 0.66, clamp((f*f)*fbmPower,0.0,1.0));
    ffbm = mix(ffbm, 0., clamp(length(q),0.0,1.0));
    ffbm = mix(ffbm, 1., clamp(length(r.x),0.0,1.0));

    // Simplex Noise
    float noiseTime1 = uTime * uNoiseSpeed * .5 + uCumulativeAudio.z * .1;
    float noiseX = snoise(vec3(vUv * uNoiseScale, noiseTime1));
    float noiseTime2 = uTime * uNoiseSpeed;
    float noiseY = snoise(vec3(vUv * uNoiseScale + vec2(54., 54.), noiseTime2));
    vec2 noiseDisp = vec2(noiseX, noiseY);
    noiseDisp *= 1. + uAudioAverage.z * .25;


    // Compute circle shape and alpha mask
    vec2 circleUv = (vUv)-.5;
    float dist = sqrt(dot(circleUv, circleUv));
    // Cut alpha outside the circle in-shader — Firefox doesn't reliably apply
    // the ancestor's rounded clip to the composited canvas. Interior stays
    // opaque, so clipping browsers are pixel-identical.
    float circleAA = max(fwidth(dist * 2.), 1e-4);
    float s = 1.0 - smoothstep(1.0, 1.0 + circleAA, dist * 2.);

    if (previewPalette > .5 && textureReady < .5) {
        float previewFade = uFadeInDuration > 0.0 ? min(uTime / uFadeInDuration, 1.) : 1.;
        gl_FragColor = vec4(clamp(midColor, 0.0, 1.0), s * uAlpha * previewFade);
        return;
    }

    // Pulse
    float pTime = uTime * .2 + uCumulativeAudio.z * .4;
    float pDist = mod(dist * 2. - pTime, 1.);
    float pulse = smoothstep(0., .75, pDist) - smoothstep(.75, 1., pDist);
    pulse = pow(pulse, 2.);
    pulse *= uAudioAverage.y;


    // Uv shift
    textureUv += -fluid.rg * 0.001;
    textureUv += normals.xy * (ffbm - .5) * fbmAmplitude;
    textureUv += noiseDisp * uNoiseAmplitude;

    // Gradient sampling with cover strategy
    vec2 coverUv = getCoverUv(textureUv, uResolution, uTextureResolution);
    vec3 gradient = texture2D(uTexture, coverUv).rgb;

    // Ring Constants
    vec3 color1 = vec3(1.);
    vec3 color2 = vec3(0.);
    float innerRadius = 0.25;
    float noiseScale = 0.65 + uAudioAverage.x * .4;

    // Ring
    vec2 ringUv = (vUv - .5) * 2. * (1./uCircleSize);
    ringUv *= .75;
    float ang = atan(ringUv.y, ringUv.x);
    float len = length(ringUv);
    float v2, v3, cl;
    float r0, n0;

    float ringTime = (-uTime * .5) - uCumulativeAudio.a * .2;
    ringUv.x += 1. + uAudioAverage.y * 1.5 - uAudioAverageInput.y * 2.5;

    n0 = snoise( vec3(ringUv * noiseScale, ringTime * 0.5) ) * 0.5 + 0.5;
    r0 = mix(mix(innerRadius, 1.0, 0.75), mix(innerRadius, 1.0, 0.2), n0);
    cl = cos(ang + ringTime * 2.0) * 0.5 + 0.5;

    // high light
    float a = -ringTime * 1.0;
    vec2 pos = vec2(cos(a), sin(a)) * r0;
    v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    v3 = pow(smoothstep(innerRadius, mix(innerRadius, 1.0, n0 * 0.75), len), 2.);
    cl = cl * v2 * v3;
    cl = clamp(pow(cl * min(uAudioAverage.a * 4. + uAudioAverageInput.x * 4., 1.), 3.), 0., 1.);

    // Compositing
    color = gradient + (vec3(cl) * uRingColorOpacity);
    color = blendHardLight_7_13(color, uFluidColor, length(fluid) * .01 * uFluidColorOpacity);

    // Color correction
    color = blendMultiply_19_17(color, vec3(filmGrainNoise(vUv + mod(uTime, 1.) * uAnimatedNoise)), uNoiseOpacity);
    color = czm_saturation(color, uSaturation);
    color = contrast(color, uContrast);
    color = exposure(color, uExposure);

    // alpha
    float fadeIn = uFadeInDuration > 0.0 ? min(uTime / uFadeInDuration, 1.) : 1.;
    outColor.a = s * uAlpha * fadeIn;

    // Clamp color to valid range before premultiplying
    // (exposure can push values > 1.0 which causes over-saturation during fade)
    color = clamp(color, 0.0, 1.0);

    if (previewPalette > .5) {
        // Use the finished material's brightness as the palette coordinate, so
        // its moving folds, shadow and specular band survive recoloring.
        const vec3 luminanceWeights = vec3(0.2126, 0.7152, 0.0722);
        float brightness = dot(color, luminanceWeights);
        vec3 mapped = mix(darkColor, midColor, smoothstep(0.0, 0.5, brightness));
        mapped = mix(mapped, lightColor, smoothstep(0.5, 1.0, brightness));
        float mappedBrightness = dot(mapped, luminanceWeights);
        // Preserve source brightness without clipping saturated channels:
        // darken toward black, or brighten toward a neutral white reflection.
        if (brightness < mappedBrightness) {
            mapped *= brightness / max(mappedBrightness, 0.0001);
        } else {
            mapped = mix(mapped, vec3(1.0),
                (brightness - mappedBrightness) / max(1.0 - mappedBrightness, 0.0001));
        }
        color = clamp(mapped, 0.0, 1.0);
    }

    // Set color
    gl_FragColor = vec4(color, outColor.a);


}
