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
  vec3 ground=mix(uGrassA,uGrassB,band*0.7)*(0.78+0.4*gn);
  float tuft=smoothstep(0.72,0.9,noise(vec2(u*11.,v*2.6)))*lod;
  ground*=1.-0.3*tuft; ground*=1.+0.22*smoothstep(0.8,0.95,noise(vec2(u*23.+9.,v*3.7)))*lod;
  float rn=noise(vec2(u*80.,v*18.))*lod+0.5*(1.-lod);
  vec3 road=uRoad*(0.9+0.2*rn)*(1.-0.05*band);
  float wear=exp(-pow((au-0.17)*9.,2.))+exp(-pow((au-0.5)*9.,2.));
  road*=1.-0.07*wear;
  road*=1.-0.1*lod*smoothstep(0.06,0.,abs(fract(v/3.)-0.5)-0.44);
  road*=1.-0.12*lod*smoothstep(0.55,0.8,noise(vec2(u*3.+4.,v*0.9)));
  road*=1.-0.16*smoothstep(0.62,0.85,noise(vec2(u*16.,v*0.11)))*wear*lod;
  road=mix(road,vec3(0.93,0.95,1.),uSnowy*0.35*noise(vec2(u*9.,v*2.)));
  float dash=mix(0.5,step(0.5,fract(v/6.)),lod);
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
uniform sampler2D uTex,uEmis; uniform vec3 uAmb,uFog; uniform float uFogDist,uHead,uNight;
void main(){
  vec4 t=texture(uTex,vUV);
  float fog=min(0.8,1.-exp(-pow(vCam.z/uFogDist,2.)));
  if(vMode>0.5&&vMode<1.5){ float a=t.a*vCol.a*(1.-fog*0.8); o=vec4(vCol.rgb*a,0.); return; }
  vec4 em=texture(uEmis,vUV);
  float d=vCam.z/9500.;
  float lat=abs(vCam.x)/(1700.+vCam.z*0.42);
  float hl=uHead*(1.-smoothstep(0.35,1.,d))*(1.-smoothstep(0.55,1.,lat));
  vec3 lit=t.rgb*vCol.rgb*(uAmb+vec3(1.,0.95,0.8)*hl)+em.rgb*uNight*1.5;
  lit=mix(lit,uFog*t.a,fog);
  o=vec4(lit*vCol.a,t.a*vCol.a);
  if(o.a<0.004) discard;
}`;

export const CAR_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aN; layout(location=2) in float aMat;
${PROJ}
uniform vec3 uPos; uniform vec4 uRot,uAxle; uniform float uScale; // uRot: cos/sin yaw, cos/sin pitch
out vec3 vN,vCam,vL; out float vMat;
vec3 turn(vec3 p){ p=vec3(p.x,p.y*uRot.z+p.z*uRot.w,-p.y*uRot.w+p.z*uRot.z); return vec3(p.x*uRot.x+p.z*uRot.y,p.y,-p.x*uRot.y+p.z*uRot.x); }
void main(){
  vec3 p=aPos,n=aN;
  if(aMat>15.5&&aMat<60.){ float cz=aMat>31.5?uAxle.z:uAxle.y, c=cos(uAxle.w), s=sin(uAxle.w);
    vec2 q=vec2(p.y-uAxle.x,p.z-cz); p.y=uAxle.x+q.x*c-q.y*s; p.z=cz+q.x*s+q.y*c; n=vec3(n.x,n.y*c-n.z*s,n.y*s+n.z*c); }
  vL=aPos; vMat=aMat; vN=turn(n); vCam=turn(p)*uScale+uPos; gl_Position=proj(vCam);
}`;

