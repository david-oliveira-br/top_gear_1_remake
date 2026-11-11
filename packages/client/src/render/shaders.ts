const PROJ = `
uniform vec4 uProj;  // D/aspect, D, yOffset, 0
uniform vec2 uDepth; // A, B
vec4 proj(vec3 p){ return vec4(p.x*uProj.x, p.y*uProj.y + uProj.z*p.z, uDepth.x*p.z + uDepth.y, p.z); }
`;
const NOISE = `
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float hash1(float p){ return fract(sin(p*127.1)*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float noise1(float p){ float i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(hash1(i),hash1(i+1.),f); }
`;

export const ROAD_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aUV;
${PROJ}
out vec3 vUV; out vec3 vCam;
void main(){ vUV=aUV; vCam=aPos; gl_Position=proj(aPos); }`;

export const ROAD_FS = `#version 300 es
precision highp float;
in vec3 vUV; in vec3 vCam; out vec4 o;
uniform vec3 uGrassA,uGrassB,uRoad,uRumA,uRumB,uFog,uAmb,uSkyRef;
uniform float uFogDist,uWet,uHead,uSnowy;
${NOISE}
void main(){
  float u=vUV.x, v=vUV.y, au=abs(u);
  float fw=fwidth(u)*1.2+1e-4;
  float lod=clamp(1.-fwidth(v)*0.9,0.,1.);
  float band=step(0.5,fract(v/6.));
  float gn=noise(vec2(u*5.,v*1.3))*0.6+noise(vec2(u*37.,v*8.))*0.4*lod;
  vec3 ground=mix(uGrassA,uGrassB,band*0.7)*(0.82+0.34*gn);
  float rn=noise(vec2(u*80.,v*18.))*lod+0.5*(1.-lod);
  vec3 road=uRoad*(0.9+0.2*rn)*(1.-0.05*band);
  float wear=exp(-pow((au-0.17)*9.,2.))+exp(-pow((au-0.5)*9.,2.));
  road*=1.-0.07*wear;
  road*=1.-0.16*smoothstep(0.62,0.85,noise(vec2(u*16.,v*0.11)))*wear*lod;
  road=mix(road,vec3(0.93,0.95,1.),uSnowy*0.35*noise(vec2(u*9.,v*2.)));
  float dash=step(0.5,fract(v/8.));
  float lane=(1.-smoothstep(0.011,0.011+fw,abs(au-0.3333)))*dash;
  float edge=1.-smoothstep(0.016,0.016+fw,abs(au-0.93));
  road=mix(road,vec3(0.94),max(lane,edge)*0.92);
  if(v<1.5 && au<0.9){ float ch=mod(floor(u*10.+10.)+floor(v*4.),2.); road=mix(vec3(0.06),vec3(0.96),ch); }
  vec3 rum=mix(uRumA,uRumB,step(0.5,fract(v/4.)));
  float tRoad=1.-smoothstep(1.,1.+fw,au);
  float tRum=1.-smoothstep(1.1,1.1+fw,au);
  vec3 col=mix(ground,rum,tRum);
  col=mix(col,road,tRoad);
  float paved=tRoad;
  if(vUV.z>0.5 && u>1.1){
    float tp=1.-smoothstep(1.95,1.95+fw,u);
    vec3 pit=uRoad*1.18*(0.9+0.2*rn);
    pit=mix(pit,vec3(0.96,0.8,0.12),1.-smoothstep(0.014,0.014+fw,abs(u-1.14)));
    pit=mix(pit,vec3(0.94),1.-smoothstep(0.014,0.014+fw,abs(u-1.92)));
    col=mix(col,pit,tp); paved=max(paved,tp);
  }
  float z=vCam.z;
  float sheen=uWet*paved*(0.18+0.5*smoothstep(0.,22000.,z))*(0.7+0.3*noise(vec2(u*6.,v*0.8)));
  col=mix(col,uSkyRef,sheen);
  float d=z/9500.;
  float lat=abs(vCam.x)/(1700.+z*0.42);
  float hl=uHead*(1.-smoothstep(0.35,1.,d))*(1.-smoothstep(0.55,1.,lat));
  col*=uAmb+vec3(1.,0.95,0.8)*hl*1.15;
  float fog=min(0.8,1.-exp(-pow(z/uFogDist,2.)));
  o=vec4(mix(col,uFog,fog),1.);
}`;

export const SPRITE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV; layout(location=2) in vec4 aCol; layout(location=3) in float aMode;
${PROJ}
out vec2 vUV; out vec4 vCol; out float vMode; out vec3 vCam;
void main(){ vUV=aUV; vCol=aCol; vMode=aMode; vCam=aPos; gl_Position=proj(aPos); }`;