export const CAR_FS = `#version 300 es
precision highp float;
in vec3 vN,vCam,vL; in float vMat; out vec4 o;
uniform vec3 uColor,uAmb,uFog,uTop,uHor,uSunCol,uGround,uSunDir;
uniform float uFogDist,uNight,uBrake,uHead,uSpinBlur,uShadow;
vec3 env(vec3 r){
  float y=r.y;
  vec3 c=y>0.?mix(uHor,uTop,smoothstep(0.,0.8,y)):mix(uGround*0.8,uGround*0.2,smoothstep(0.,-0.6,y));
  return c+uSunCol*1.3*smoothstep(0.9,0.985,dot(r,uSunDir));
}
void main(){
  int m=int(mod(vMat+0.5,16.));
  float fog=min(0.8,1.-exp(-pow(vCam.z/uFogDist,2.)));
  if(vMat>60.){ float sh=uShadow*smoothstep(1.,0.3,length(vec2(vL.x/1.12,vL.z/2.5))); o=vec4(0.,0.,0.,sh*(1.-fog)); return; }
  vec3 N=normalize(vN), V=normalize(-vCam), L=normalize(vec3(-0.4,0.8,-0.45)), H=normalize(L+V), R=reflect(-V,N);
  float day=1.-0.75*uNight;
  float ndl=max(dot(N,L),0.), fres=0.05+0.95*pow(1.-max(dot(N,V),0.),5.), spec=pow(max(dot(N,H),0.),120.)*day;
  float d=vCam.z/9500., lat=abs(vCam.x)/(1700.+vCam.z*0.42);
  float hl=uHead*(1.-smoothstep(0.35,1.,d))*(1.-smoothstep(0.55,1.,lat))*max(-N.z,0.)*0.45;
  vec3 light=uAmb*(1.+0.4*uNight)*(0.42+0.26*(N.y*0.5+0.5)+0.5*ndl)+vec3(1.,0.95,0.8)*hl;
  float ao=0.7+0.3*smoothstep(0.08,0.5,vL.y);
  vec3 e=env(R), col, em=vec3(0.);
  if(m==0) col=(uColor*light+e*uColor*0.12)*ao+e*fres*0.75+spec*uSunCol;
  else if(m==1) col=vec3(0.02,0.03,0.045)*light+e*(0.1+fres*0.85)+spec*0.7;
  else if(m==2) col=vec3(0.035)*light;
  else if(m==3) col=vec3(0.5,0.52,0.56)*light*0.8+e*0.5+spec;
  else if(m==4) col=vec3(0.055)*light+e*fres*0.1;
  else if(m==5){ col=vec3(0.62,0.04,0.03)*light+e*fres*0.3; em=vec3(1.,0.13,0.07)*(uNight*0.75+uBrake*1.25); }
  else if(m==6){ col=vec3(0.9,0.88,0.8)*light; em=vec3(1.,0.95,0.8)*uNight; }
  else if(m==7) col=vec3(0.85)*light;
  else col=vec3(0.012);
  if(vMat>15.5) col=mix(col,vec3(0.16)*light,uSpinBlur*0.65);
  o=vec4(mix(col,uFog,fog)+em*(1.-fog*0.6),1.);
}`;

export const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.,1.); }`;

export const SKY_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec4 uRect,uPano,uFx; // uFx: birds, balloons, searchlights, sea
uniform vec3 uTop,uHor,uSunCol,uGround,uSkyAmb,uCloudCol;
uniform sampler2D uFar,uNear,uLightTex;
uniform vec2 uSun; uniform float uStars,uOff,uHorizon,uCloud,uTime,uAurora,uLights,uFlash,uLightLayer;
${NOISE}
float fbm(vec2 p){ return noise(p)*0.5+noise(p*2.1+5.)*0.3+noise(p*4.3+9.)*0.2; }
vec3 lightsAt(vec2 u){ float h=hash(floor(u*vec2(900.,110.))); return texture(uLightTex,vec2(u.x,max(u.y,0.002))).rgb*step(0.,u.y)*(0.72+0.28*sin(uTime*(1.+3.*h)+h*40.)); }
void main(){
  vec2 uv=(gl_FragCoord.xy-uRect.xy)/uRect.zw; float asp=uRect.z/uRect.w;
  float y=(uv.y-uHorizon)/(1.-uHorizon);
  vec3 col;
  if(y<0.){ col=uGround; }
  else{
    float x=(uv.x-0.5)*asp, dayK=1.-uLights;
    col=mix(uHor,uTop,pow(clamp(y,0.,1.),0.55));
    vec2 sp=vec2(x+uOff*0.04,y)*70.; vec2 id=floor(sp);
    col+=uStars*step(0.975,hash(id))*smoothstep(0.4,0.,length(fract(sp)-0.5))*(0.6+0.4*sin(uTime*3.+hash(id)*40.));
    { // shooting star
      float T=uTime/6., si=floor(T), ph=fract(T)*7.;
      vec2 dir=normalize(vec2(-0.8,-0.38)), head=vec2((hash1(si)-0.3)*asp*0.8,0.55+0.4*hash1(si+3.))+dir*ph*0.9, q=vec2(x,y)-head;
      float al=dot(q,-dir), pe=abs(q.x*dir.y-q.y*dir.x);
      col+=uStars*step(ph,1.)*smoothstep(0.004,0.,pe)*smoothstep(0.22,0.,al)*step(0.,al)*(1.-ph);
    }
    float sx=(uSun.x-0.5)*asp-sin(uOff*0.25)*0.35;
    vec2 sd=vec2(x-sx,(y-uSun.y)*(1.-uHorizon)); float d=length(sd);
    float rays=pow(noise1(atan(sd.y,sd.x)*7.+uTime*0.05),3.)*exp(-d*3.2)*(0.12+0.4*uLights)*(1.-uStars);
    col+=uSunCol*(smoothstep(0.07,0.062,d)+0.4*exp(-d*5.)+rays);
    float au=uAurora*smoothstep(0.15,0.5,y)*exp(-abs(y-0.6)*4.)*(0.5+0.5*sin((x+uOff*0.03)*5.+sin(y*9.+uTime*0.35)*1.6));
    col+=vec3(0.1,0.95,0.5)*au*0.7+vec3(0.5,0.1,0.8)*au*au*0.3;
    float hi=fbm(vec2(x*0.6+uOff*0.05+uTime*0.035,y*11.+3.));
    col=mix(col,uCloudCol,smoothstep(0.6,0.9,hi)*0.2*smoothstep(0.25,0.6,y));
    float c=fbm(vec2(x*1.4+uOff*0.09+uTime*0.018,y*5.));
    float cl=smoothstep(1.-uCloud,1.15-uCloud*0.8,c+0.25*(1.-y));
    col=mix(col,uCloudCol,cl*0.72);
    col+=vec3(0.7,0.8,1.)*uFlash*exp(-abs(x-(hash1(floor(uTime*1.3))-0.5)*asp)*2.2)*(0.3+cl)*0.7;
    { // aircraft: contrail by day, blinking light at night
      float px=fract(uTime*0.006+0.2)*3.4-1.7-uOff*0.03, py=0.74+0.03*sin(uTime*0.05), dx=px-x;
      float trail=step(0.,dx)*exp(-dx*3.5)*smoothstep(0.006+dx*0.012,0.,abs(y-py));
      col=mix(col,vec3(1.),trail*0.7*dayK*(1.-cl));
      col+=vec3(1.,0.25,0.2)*uLights*smoothstep(0.006,0.,length(vec2(dx,y-py)))*step(0.5,fract(uTime*1.2));
    }
    if(uFx.y>0.) for(int i=0;i<3;i++){ // hot-air balloons
      float fi=float(i);
      vec2 bp=vec2(mod(fi*1.07+0.5-uOff*0.16+uTime*0.004,3.4)-1.7,0.36+0.13*fi+0.012*sin(uTime*0.5+fi*2.));
      vec2 q=(vec2(x,y)-bp)/(0.05-0.008*fi);
      float body=step(length(vec2(q.x,(q.y-0.25)*(q.y<0.25?0.72:1.))),1.);
      float basket=step(abs(q.x),0.16)*step(abs(q.y+1.35),0.12);
      vec3 bc=mix(vec3(0.9,0.25,0.2),mix(vec3(0.98,0.85,0.3),vec3(0.2,0.45,0.8),step(1.5,fi)),step(0.5,fract(atan(q.x,1.2)*2.2+fi*0.3)));
      col=mix(col,bc*(0.55+0.45*uSkyAmb)*(1.-0.25*q.x),body*uFx.y);
      col=mix(col,vec3(0.25,0.15,0.1)*uSkyAmb,basket*uFx.y);
    }
    vec2 fu=vec2((x+uOff*0.2)/uPano.x,1.-y/uPano.y);
    vec4 ft=texture(uFar,vec2(fu.x,max(fu.y,0.002)))*step(0.,fu.y);
    vec3 fc=mix(ft.rgb*uSkyAmb,uHor*ft.a,0.34)+uLights*lightsAt(fu)*(1.-uLightLayer)*0.9;
    col=col*(1.-ft.a)+fc;
    if(uFx.z>0.) for(int i=0;i<3;i++){ // searchlights over the city
      float fi=float(i), a=sin(uTime*(0.35+0.1*fi)+fi*2.1)*0.55;
      vec2 q=vec2(x-(mod(fi*1.3+0.4-uOff*0.2,3.4)-1.7),y); q=vec2(q.x*cos(a)-q.y*sin(a),q.x*sin(a)+q.y*cos(a));
      col+=vec3(0.55,0.65,1.)*uFx.z*step(0.,q.y)*smoothstep(1.,0.,abs(q.x)/(0.012+q.y*0.07))*exp(-q.y*2.2)*0.3;
    }
    vec2 mu=vec2((x+uOff*0.32)/(uPano.z*0.72)+0.37,1.-y/(uPano.w*0.58));
    vec4 mt=texture(uNear,vec2(mu.x,max(mu.y,0.002)))*step(0.,mu.y)*(1.-uLightLayer*0.0)*step(uFx.w,0.5);
    col=col*(1.-mt.a)+mix(mt.rgb*uSkyAmb,uHor*mt.a,0.3);
    if(uFx.w>0.){ // sea between the far shore and the near hills
      float sh=0.075, k=smoothstep(sh,sh-0.006,y);
      vec3 sea=mix(uHor,uTop,0.5)*0.72+vec3(0.,0.03,0.05)*dayK;
      float gl=pow(noise(vec2(x*70.+uOff*9.,y*900.+uTime*1.6)),4.)*(0.25+1.6*exp(-abs(x-sx)*5.));
      col=mix(col,sea+uSunCol*gl*0.8+uSkyAmb*0.06*sin(y*700.+uTime*2.),k);
    }
    vec2 nu=vec2((x+uOff*0.45)/uPano.z,1.-y/uPano.w);
    vec4 nt=texture(uNear,vec2(nu.x,max(nu.y,0.002)))*step(0.,nu.y);
    vec3 nc=mix(nt.rgb*uSkyAmb,uHor*nt.a,0.14)+uLights*lightsAt(nu)*uLightLayer;
    col=col*(1.-nt.a)+nc;
    if(uFx.x>0.) for(int i=0;i<7;i++){ // birds
      float fi=float(i);
      vec2 bp=vec2(mod(uTime*0.035+0.6,3.6)-1.8-uOff*0.1+hash1(fi)*0.22,0.42+0.1*hash1(fi+9.)+0.02*sin(uTime*0.4+fi));
      vec2 q=(vec2(x,y)-bp)/0.012; float flap=0.35+0.55*sin(uTime*7.+fi*1.7);
      col=mix(col,vec3(0.08,0.08,0.1),uFx.x*step(abs(q.x),1.)*smoothstep(0.2,0.08,abs(q.y-abs(q.x)*flap+0.2)));
    }
    col=mix(col,vec3(0.8,0.85,1.),uFlash*0.3);
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
uniform sampler2D uScene,uBloom; uniform vec2 uRes,uBlur,uLines,uFringe;
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
  bool second=uViews>1.5&&top<0.5;
  float blur=second?uBlur.y:uBlur.x, lines=second?uLines.y:uLines.x, fringe=second?uFringe.y:uFringe.x;
  vec2 d=uv-c; float r2=dot(d,d)*(uViews>1.5?8.:4.);
  vec3 col=vec3(0.);
  for(int i=0;i<8;i++){ float s=1.-blur*0.0065*float(i)*r2; col+=texture(uScene,c+d*s).rgb; }
  col/=8.;
  if(fringe>0.01){ float k=fringe*0.006*r2; col.r=mix(col.r,texture(uScene,c+d*(1.-k)).r,0.8); col.b=mix(col.b,texture(uScene,c+d*(1.+k)).b,0.8); }
  if(lines>0.01){
    vec2 dd=d*vec2(uRes.x/uRes.y,uViews>1.5?2.:1.); float rr=length(dd), an=atan(dd.y,dd.x);
    float st=pow(noise(vec2(an*46.,rr*1.5-uTime*9.)),7.)*smoothstep(0.3,0.75,rr);
    col+=vec3(0.9,0.95,1.)*st*lines*0.55;
  }
  col+=texture(uBloom,uv).rgb*uBloomAmt;
  if(uRain>0.){ float r=rain(uv,0.)+rain(uv*1.3+3.,1.)*0.7+rain(uv*1.7+9.,2.)*0.5; col=mix(col,vec3(0.78,0.84,0.95),clamp(r,0.,1.)*0.3*uRain); }
  if(uSnow>0.){ float s=snow(uv,0.)+snow(uv+5.,1.)*0.8+snow(uv+11.,2.)*0.6; col=mix(col,vec3(1.),clamp(s,0.,1.)*0.8*uSnow); }
  col*=1.+uFlash*0.9;
  col=mix(vec3(dot(col,vec3(0.299,0.587,0.114))),col,1.1);
  vec2 q=uv-0.5; col*=1.-0.42*pow(length(q*vec2(1.15,1.))*1.25,2.6);
  if(uCrt>0.){ col*=1.-0.22*uCrt*(0.5+0.5*sin(gl_FragCoord.y*3.14159)); col*=1.+0.04*uCrt*sin(gl_FragCoord.x*2.094); }
  o=vec4(col,1.);
}`;