export const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec4 vCol; in float vMode; in vec3 vCam; out vec4 o;
uniform sampler2D uTex,uEmis,uCar,uCarEmis; uniform vec3 uAmb,uFog; uniform float uFogDist,uHead,uNight;
void main(){
  float isCar=step(1.5,vMode);
  vec4 t=mix(texture(uTex,vUV),texture(uCar,vUV),isCar);
  float fog=min(0.8,1.-exp(-pow(vCam.z/uFogDist,2.)));
  if(vMode>0.5&&vMode<1.5){ float a=t.a*vCol.a*(1.-fog*0.8); o=vec4(vCol.rgb*a,0.); return; }
  vec4 em=mix(texture(uEmis,vUV),texture(uCarEmis,vUV),isCar);
  float d=vCam.z/9500.;
  float lat=abs(vCam.x)/(1700.+vCam.z*0.42);
  float hl=uHead*(1.-smoothstep(0.35,1.,d))*(1.-smoothstep(0.55,1.,lat));
  vec3 lit=t.rgb*vCol.rgb*(uAmb+vec3(1.,0.95,0.8)*hl)+em.rgb*uNight*1.5;
  lit=mix(lit,uFog*t.a,fog);
  o=vec4(lit*vCol.a,t.a*vCol.a);
  if(o.a<0.004) discard;
}`;

export const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.,1.); }`;

export const SKY_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec4 uRect,uPano; uniform vec3 uTop,uHor,uSunCol,uGround,uSkyAmb,uCloudCol;
uniform sampler2D uFar,uNear,uLightTex;
uniform vec2 uSun; uniform float uStars,uOff,uHorizon,uCloud,uTime,uAurora,uLights,uFlash,uLightLayer;
${NOISE}
float fbm1(float x){ return noise1(x)*0.55+noise1(x*2.3+7.)*0.28+noise1(x*5.1+3.)*0.17; }
float fbm(vec2 p){ return noise(p)*0.5+noise(p*2.1+5.)*0.3+noise(p*4.3+9.)*0.2; }
void main(){
  vec2 uv=(gl_FragCoord.xy-uRect.xy)/uRect.zw; float asp=uRect.z/uRect.w;
  float y=(uv.y-uHorizon)/(1.-uHorizon);
  vec3 col;
  if(y<0.){ col=uGround; }
  else{
    float x=(uv.x-0.5)*asp;
    col=mix(uHor,uTop,pow(clamp(y,0.,1.),0.55));
    vec2 sp=vec2(x+uOff*0.04,y)*70.; vec2 id=floor(sp);
    col+=uStars*step(0.975,hash(id))*smoothstep(0.4,0.,length(fract(sp)-0.5))*(0.6+0.4*sin(uTime*3.+hash(id)*40.));
    float sx=(uSun.x-0.5)*asp-sin(uOff*0.25)*0.35;
    float d=length(vec2(x-sx,(y-uSun.y)*(1.-uHorizon)));
    col+=uSunCol*(smoothstep(0.07,0.062,d)+0.4*exp(-d*5.));
    float au=uAurora*smoothstep(0.15,0.5,y)*exp(-abs(y-0.6)*4.)*(0.5+0.5*sin((x+uOff*0.03)*5.+sin(y*9.+uTime*0.35)*1.6));
    col+=vec3(0.1,0.95,0.5)*au*0.7+vec3(0.5,0.1,0.8)*au*au*0.3;
    float c=fbm(vec2(x*1.4+uOff*0.07+uTime*0.008,y*5.));
    float cl=smoothstep(1.-uCloud,1.15-uCloud*0.8,c+0.25*(1.-y));
    col=mix(col,uCloudCol,cl*0.85);
    vec2 fu=vec2((x+uOff*0.12)/uPano.x,1.-y/uPano.y);
    vec4 ft=texture(uFar,vec2(fu.x,max(fu.y,0.002)))*step(0.,fu.y);
    vec3 fc=mix(ft.rgb*uSkyAmb,uHor*ft.a,0.4)+uLights*texture(uLightTex,vec2(fu.x,max(fu.y,0.002))).rgb*step(0.,fu.y)*(1.-uLightLayer)*0.9;
    col=col*(1.-ft.a)+fc;
    vec2 nu=vec2((x+uOff*0.26)/uPano.z,1.-y/uPano.w);
    vec4 nt=texture(uNear,vec2(nu.x,max(nu.y,0.002)))*step(0.,nu.y);
    vec3 nc=mix(nt.rgb*uSkyAmb,uHor*nt.a,0.14)+uLights*texture(uLightTex,vec2(nu.x,max(nu.y,0.002))).rgb*step(0.,nu.y)*uLightLayer;
    col=col*(1.-nt.a)+nc;
    col=mix(col,vec3(0.8,0.85,1.),uFlash*0.45*step(0.,y));
  }
  o=vec4(col,1.);
}`;

export const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o; uniform sampler2D uTex; uniform vec2 uTexel;
void main(){
  vec3 c=texture(uTex,vUv+uTexel*vec2(-1,-1)).rgb+texture(uTex,vUv+uTexel*vec2(1,-1)).rgb+texture(uTex,vUv+uTexel*vec2(-1,1)).rgb+texture(uTex,vUv+uTexel*vec2(1,1)).rgb;
  c*=0.25; float l=max(c.r,max(c.g,c.b));
  o=vec4(c*smoothstep(0.72,1.,l),1.);
}`;

export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o; uniform sampler2D uTex; uniform vec2 uDir;
void main(){
  vec3 c=texture(uTex,vUv).rgb*0.227;
  c+=(texture(uTex,vUv+uDir*1.385).rgb+texture(uTex,vUv-uDir*1.385).rgb)*0.316;
  c+=(texture(uTex,vUv+uDir*3.231).rgb+texture(uTex,vUv-uDir*3.231).rgb)*0.07;
  o=vec4(c,1.);
}`;

export const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene,uBloom; uniform vec2 uRes,uBlur;
uniform float uTime,uRain,uSnow,uCrt,uBloomAmt,uFlash,uViews;
${NOISE}
float rain(vec2 uv,float l){
  vec2 p=uv*vec2(uRes.x/uRes.y,1.); p.x+=p.y*0.14; p.x*=50.+28.*l;
  float id=floor(p.x), h=hash1(id+l*31.);
  float y=fract(p.y*(1.1+0.6*l)+uTime*(2.4+1.6*h)+h*7.);
  float len=0.1+0.1*h;
  return smoothstep(len,0.,y)*smoothstep(0.14,0.,abs(fract(p.x)-0.5))*step(0.5,h);
}
float snow(vec2 uv,float l){
  vec2 p=uv*vec2(uRes.x/uRes.y,1.)*(12.+9.*l); p.y+=uTime*(1.4+l); p.x+=sin(uTime*0.7+p.y*0.5)*0.35+uTime*0.3;
  vec2 id=floor(p), f=fract(p)-0.5;
  vec2 off=(vec2(hash(id),hash(id+7.3))-0.5)*0.6;
  return smoothstep(0.1,0.02,length(f-off))*step(0.45,hash(id+3.1));
}
void main(){
  vec2 uv=vUv;
  float top=step(0.5,uv.y);
  vec2 c=uViews>1.5?vec2(0.5,top>0.5?0.79:0.29):vec2(0.5,0.58);
  float blur=(uViews>1.5&&top<0.5)?uBlur.y:uBlur.x;
  vec2 d=uv-c; float r2=dot(d,d)*(uViews>1.5?8.:4.);
  vec3 col=vec3(0.);
  for(int i=0;i<8;i++){ float s=1.-blur*0.005*float(i)*r2; col+=texture(uScene,c+d*s).rgb; }
  col/=8.;
  col+=texture(uBloom,uv).rgb*uBloomAmt;
  if(uRain>0.){ float r=rain(uv,0.)+rain(uv*1.3+3.,1.)*0.7+rain(uv*1.7+9.,2.)*0.5; col=mix(col,vec3(0.78,0.84,0.95),clamp(r,0.,1.)*0.3*uRain); }
  if(uSnow>0.){ float s=snow(uv,0.)+snow(uv+5.,1.)*0.8+snow(uv+11.,2.)*0.6; col=mix(col,vec3(1.),clamp(s,0.,1.)*0.8*uSnow); }
  col*=1.+uFlash*0.9;
  col=mix(vec3(dot(col,vec3(0.299,0.587,0.114))),col,1.1);
  vec2 q=uv-0.5; col*=1.-0.42*pow(length(q*vec2(1.15,1.))*1.25,2.6);
  if(uCrt>0.){ col*=1.-0.22*uCrt*(0.5+0.5*sin(gl_FragCoord.y*3.14159)); col*=1.+0.04*uCrt*sin(gl_FragCoord.x*2.094); }
  o=vec4(col,1.);
}`;
